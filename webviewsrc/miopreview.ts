import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, runSafely, enableZoom, subscribeRefreshButton, previewOption, setPreviewOption, currentScale, setPreviewPanDisabled } from "./util/common";
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
import { vscode } from './util/vscode';
import type { MioEditMessage, MioParentLinkKind, MioPositionEdit } from '../src/previewdef/mio/editcommon';
import { getMioGridDelta, hasMioDragPassedThreshold, isMioAbsolutePositionInBounds } from '../src/previewdef/mio/draginteraction';
import { applyMioLocalPositions } from '../src/previewdef/mio/localpreview';

declare global {
    interface Window {
        mios: Mio[];
        renderedTrait: Record<string, Record<string, string>>;
        gridBox: GridBoxType;
        styleNonce: string;
        xGridSize: number;
        mioDocumentVersion: number;
    }
}

const mios: Mio[] = window.mios;
const restoredState = getState();

let selectedExprs = restoreArrayState<ConditionItem>(restoredState.selectedExprs);
let selectedMioIndex = typeof restoredState.selectedMioId === 'string'
    ? Math.max(0, mios.findIndex(mio => mio.id === restoredState.selectedMioId))
    : restoreSelectionIndex(restoredState.selectedMioIndex, mios.length);
let showIncludedTraits = previewOption('mio.showIncludedTraits', true);
let showGrid = previewOption('mio.showGrid', false);
let showOverlaps = previewOption('mio.showOverlaps', true);
let conditions: DivDropdown | undefined = undefined;
const leftPadding = 50;
const topPadding = 50;
let mioEditMode = restoredState.mioEditMode === true;
let selectedTraitIdsByMio: Record<string, string[]> = restoredState.selectedTraitIdsByMio ?? {};
let currentTraitPositions: Record<string, NumberPosition> = {};
let currentLeftPadding = leftPadding;
let activeEditRequestId: string | undefined;
let editRequestSequence = 0;
let pendingLink: { sourceTraitId: string; kind: MioParentLinkKind | 'exclusive' } | undefined;
let suppressTraitClickUntil = 0;
let rollbackPositionEdit: (() => void) | undefined;
let contentBuildGeneration = 0;

function currentMio(): Mio | undefined {
    return mios[selectedMioIndex];
}

function selectedTraitIds(): string[] {
    const mio = currentMio();
    return mio ? (selectedTraitIdsByMio[mio.id] ?? []).filter(id => !!mio.traits[id]) : [];
}

function setSelectedTraitIds(ids: readonly string[]): void {
    const mio = currentMio();
    if (!mio) {
        return;
    }
    selectedTraitIdsByMio = {
        ...selectedTraitIdsByMio,
        [mio.id]: Array.from(new Set(ids.filter(id => !!mio.traits[id]))),
    };
    setState({ selectedTraitIdsByMio });
    updateMioEditUi();
}

function getTraitElement(target: EventTarget | null): HTMLElement | undefined {
    const element = target instanceof Element ? target.closest<HTMLElement>('.trait') : null;
    return element ?? undefined;
}

function getTraitId(element: HTMLElement | undefined): string | undefined {
    return element?.dataset.mioTraitId
        ?? element?.querySelector<HTMLElement>('[data-mio-trait-id]')?.dataset.mioTraitId;
}

function postMioEdit<TCommand extends MioEditMessage['command']>(
    command: TCommand,
    payload: Omit<Extract<MioEditMessage, { command: TCommand }>, 'command' | 'requestId' | 'documentVersion' | 'mioId'>,
): void {
    const mio = currentMio();
    if (!mio || activeEditRequestId) {
        return;
    }
    activeEditRequestId = `mio-edit-${Date.now()}-${++editRequestSequence}`;
    vscode.postMessage({
        command,
        requestId: activeEditRequestId,
        documentVersion: window.mioDocumentVersion,
        mioId: mio.id,
        ...payload,
    });
    updateMioEditUi();
}

function updateMioEditUi(): void {
    const button = document.getElementById('mio-edit-mode') as HTMLButtonElement | null;
    if (button) {
        button.disabled = !!activeEditRequestId;
        button.setAttribute('aria-pressed', mioEditMode ? 'true' : 'false');
        button.style.color = mioEditMode ? 'var(--vscode-focusBorder)' : '';
        button.style.background = mioEditMode ? 'rgba(32, 124, 229, 0.14)' : '';
    }
    const selected = new Set(selectedTraitIds());
    document.querySelectorAll<HTMLElement>('.trait').forEach(element => {
        const traitId = getTraitId(element);
        const editable = element.dataset.mioTraitEditable === 'true';
        const pending = !!traitId && pendingLink?.sourceTraitId === traitId;
        element.style.cursor = mioEditMode && editable ? 'grab' : 'pointer';
        element.style.boxShadow = pending
            ? '0 0 0 2px rgba(255, 196, 64, 0.95) inset'
            : traitId && selected.has(traitId)
                ? '0 0 0 2px rgba(96, 196, 255, 0.95) inset'
                : mioEditMode && editable
                    ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset'
                    : '';
    });
    setPreviewPanDisabled(mioEditMode);
}

function setMioEditMode(enabled: boolean): void {
    mioEditMode = enabled;
    pendingLink = undefined;
    if (!enabled) {
        setSelectedTraitIds([]);
    }
    setState({ mioEditMode });
    hideMioContextMenu();
    updateMioEditUi();
}

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
    const generation = ++contentBuildGeneration;
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
    currentTraitPositions = traitPosition;
    currentLeftPadding = leftPadding;

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
    if (generation !== contentBuildGeneration) {
        return;
    }
    miopreviewplaceholder.innerHTML = traitPreviewContent + gridGuideLayer + overlapLayer + styleTable.toStyleElement(window.styleNonce);

    miopreviewplaceholder.querySelectorAll<HTMLElement>('[data-mio-trait-id]').forEach(navigator => {
        const traitElement = navigator.closest<HTMLElement>('.trait');
        if (!traitElement) {
            return;
        }
        traitElement.dataset.mioTraitId = navigator.dataset.mioTraitId;
        traitElement.dataset.mioTraitEditable = navigator.dataset.mioTraitEditable;
        traitElement.dataset.mioTraitDefinitionKind = navigator.dataset.mioTraitDefinitionKind;
    });

    subscribeNavigators();
    updateMioEditUi();
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

function ensureMioContextMenu(): HTMLDivElement {
    let menu = document.getElementById('mio-edit-context-menu') as HTMLDivElement | null;
    if (menu) {
        return menu;
    }
    menu = document.createElement('div');
    menu.id = 'mio-edit-context-menu';
    Object.assign(menu.style, {
        position: 'fixed', display: 'none', zIndex: '1200', minWidth: '180px', padding: '4px',
        background: 'var(--vscode-menu-background)', color: 'var(--vscode-menu-foreground)',
        border: '1px solid var(--vscode-menu-border)', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
    });
    const addButton = (label: string, action: (traitId: string) => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        Object.assign(button.style, {
            display: 'block', width: '100%', padding: '5px 8px', textAlign: 'left',
            background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer',
        });
        button.addEventListener('mousedown', event => {
            event.preventDefault();
            const traitId = menu!.dataset.traitId;
            hideMioContextMenu();
            if (traitId) {
                action(traitId);
            }
        });
        menu!.appendChild(button);
    };
    addButton(feLocalize('miopreview.edit.linkAny', 'Link Any Parent'), traitId => startPendingLink(traitId, 'any'));
    addButton(feLocalize('miopreview.edit.linkAll', 'Link All Parents'), traitId => startPendingLink(traitId, 'all'));
    addButton(feLocalize('miopreview.edit.linkExclusive', 'Link Mutually Exclusive'), traitId => startPendingLink(traitId, 'exclusive'));
    addButton(feLocalize('miopreview.edit.delete', 'Delete'), traitId => {
        const ids = selectedTraitIds().includes(traitId) ? selectedTraitIds() : [traitId];
        postMioEdit('deleteMioTraits', { traitIds: ids });
    });
    menu.addEventListener('contextmenu', event => event.preventDefault());
    document.body.appendChild(menu);
    return menu;
}

function hideMioContextMenu(): void {
    const menu = document.getElementById('mio-edit-context-menu') as HTMLDivElement | null;
    if (menu) {
        menu.style.display = 'none';
        delete menu.dataset.traitId;
    }
}

function startPendingLink(sourceTraitId: string, kind: MioParentLinkKind | 'exclusive'): void {
    pendingLink = { sourceTraitId, kind };
    ensurePendingLinkOverlay();
    updateMioEditUi();
}

function ensurePendingLinkOverlay(): SVGLineElement {
    let svg = document.getElementById('mio-pending-link-overlay') as unknown as SVGSVGElement | null;
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'mio-pending-link-overlay';
        Object.assign(svg.style, {
            position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh',
            pointerEvents: 'none', zIndex: '1100',
        });
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.id = 'mio-pending-link-line';
        line.setAttribute('stroke-width', '2');
        svg.appendChild(line);
        document.body.appendChild(svg);
    }
    return svg.querySelector('#mio-pending-link-line') as SVGLineElement;
}

function refreshPendingLinkOverlay(clientX: number, clientY: number): void {
    const svg = document.getElementById('mio-pending-link-overlay') as unknown as SVGSVGElement | null;
    if (!pendingLink) {
        if (svg) {
            svg.style.display = 'none';
        }
        return;
    }
    const source = Array.from(document.querySelectorAll<HTMLElement>('.trait'))
        .find(element => getTraitId(element) === pendingLink!.sourceTraitId);
    if (!source) {
        return;
    }
    const rect = source.getBoundingClientRect();
    const line = ensurePendingLinkOverlay();
    svg!.style.display = '';
    line.setAttribute('x1', String(rect.left + rect.width / 2));
    line.setAttribute('y1', String(rect.top + rect.height / 2));
    line.setAttribute('x2', String(clientX));
    line.setAttribute('y2', String(clientY));
    line.setAttribute('stroke', pendingLink.kind === 'exclusive' ? '#ff6666' : '#ffc440');
    line.setAttribute('stroke-dasharray', pendingLink.kind === 'exclusive' ? '0' : '8 5');
}

function clearPendingLink(): void {
    pendingLink = undefined;
    refreshPendingLinkOverlay(0, 0);
    updateMioEditUi();
}

function setupMioEditInteractions(): void {
    document.addEventListener('contextmenu', event => {
        if (!mioEditMode) {
            hideMioContextMenu();
            return;
        }
        const traitElement = getTraitElement(event.target);
        const traitId = getTraitId(traitElement);
        if (!traitId || traitElement?.dataset.mioTraitEditable !== 'true') {
            hideMioContextMenu();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const menu = ensureMioContextMenu();
        menu.dataset.traitId = traitId;
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.display = 'block';
    }, true);

    document.addEventListener('click', event => {
        if (!mioEditMode) {
            return;
        }
        hideMioContextMenu();
        const traitElement = getTraitElement(event.target);
        const traitId = getTraitId(traitElement);
        if (!traitId) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (Date.now() <= suppressTraitClickUntil) {
            return;
        }
        if (pendingLink) {
            const sourceTraitId = pendingLink.sourceTraitId;
            const kind = pendingLink.kind;
            clearPendingLink();
            if (sourceTraitId === traitId) {
                return;
            }
            if (kind === 'exclusive') {
                postMioEdit('toggleMioExclusiveLink', { sourceTraitId, targetTraitId: traitId });
            } else {
                postMioEdit('toggleMioParentLink', { parentTraitId: sourceTraitId, childTraitId: traitId, kind });
            }
            return;
        }
        const current = new Set(selectedTraitIds());
        if (event.ctrlKey || event.metaKey) {
            if (current.has(traitId)) {
                current.delete(traitId);
            } else {
                current.add(traitId);
            }
            setSelectedTraitIds(Array.from(current));
        } else if (event.shiftKey) {
            current.add(traitId);
            setSelectedTraitIds(Array.from(current));
        } else {
            setSelectedTraitIds([traitId]);
        }
    }, true);

    document.addEventListener('pointermove', event => {
        if (pendingLink) {
            refreshPendingLinkOverlay(event.clientX, event.clientY);
        }
    }, true);

    document.addEventListener('keydown', event => {
        if (!mioEditMode) {
            return;
        }
        if (event.key === 'Escape') {
            clearPendingLink();
            hideMioContextMenu();
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTraitIds().length > 0) {
            event.preventDefault();
            postMioEdit('deleteMioTraits', { traitIds: selectedTraitIds() });
        }
    });

    setupMioTraitDrag();
    setupMioSelectionMarquee();
    setupMioTraitCreate();
}

function setupMioTraitDrag(): void {
    document.addEventListener('pointerdown', event => {
        if (!mioEditMode || activeEditRequestId || pendingLink || event.button !== 0 || !event.isPrimary || event.shiftKey) {
            return;
        }
        const anchorElement = getTraitElement(event.target);
        const anchorId = getTraitId(anchorElement);
        const mio = currentMio();
        if (!anchorElement || !anchorId || !mio?.traits[anchorId] || anchorElement.dataset.mioTraitEditable !== 'true') {
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        const selected = selectedTraitIds().includes(anchorId) ? selectedTraitIds() : [anchorId];
        if (!selectedTraitIds().includes(anchorId)) {
            setSelectedTraitIds(selected);
        }
        const startPage = { x: event.pageX, y: event.pageY };
        let dragging = false;
        let valid = true;
        let delta = { x: 0, y: 0 };
        const elements = selected.map(id => Array.from(document.querySelectorAll<HTMLElement>('.trait'))
            .find(element => getTraitId(element) === id)).filter((element): element is HTMLElement => !!element);

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }
            const pageDeltaX = moveEvent.pageX - startPage.x;
            const pageDeltaY = moveEvent.pageY - startPage.y;
            if (!dragging && !hasMioDragPassedThreshold(pageDeltaX, pageDeltaY, 4)) {
                return;
            }
            dragging = true;
            delta = getMioGridDelta(pageDeltaX, pageDeltaY, currentScale(), window.xGridSize, window.gridBox.slotsize?.height?._value ?? 117);
            valid = selected.every(id => {
                const position = currentTraitPositions[id];
                return !!position && isMioAbsolutePositionInBounds({ x: position.x + delta.x, y: position.y + delta.y });
            });
            elements.forEach(element => {
                element.style.transform = `translate(${delta.x * window.xGridSize}px, ${delta.y * (window.gridBox.slotsize?.height?._value ?? 117)}px)`;
                element.style.opacity = valid ? '1' : '0.45';
                element.style.zIndex = '20';
            });
        };
        const finish = (finishEvent: PointerEvent, commit: boolean) => {
            if (finishEvent.pointerId !== event.pointerId) {
                return;
            }
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', cancel, true);
            if (!commit || !dragging || !valid || (delta.x === 0 && delta.y === 0)) {
                elements.forEach(element => {
                    element.style.transform = '';
                    element.style.opacity = '';
                    element.style.zIndex = '';
                });
                return;
            }
            suppressTraitClickUntil = Date.now() + 250;
            const edits: MioPositionEdit[] = selected.map(id => ({
                traitId: id,
                x: mio.traits[id].x + delta.x,
                y: mio.traits[id].y + delta.y,
                absoluteX: currentTraitPositions[id].x + delta.x,
                absoluteY: currentTraitPositions[id].y + delta.y,
            }));
            rollbackPositionEdit = applyMioLocalPositions(mio, edits);
            void buildContent();
            postMioEdit('applyMioPositionEdits', { edits });
        };
        const up = (upEvent: PointerEvent) => finish(upEvent, true);
        const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false);
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', cancel, true);
    }, true);
}

function setupMioSelectionMarquee(): void {
    document.addEventListener('pointerdown', event => {
        if (!mioEditMode || activeEditRequestId || pendingLink || event.button !== 0 || !event.shiftKey || getTraitElement(event.target)) {
            return;
        }
        const placeholder = document.getElementById('miopreviewplaceholder');
        if (!placeholder || !(event.target instanceof Node) || !placeholder.contains(event.target)) {
            return;
        }
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY };
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', border: '1px solid var(--vscode-focusBorder)',
            background: 'rgba(32,124,229,.12)', pointerEvents: 'none', zIndex: '1300',
        });
        document.body.appendChild(overlay);
        const move = (moveEvent: PointerEvent) => {
            const left = Math.min(start.x, moveEvent.clientX);
            const top = Math.min(start.y, moveEvent.clientY);
            const right = Math.max(start.x, moveEvent.clientX);
            const bottom = Math.max(start.y, moveEvent.clientY);
            Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
            const ids = Array.from(document.querySelectorAll<HTMLElement>('.trait')).filter(element => {
                const rect = element.getBoundingClientRect();
                return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
            }).map(element => getTraitId(element)).filter((id): id is string => !!id);
            setSelectedTraitIds(ids);
        };
        const finish = () => {
            overlay.remove();
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', finish, true);
            window.removeEventListener('pointercancel', finish, true);
            suppressTraitClickUntil = Date.now() + 250;
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', finish, true);
        window.addEventListener('pointercancel', finish, true);
    }, true);
}

function setupMioTraitCreate(): void {
    document.addEventListener('dblclick', event => {
        if (!mioEditMode || activeEditRequestId || pendingLink || getTraitElement(event.target)) {
            return;
        }
        const placeholder = document.getElementById('miopreviewplaceholder');
        if (!placeholder || !(event.target instanceof Node) || !placeholder.contains(event.target)) {
            return;
        }
        const rect = placeholder.getBoundingClientRect();
        const scale = currentScale();
        const x = Math.round(((event.clientX - rect.left) / scale - currentLeftPadding) / window.xGridSize);
        const y = Math.round(((event.clientY - rect.top) / scale - topPadding) / (window.gridBox.slotsize?.height?._value ?? 117));
        if (!isMioAbsolutePositionInBounds({ x, y })) {
            return;
        }
        event.preventDefault();
        postMioEdit('createMioTraitAtPosition', { x, y });
    }, true);
}

window.addEventListener('load', runSafely(async function() {
    // Mio selection
    const mioSelect = document.getElementById('mios') as HTMLSelectElement | null;
    if (mioSelect) {
        mioSelect.value = selectedMioIndex.toString();
        mioSelect.addEventListener('change', () => {
            selectedMioIndex = parseInt(mioSelect.value);
            setState({ selectedMioIndex, selectedMioId: mios[selectedMioIndex]?.id });
            pendingLink = undefined;
            updateSelectedMio(true);
            void buildContent();
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

    const editButton = document.getElementById('mio-edit-mode') as HTMLButtonElement | null;
    editButton?.addEventListener('click', () => setMioEditMode(!mioEditMode));
    setupMioEditInteractions();

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

    subscribeRefreshButton();
    
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
    updateMioEditUi();
    scrollToState();
}));

window.addEventListener('message', event => {
    const message = event.data as {
        command?: string;
        requestId?: string;
        documentVersion?: number;
    };
    if ((message.command !== 'mioEditApplied' && message.command !== 'mioEditRejected')
        || !message.requestId
        || message.requestId !== activeEditRequestId) {
        return;
    }
    activeEditRequestId = undefined;
    if (typeof message.documentVersion === 'number') {
        window.mioDocumentVersion = message.documentVersion;
    }
    updateMioEditUi();
    if (message.command === 'mioEditRejected') {
        rollbackPositionEdit?.();
        void buildContent();
    }
    rollbackPositionEdit = undefined;
});
