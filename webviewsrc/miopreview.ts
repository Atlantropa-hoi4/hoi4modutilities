import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, runSafely, enableZoom, previewOption, setPreviewOption } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { toggleBinder } from "./util/toolbar";
import { minBy, maxBy } from "lodash";
import { renderGridBoxCommon, GridBoxItem, GridBoxConnection } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable } from "../src/util/styletable";
import { applyCondition, ConditionItem, conditionItemToStringValue, conditionToString, stringValueToConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { feLocalize } from './util/i18n';
import { Mio, MioTrait } from "../src/previewdef/mio/schema";
import { restoreArrayState, restoreSelectionIndex } from "./util/restoredstate";

declare global {
    interface Window {
        mios: Mio[];
        renderedTrait: Record<string, Record<string, string>>;
        gridBox: GridBoxType;
        styleNonce: string;
        xGridSize: number;
    }
}

const mios: Mio[] = window.mios;
const restoredState = getState();

let selectedExprs = restoreArrayState<ConditionItem>(restoredState.selectedExprs);
let selectedMioIndex = restoreSelectionIndex(restoredState.selectedMioIndex, mios.length);
let showIncludedTraits = previewOption('mio.showIncludedTraits', true);
let showGrid = previewOption('mio.showGrid', false);
let showOverlaps = previewOption('mio.showOverlaps', true);
let conditions: DivDropdown | undefined = undefined;

function conditionItemToExprKey(expr: ConditionItem): string {
    return `${expr.scopeName}!|${expr.nodeContent}`;
}

function exprKeyToConditionItem(exprKey: string): ConditionItem {
    const separatorIndex = exprKey.indexOf('!|');
    if (separatorIndex < 0) {
        return {
            scopeName: '',
            nodeContent: exprKey,
        };
    }

    return {
        scopeName: exprKey.substring(0, separatorIndex),
        nodeContent: exprKey.substring(separatorIndex + 2),
    };
}

function createDropdownValueSpan(): HTMLSpanElement {
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    return valueSpan;
}

function replaceConditionOptions(select: HTMLDivElement, conditionExprs: readonly ConditionItem[]) {
    const optionElements = conditionExprs.map(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.setAttribute('value', conditionItemToExprKey(option));
        optionElement.textContent = `${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}`;
        return optionElement;
    });
    select.replaceChildren(createDropdownValueSpan(), ...optionElements);
}

async function buildContent() {
    const miopreviewplaceholder = document.getElementById('miopreviewplaceholder') as HTMLDivElement;
    
    const styleTable = new StyleTable();
    const mio = mios[selectedMioIndex];
    if (!mio) {
        return;
    }
    const renderedTrait: Record<string, string> = window.renderedTrait[mio.id];
    const traits = Object.values(mio.traits);

    const allowBranchOptionsValue: Record<string, boolean> = {};
    const exprs = selectedExprs;
    Object.values(mio.traits).forEach(trait => {
        if (trait.hasVisible) {
            allowBranchOptionsValue[trait.id] = applyCondition(trait.visible, exprs);
        }
    });

    const gridbox: GridBoxType = window.gridBox;

    const traitPosition: Record<string, NumberPosition> = {};
    calculateTraitVisible(mio, allowBranchOptionsValue);
    const visibleTraits = showIncludedTraits ? traits : traits.filter(trait => trait.sourceMioId === mio.id);
    const traitGrixBoxItems = visibleTraits.map(trait => traitToGridItem(trait, mio, allowBranchOptionsValue, traitPosition)).filter((v): v is GridBoxItem => !!v);
    
    const minX = minBy(Object.values(traitPosition), 'x')?.x ?? 0;
    const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);

    const traitPreviewContent = await renderGridBoxCommon({ ...gridbox, position: {...gridbox.position, x: toNumberLike(leftPadding)} }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: arrayToMap(traitGrixBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(
            renderedTrait[item.id].replace('{{position}}', item.gridX + ', ' + item.gridY)),
        cornerPosition: 0.5,
    });

    const gridGuideLayer = showGrid ? buildGridGuide(styleTable, gridbox, window.xGridSize, leftPadding, traitPosition) : '';
    const overlapLayer = showOverlaps ? buildOverlapOverlay(styleTable, gridbox, window.xGridSize, leftPadding, findOverlaps(traitGrixBoxItems)) : '';
    miopreviewplaceholder.innerHTML = traitPreviewContent + gridGuideLayer + overlapLayer + styleTable.toStyleElement(window.styleNonce);

    subscribeNavigators();
}

// Column grid overlay. Draws a faint vertical line at every column boundary (k = 0..10) anchored to
// the same grid origin as the traits/headers, and emphasizes the k = 10 line — the right edge of
// column 9. The in-game MIO tree window only renders columns 0..9, so any trait with x > 9 bugs out;
// this marks where that limit falls. The layer sits inside #miopreviewplaceholder so it scales with
// zoom and shifts together with the grid.
function buildGridGuide(
    styleTable: StyleTable,
    gridbox: GridBoxType,
    xGridSize: number,
    leftPadding: number,
    traitPosition: Record<string, NumberPosition>,
): string {
    const limitColumn = 10; // right edge of column 9 (valid columns are 0..9)
    const yGridSize = gridbox.slotsize?.height?._value ?? 117;
    const top = gridbox.position.y._value;
    const maxY = maxBy(Object.values(traitPosition), 'y')?.y ?? 0;
    const height = (maxY + 1) * yGridSize;

    let lines = '';
    for (let k = 0; k <= limitColumn; k++) {
        const isLimit = k === limitColumn;
        const cls = isLimit
            ? styleTable.style('mio-grid-limit', () => `position:absolute; top:0; width:2px; background:#e06c3b; opacity:0.85; pointer-events:none;`)
            : styleTable.style('mio-grid-line', () => `position:absolute; top:0; width:1px; background:#ffffff; opacity:0.12; pointer-events:none;`);
        lines += `<div class="${cls} ${styleTable.oneTimeStyle('mio-grid-x-' + k, () => `left:${k * xGridSize}px; height:${height}px;`)}"></div>`;
    }

    const label = `<div class="${styleTable.style('mio-grid-label', () => `position:absolute; top:-14px; font-size:10px; color:#e06c3b; white-space:nowrap; pointer-events:none;`)} ${styleTable.oneTimeStyle('mio-grid-label-pos', () => `left:${limitColumn * xGridSize + 4}px;`)}">${feLocalize("miopreview.gridlimit", "x = 9 limit")}</div>`;

    return `<div class="${styleTable.oneTimeStyle('mio-grid-layer', () => `position:absolute; left:${leftPadding}px; top:${top}px;`)}">${lines}${label}</div>`;
}

interface TraitOverlap {
    x: number;
    y: number;
    count: number;
}

// Traits that resolve to the same grid slot are drawn on top of each other, so all but the last
// one rendered are invisible — the tree just silently "loses" a trait. Collisions are detected on
// the grid items rather than on mio.traits so traits hidden by a condition, by remove_trait or by
// the inherited-traits toggle can't raise a false positive.
export function findOverlaps(items: GridBoxItem[]): TraitOverlap[] {
    const countByCell: Record<string, TraitOverlap> = {};
    for (const item of items) {
        const key = item.gridX + ',' + item.gridY;
        const cell = countByCell[key];
        if (cell) {
            cell.count++;
        } else {
            countByCell[key] = { x: item.gridX, y: item.gridY, count: 1 };
        }
    }

    return Object.values(countByCell).filter(cell => cell.count > 1);
}

// Marks every grid slot holding more than one trait with a red box, so an overlap is visible
// instead of silently hiding a trait. Anchored like the grid guide above, so it lives inside
// #miopreviewplaceholder and follows zoom and pan. The boxes are pointer-events:none on purpose:
// the click must still reach the trait's .navigator underneath so the user can jump to the
// definition and fix the position. z-index beats the trait label spans (z-index 5), whose .trait
// wrapper has no stacking context of its own, so the border isn't painted over.
function buildOverlapOverlay(
    styleTable: StyleTable,
    gridbox: GridBoxType,
    xGridSize: number,
    leftPadding: number,
    overlaps: TraitOverlap[],
): string {
    if (overlaps.length === 0) {
        return '';
    }

    const yGridSize = gridbox.slotsize?.height?._value ?? 117;
    const top = gridbox.position.y._value;

    const boxClass = styleTable.style('mio-overlap-box', () => `
        position:absolute;
        box-sizing:border-box;
        border:2px solid #e33;
        background:rgba(255,0,0,0.18);
        pointer-events:none;
    `);
    const countClass = styleTable.style('mio-overlap-count', () => `
        position:absolute;
        top:1px;
        right:3px;
        font-size:10px;
        font-weight:bold;
        color:#fff;
        text-shadow:0 0 3px #000;
        pointer-events:none;
    `);

    const boxes = overlaps.map(overlap => {
        const positionClass = styleTable.oneTimeStyle('mio-overlap-pos', () => `
            left:${overlap.x * xGridSize}px;
            top:${overlap.y * yGridSize}px;
            width:${xGridSize}px;
            height:${yGridSize}px;
        `);
        return `<div class="${boxClass} ${positionClass}"><span class="${countClass}">&times;${overlap.count}</span></div>`;
    }).join('');

    return `<div class="${styleTable.oneTimeStyle('mio-overlap-layer', () => `position:absolute; left:${leftPadding}px; top:${top}px; z-index:6;`)}">${boxes}</div>`;
}

function calculateTraitVisible(mio: Mio, allowBranchOptionsValue: Record<string, boolean>) {
    const traits = mio.traits;

    let changed = true;
    while (changed) {
        changed = false;
        for (const key in traits) {
            const trait = traits[key];
            if (trait.anyParent.length === 0 && trait.allParents.length === 0 && !trait.parent) {
                continue;
            }

            if (trait.id in allowBranchOptionsValue) {
                continue;
            }

            if (trait.parent) {
                if (trait.parent.traits.length - trait.parent.traits.filter(p => allowBranchOptionsValue[p] === false).length < trait.parent.numNeeded) {
                    allowBranchOptionsValue[trait.id] = false;
                    changed = true;
                    break;
                }

                if (trait.parent.traits.filter(p => allowBranchOptionsValue[p] === true).length >= trait.parent.numNeeded) {
                    allowBranchOptionsValue[trait.id] = true;
                    changed = true;
                    continue;
                }
            }

            if (trait.allParents.some(p => allowBranchOptionsValue[p] === false)) {
                allowBranchOptionsValue[trait.id] = false;
                changed = true;
                break;
            }

            if (trait.anyParent.some(p => allowBranchOptionsValue[p] === true)) {
                allowBranchOptionsValue[trait.id] = true;
                changed = true;
                continue;
            }
        }
    }
}

function updateSelectedMio(clearCondition: boolean) {
    const mio = mios[selectedMioIndex];

    const conditionExprs = mio.conditionExprs;

    const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
    if (conditionContainerElement) {
        conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
    }

    if (conditions) {
        replaceConditionOptions(conditions.select, conditionExprs);
        conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(conditionItemToExprKey));
    }

    const warnings = document.getElementById('warnings') as HTMLTextAreaElement | null;
    if (warnings) {
        warnings.value = mio.warnings.length === 0 ? feLocalize('worldmap.warnings.nowarnings', 'No warnings.') :
            mio.warnings.map(w => `[${w.source}] ${w.text}`).join('\n');
    }
}

function getTraitPosition(
    trait: MioTrait | undefined,
    positionByFocusId: Record<string, NumberPosition>,
    mio: Mio,
    traitStack: MioTrait[] = []
): NumberPosition {
    if (trait === undefined) {
        return { x: 0, y: 0 };
    }

    const cached = positionByFocusId[trait.id];
    if (cached) {
        return cached;
    }

    if (traitStack.includes(trait)) {
        return { x: 0, y: 0 };
    }

    let position: NumberPosition = { x: trait.x, y: trait.y };
    if (trait.relativePositionId !== undefined) {
        traitStack.push(trait);
        const relativeFocusPosition = getTraitPosition(mio.traits[trait.relativePositionId], positionByFocusId, mio, traitStack);
        traitStack.pop();
        position.x += relativeFocusPosition.x;
        position.y += relativeFocusPosition.y;
    }

    positionByFocusId[trait.id] = position;
    return position;
}

function traitToGridItem(
    trait: MioTrait,
    mio: Mio,
    allowBranchOptionsValue: Record<string, boolean>,
    positionByTraitId: Record<string, NumberPosition>,
): GridBoxItem | undefined {
    if (allowBranchOptionsValue[trait.id] === false) {
        return undefined;
    }

    const connections: GridBoxConnection[] = [];

    for (const parent of trait.anyParent) {
        connections.push({
            target: parent,
            targetType: 'parent',
            style: '1px dashed #88aaff',
        });
    }

    for (const parent of trait.allParents) {
        connections.push({
            target: parent,
            targetType: 'parent',
            style: '1px solid #88aaff',
        });
    }

    if (trait.parent) {
        const style = trait.parent.traits.length === trait.parent.numNeeded ? '1px solid #88aaff' : '1px dashed #88aaff';
        for (const parent of trait.parent.traits) {
            connections.push({
                target: parent,
                targetType: 'parent',
                style: style,
            });
        }
    }

    trait.exclusive.forEach(e => {
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid red",
        });
    });

    const position = getTraitPosition(trait, positionByTraitId, mio, []);

    return {
        id: trait.id,
        htmlId: 'trait_' + trait.id,
        classNames: 'trait',
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}

window.addEventListener('load', runSafely(async function() {
    // Mio selection
    const mioSelect = document.getElementById('mios') as HTMLSelectElement | null;
    if (mioSelect) {
        mioSelect.value = selectedMioIndex.toString();
        mioSelect.addEventListener('change', () => {
            selectedMioIndex = parseInt(mioSelect.value);
            setState({ selectedMioIndex });
            updateSelectedMio(true);
        });
    }

    // Conditions
    const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
    if (conditionsElement) {
        conditions = new DivDropdown(conditionsElement, true);
        
        conditions.selectedValues$.next(selectedExprs.map(conditionItemToExprKey));
        conditions.selectedValues$.subscribe(runSafely(async (selection) => {
            selectedExprs = selection.map(exprKeyToConditionItem);

            setState({ selectedExprs });
            
            await buildContent();
        }));
    }

    // Zoom
    const contentElement = document.getElementById('miopreviewcontent') as HTMLDivElement;
    enableZoom(contentElement, 0, (window as any).toolbarHeight ?? 52);

    // Toggle warnings
    const showWarnings = document.getElementById('show-warnings') as HTMLButtonElement;
    if (showWarnings) {
        const warnings = document.getElementById('warnings-container') as HTMLDivElement;
        showWarnings.addEventListener('click', () => {
            const visible = warnings.style.display === 'block';
            document.body.style.overflow = visible ? '' : 'hidden';
            warnings.style.display = visible ? 'none' : 'block';
        });
    }
    
    const bindToggle = toggleBinder(() => { void buildContent(); });
    bindToggle('show-included-traits', showIncludedTraits, value => {
        showIncludedTraits = value;
        setPreviewOption('mio.showIncludedTraits', value);
    });
    bindToggle('show-grid', showGrid, value => {
        showGrid = value;
        setPreviewOption('mio.showGrid', value);
    });
    bindToggle('show-overlaps', showOverlaps, value => {
        showOverlaps = value;
        setPreviewOption('mio.showOverlaps', value);
    });
    updateSelectedMio(false);
    await buildContent();
    scrollToState();
}));
