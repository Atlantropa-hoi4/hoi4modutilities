import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom, setPreviewPanDisabled } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { difference, minBy } from "lodash";
import { renderGridBoxCommon, GridBoxItem, GridBoxConnection } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable, normalizeForStyle } from "../src/util/styletable";
import { FocusTree, Focus } from "../src/previewdef/focustree/schema";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { feLocalize } from './util/i18n';
import { Checkbox } from "./util/checkbox";
import { vscode } from "./util/vscode";
import {
    FocusLayoutDraft,
    FocusLayoutMessage,
    FocusLayoutOffsetDraft,
} from "../src/previewdef/focustree/layouteditcommon";
import {
    LayoutTargetDescriptor,
    applyDraggedLayoutPosition,
    calculateDraggedLayoutPosition,
} from "../src/previewdef/focustree/layouteditdrag";

function showBranch(visibility: boolean, optionClass: string) {
    const elements = document.getElementsByClassName(optionClass);

    const hiddenBranches = getState().hiddenBranches || {};
    if (visibility) {
        delete hiddenBranches[optionClass];
    } else {
        hiddenBranches[optionClass] = true;
    }
    setState({ hiddenBranches: hiddenBranches });

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLDivElement;
        element.style.display = element.className.split(' ').some(b => hiddenBranches[b]) ? "none" : "block";
    }
}

function search(searchContent: string, navigate: boolean = true) {
    const focuses = document.getElementsByClassName('focus');
    const searchedFocus: HTMLDivElement[] = [];
    let navigated = false;
    for (let i = 0; i < focuses.length; i++) {
        const focus = focuses[i] as HTMLDivElement;
        if (searchContent && focus.id.toLowerCase().replace(/^focus_/, '').includes(searchContent)) {
            focus.style.outline = '1px solid #E33';
            focus.style.background = 'rgba(255, 0, 0, 0.5)';
            if (navigate && !navigated) {
                focus.scrollIntoView({ block: "center", inline: "center" });
                navigated = true;
            }
            searchedFocus.push(focus);
        } else {
            focus.style.outlineWidth = '0';
            focus.style.background = 'transparent';
        }
    }

    return searchedFocus;
}

const useConditionInFocus: boolean = (window as any).useConditionInFocus;
const focusTrees: FocusTree[] = (window as any).focusTrees;

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedInlayExprs: ConditionItem[] = getState().selectedInlayExprs ?? [];
let selectedFocusTreeIndex: number = Math.min(focusTrees.length - 1, getState().selectedFocusTreeIndex ?? 0);
let allowBranches: DivDropdown | undefined = undefined;
let conditions: DivDropdown | undefined = undefined;
let inlayConditions: DivDropdown | undefined = undefined;
let checkedFocuses: Record<string, Checkbox> = {};
const focusLayoutEditorEnabled: boolean = !!(window as any).focusLayoutEditorEnabled;
const focusLayoutActiveFile: string = (window as any).focusLayoutActiveFile ?? '';
const xGridSize: number = (window as any).xGridSize;
const yGridSize: number = (window as any).yGridSize ?? 130;

let focusLayoutEditMode = focusLayoutEditorEnabled && !!getState().focusLayoutEditMode;
let focusLayoutDraft: FocusLayoutDraft | undefined = undefined;
let focusLayoutSelectedKey: string | undefined = getState().focusLayoutSelectedKey;
let focusLayoutApplying = false;
let currentLayoutTargets: Record<string, LayoutTargetDescriptor> = {};

function showInlayWindows() {
    return !!(window as any).__showInlayWindows;
}

function getSelectedInlayWindowIds() {
    return getState().selectedInlayWindowIds ?? {} as Record<string, string | undefined>;
}

function getSelectedInlayWindowId(focusTree: FocusTree): string | undefined {
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (focusTree.inlayWindows.some(inlay => inlay.id === selected)) {
        return selected;
    }

    return focusTree.inlayWindows[0]?.id;
}

function setSelectedInlayWindowId(focusTree: FocusTree, inlayWindowId: string | undefined) {
    const selectedInlayWindowIds = getSelectedInlayWindowIds();
    selectedInlayWindowIds[focusTree.id] = inlayWindowId;
    setState({ selectedInlayWindowIds });
}

function persistLayoutState() {
    setState({
        focusLayoutEditMode,
        focusLayoutSelectedKey,
    });
}

function createLayoutDraftFromFocusTrees(): FocusLayoutDraft {
    const draft: FocusLayoutDraft = {
        baseVersion: (window as any).focusLayoutDocumentVersion ?? 0,
        focuses: {},
        continuous: {},
        inlayRefs: {},
    };

    for (const focusTree of focusTrees) {
        for (const focus of Object.values(focusTree.focuses)) {
            if (!focus.layout || draft.focuses[focus.layout.editKey]) {
                continue;
            }

            draft.focuses[focus.layout.editKey] = {
                kind: 'focus',
                editKey: focus.layout.editKey,
                focusId: focus.id,
                editable: focus.layout.editable && focus.layout.sourceFile === focusLayoutActiveFile,
                sourceFile: focus.layout.sourceFile,
                sourceRange: focus.layout.sourceRange,
                x: focus.layout.basePosition.x,
                y: focus.layout.basePosition.y,
                relativePositionId: focus.layout.relativePositionId ?? null,
                offsets: focus.layout.offsets.map<FocusLayoutOffsetDraft>(offset => ({
                    editKey: offset.editKey,
                    x: offset.x,
                    y: offset.y,
                    hasTrigger: offset.hasTrigger,
                    triggerText: offset.triggerText,
                })),
            };
        }

        if (focusTree.continuousFocusLayout && !draft.continuous[focusTree.continuousFocusLayout.editKey]) {
            draft.continuous[focusTree.continuousFocusLayout.editKey] = {
                kind: 'continuous',
                editKey: focusTree.continuousFocusLayout.editKey,
                editable: focusTree.continuousFocusLayout.editable && focusTree.continuousFocusLayout.sourceFile === focusLayoutActiveFile,
                sourceFile: focusTree.continuousFocusLayout.sourceFile,
                sourceRange: focusTree.continuousFocusLayout.sourceRange,
                x: focusTree.continuousFocusLayout.basePosition.x,
                y: focusTree.continuousFocusLayout.basePosition.y,
                label: focusTree.continuousFocusLayout.label,
            };
        }

        for (const inlay of focusTree.inlayWindows) {
            if (!inlay.layout || draft.inlayRefs[inlay.layout.editKey]) {
                continue;
            }

            draft.inlayRefs[inlay.layout.editKey] = {
                kind: 'inlayRef',
                editKey: inlay.layout.editKey,
                editable: inlay.layout.editable && inlay.layout.sourceFile === focusLayoutActiveFile,
                sourceFile: inlay.layout.sourceFile,
                sourceRange: inlay.layout.sourceRange,
                x: inlay.layout.basePosition.x,
                y: inlay.layout.basePosition.y,
                label: inlay.layout.label,
            };
        }
    }

    return draft;
}

function ensureLayoutDraft(): FocusLayoutDraft {
    const currentDocumentVersion = (window as any).focusLayoutDocumentVersion ?? 0;
    if (!focusLayoutDraft || focusLayoutDraft.baseVersion !== currentDocumentVersion) {
        focusLayoutDraft = createLayoutDraftFromFocusTrees();
    }

    return focusLayoutDraft;
}

function getRenderedFocusTree(focusTree: FocusTree): FocusTree {
    if (!focusLayoutDraft) {
        return focusTree;
    }

    const renderedFocuses = Object.fromEntries(Object.values(focusTree.focuses).map(focus => {
        const focusDraft = focusLayoutDraft?.focuses[focus.layoutEditKey];
        if (!focusDraft) {
            return [focus.id, focus];
        }

        const layoutOffsets = focus.layout?.offsets ?? [];
        const nextOffsets = focusDraft.offsets.map(offsetDraft => {
            if (offsetDraft.isNew) {
                return { editKey: offsetDraft.editKey, x: offsetDraft.x, y: offsetDraft.y, trigger: undefined };
            }

            const offsetIndex = layoutOffsets.findIndex(offset => offset.editKey === offsetDraft.editKey);
            const originalOffset = offsetIndex >= 0 ? focus.offset[offsetIndex] : undefined;
            return {
                editKey: offsetDraft.editKey,
                x: offsetDraft.x,
                y: offsetDraft.y,
                trigger: originalOffset?.trigger,
            };
        });

        return [focus.id, {
            ...focus,
            x: focusDraft.x,
            y: focusDraft.y,
            relativePositionId: focusDraft.relativePositionId ?? undefined,
            offset: nextOffsets,
        }];
    })) as Record<string, Focus>;

    const continuousDraft = focusTree.continuousFocusLayout ? focusLayoutDraft.continuous[focusTree.continuousFocusLayout.editKey] : undefined;
    const renderedInlayWindows = focusTree.inlayWindows.map(inlay => {
        const inlayDraft = inlay.layout ? focusLayoutDraft?.inlayRefs[inlay.layout.editKey] : undefined;
        if (!inlayDraft) {
            return inlay;
        }

        return {
            ...inlay,
            position: { x: inlayDraft.x, y: inlayDraft.y },
        };
    });

    return {
        ...focusTree,
        focuses: renderedFocuses,
        inlayWindows: renderedInlayWindows,
        continuousFocusPositionX: continuousDraft?.x ?? focusTree.continuousFocusPositionX,
        continuousFocusPositionY: continuousDraft?.y ?? focusTree.continuousFocusPositionY,
    };
}

async function buildContent() {
    const focusCheckState = getState().checkedFocuses ?? {};
    const checkedFocusesExprs = Object.keys(focusCheckState)
        .filter(fid => focusCheckState[fid])
        .map(fid => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + fid }));
    clearCheckedFocuses();

    const focustreeplaceholder = document.getElementById('focustreeplaceholder') as HTMLDivElement;
    const styleTable = new StyleTable();
    const renderedFocus: Record<string, string> = (window as any).renderedFocus;
    const baseFocusTree = focusTrees[selectedFocusTreeIndex];
    const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + baseFocusTree.id }, ...checkedFocusesExprs, ...selectedExprs, ...selectedInlayExprs];
    const focusTree = getRenderedFocusTree(baseFocusTree);
    const focuses = Object.values(focusTree.focuses);

    const allowBranchOptionsValue: Record<string, boolean> = {};
    focusTree.allowBranchOptions.forEach(option => {
        const focus = focusTree.focuses[option];
        allowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || applyCondition(focus.allowBranch, exprs);
    });

    if (focusTree.isSharedFocues) {
        focusTree.allowBranchOptions.forEach(option => {
            allowBranchOptionsValue[option] = true;
        });
    }

    const gridbox: GridBoxType = (window as any).gridBox;

    const focusPosition: Record<string, NumberPosition> = {};
    calculateFocusAllowed(focusTree, allowBranchOptionsValue);
    const focusGridBoxItems = focuses.map(focus => focusToGridItem(focus, focusTree, allowBranchOptionsValue, focusPosition, exprs)).filter((v): v is GridBoxItem => !!v);

    const minX = minBy(Object.values(focusPosition), 'x')?.x ?? 0;
    const leftPadding = gridbox.position.x._value - Math.min(minX * xGridSize, 0);

    const focusTreeContent = await renderGridBoxCommon({ ...gridbox, position: { ...gridbox.position, x: toNumberLike(leftPadding) } }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: arrayToMap(focusGridBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(
            renderedFocus[item.id]
                .replace('{{position}}', item.gridX + ', ' + item.gridY)
                .replace('{{iconClass}}', getFocusIcon(focusTree.focuses[item.id], exprs, styleTable))
            ),
        cornerPosition: 0.5,
    });

    focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement((window as any).styleNonce);
    const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement;
    inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, exprs);

    subscribeNavigators();
    setupCheckedFocuses(focuses, focusTree);
    currentLayoutTargets = createLayoutTargetIndex(focusTree, focusPosition, exprs);
    syncContinuousLayoutTarget(focusTree);
    renderOffsetHandles();
    if (focusLayoutSelectedKey && !currentLayoutTargets[focusLayoutSelectedKey]) {
        focusLayoutSelectedKey = undefined;
    }
    renderLayoutSelection();
    updateLayoutToolbar();
    updateLayoutPointerInterlocks();
    persistLayoutState();
}

function isFocusOffsetActive(offset: Focus['offset'][number], exprs: ConditionItem[]): boolean {
    return offset.trigger !== undefined && applyCondition(offset.trigger, exprs);
}

function createLayoutTargetIndex(
    focusTree: FocusTree,
    focusPosition: Record<string, NumberPosition>,
    exprs: ConditionItem[],
): Record<string, LayoutTargetDescriptor> {
    const result: Record<string, LayoutTargetDescriptor> = {};

    for (const focus of Object.values(focusTree.focuses)) {
        const position = focusPosition[focus.id];
        if (!position) {
            continue;
        }

        result[focus.layoutEditKey] = {
            key: focus.layoutEditKey,
            kind: 'focus',
            label: focus.id,
            editable: focus.layout?.editable === true && focus.layout.sourceFile === focusLayoutActiveFile,
            sourceFile: focus.layout?.sourceFile ?? focus.file,
            sourceStart: focus.layout?.sourceRange?.start ?? focus.token?.start,
            sourceEnd: focus.layout?.sourceRange?.end ?? focus.token?.end,
            currentPosition: position,
            focusId: focus.id,
        };

        const editable = focus.layout?.editable === true && focus.layout.sourceFile === focusLayoutActiveFile;
        focus.offset.forEach((offset, index) => {
            if (!offset.editKey || !isFocusOffsetActive(offset, exprs)) {
                return;
            }

            result[offset.editKey] = {
                key: offset.editKey,
                kind: 'offset',
                label: focus.offset.length > 1 ? `${focus.id} offset ${index + 1}` : `${focus.id} offset`,
                editable,
                sourceFile: focus.layout?.sourceFile ?? focus.file,
                sourceStart: focus.layout?.sourceRange?.start ?? focus.token?.start,
                sourceEnd: focus.layout?.sourceRange?.end ?? focus.token?.end,
                currentPosition: {
                    x: offset.x,
                    y: offset.y,
                },
                focusId: focus.id,
            };
        });
    }

    if (focusTree.continuousFocusLayout && focusTree.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        result[focusTree.continuousFocusLayout.editKey] = {
            key: focusTree.continuousFocusLayout.editKey,
            kind: 'continuous',
            label: focusTree.continuousFocusLayout.label,
            editable: focusTree.continuousFocusLayout.editable && focusTree.continuousFocusLayout.sourceFile === focusLayoutActiveFile,
            sourceFile: focusTree.continuousFocusLayout.sourceFile,
            sourceStart: focusTree.continuousFocusLayout.sourceRange?.start,
            sourceEnd: focusTree.continuousFocusLayout.sourceRange?.end,
            currentPosition: {
                x: focusTree.continuousFocusPositionX,
                y: focusTree.continuousFocusPositionY,
            },
        };
    }

    for (const inlay of focusTree.inlayWindows) {
        if (!inlay.layout) {
            continue;
        }

        result[inlay.layout.editKey] = {
            key: inlay.layout.editKey,
            kind: 'inlayRef',
            label: inlay.layout.label,
            editable: inlay.layout.editable && inlay.layout.sourceFile === focusLayoutActiveFile,
            sourceFile: inlay.layout.sourceFile,
            sourceStart: inlay.layout.sourceRange?.start,
            sourceEnd: inlay.layout.sourceRange?.end,
            currentPosition: {
                x: inlay.position.x,
                y: inlay.position.y,
            },
        };
    }

    return result;
}

function renderOffsetHandles() {
    document.querySelectorAll('.focus-layout-offset-handles').forEach(element => element.remove());

    if (!focusLayoutEditorEnabled || !focusLayoutEditMode) {
        return;
    }

    const offsetTargetsByFocusId: Record<string, LayoutTargetDescriptor[]> = {};
    for (const target of Object.values(currentLayoutTargets)) {
        if (target.kind !== 'offset' || !target.focusId || !target.editable) {
            continue;
        }

        if (!offsetTargetsByFocusId[target.focusId]) {
            offsetTargetsByFocusId[target.focusId] = [];
        }

        offsetTargetsByFocusId[target.focusId].push(target);
    }

    for (const [focusId, offsetTargets] of Object.entries(offsetTargetsByFocusId)) {
        const host = document.getElementById(`focus_${focusId}`) as HTMLDivElement | null;
        if (!host) {
            continue;
        }

        const handles = document.createElement('div');
        handles.className = 'focus-layout-offset-handles';
        handles.style.position = 'absolute';
        handles.style.top = '4px';
        handles.style.right = '4px';
        handles.style.display = 'flex';
        handles.style.flexDirection = 'column';
        handles.style.gap = '4px';
        handles.style.pointerEvents = 'none';
        handles.style.zIndex = '25';

        offsetTargets.forEach((target, index) => {
            const handle = document.createElement('div');
            handle.className = 'focus-layout-offset-handle';
            handle.textContent = offsetTargets.length > 1 ? `O${index + 1}` : 'O';
            handle.title = `${target.label} (${target.currentPosition.x}, ${target.currentPosition.y})`;
            handle.setAttribute('data-layout-kind', 'offset');
            handle.setAttribute('data-layout-key', target.key);
            handle.setAttribute('data-layout-editable', 'true');
            handle.setAttribute('data-layout-source-file', target.sourceFile);
            handle.setAttribute('data-layout-source-start', `${target.sourceStart ?? ''}`);
            handle.setAttribute('data-layout-source-end', `${target.sourceEnd ?? ''}`);
            handle.style.pointerEvents = 'auto';
            handle.style.minWidth = '20px';
            handle.style.height = '20px';
            handle.style.padding = '0 4px';
            handle.style.display = 'flex';
            handle.style.alignItems = 'center';
            handle.style.justifyContent = 'center';
            handle.style.borderRadius = '10px';
            handle.style.background = 'rgba(32, 124, 229, 0.9)';
            handle.style.border = '1px solid rgba(255, 255, 255, 0.35)';
            handle.style.color = '#fff';
            handle.style.fontSize = '10px';
            handle.style.fontWeight = '700';
            handle.style.lineHeight = '1';
            handle.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.35)';
            handle.style.userSelect = 'none';
            handles.appendChild(handle);
        });

        host.appendChild(handles);
    }
}

function syncContinuousLayoutTarget(focusTree: FocusTree) {
    const continuous = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    if (!continuous) {
        return;
    }

    const layout = focusTree.continuousFocusLayout;
    if (!layout || focusTree.continuousFocusPositionX === undefined || focusTree.continuousFocusPositionY === undefined || continuous.style.display === 'none') {
        continuous.removeAttribute('data-layout-kind');
        continuous.removeAttribute('data-layout-key');
        continuous.removeAttribute('data-layout-editable');
        continuous.removeAttribute('data-layout-source-file');
        continuous.removeAttribute('data-layout-source-start');
        continuous.removeAttribute('data-layout-source-end');
        continuous.classList.remove('focus-layout-target');
        continuous.style.pointerEvents = 'none';
        return;
    }

    continuous.setAttribute('data-layout-kind', 'continuous');
    continuous.setAttribute('data-layout-key', layout.editKey);
    continuous.setAttribute('data-layout-editable', layout.editable && layout.sourceFile === focusLayoutActiveFile ? 'true' : 'false');
    continuous.setAttribute('data-layout-source-file', layout.sourceFile);
    continuous.setAttribute('data-layout-source-start', `${layout.sourceRange?.start ?? ''}`);
    continuous.setAttribute('data-layout-source-end', `${layout.sourceRange?.end ?? ''}`);
    continuous.classList.add('focus-layout-target');
    continuous.style.pointerEvents = focusLayoutEditMode ? 'auto' : 'none';
}

function renderLayoutSelection() {
    document.querySelectorAll<HTMLElement>('[data-layout-key]').forEach(element => {
        element.style.boxShadow = '';
        element.style.outline = '';
    });

    if (!focusLayoutEditMode || !focusLayoutSelectedKey) {
        return;
    }

    const selected = document.querySelector<HTMLElement>(`[data-layout-key="${cssEscape(focusLayoutSelectedKey)}"]`);
    if (!selected) {
        return;
    }

    selected.style.boxShadow = '0 0 0 2px var(--vscode-focusBorder), 0 0 0 5px rgba(87, 148, 242, 0.2)';
    selected.style.outline = '1px solid rgba(87, 148, 242, 0.4)';
}

function updateLayoutToolbar() {
    if (!focusLayoutEditorEnabled) {
        return;
    }

    const editButton = document.getElementById('focus-layout-edit') as HTMLButtonElement | null;
    if (!editButton) {
        return;
    }

    editButton.textContent = feLocalize('TODO', 'Edit');
    editButton.setAttribute('aria-pressed', focusLayoutEditMode ? 'true' : 'false');
    editButton.disabled = focusLayoutApplying;
    editButton.title = focusLayoutEditMode
        ? feLocalize('TODO', 'Disable layout editing')
        : feLocalize('TODO', 'Enable layout editing');
    editButton.style.background = focusLayoutEditMode ? 'var(--vscode-button-secondaryBackground)' : 'transparent';
    editButton.style.color = focusLayoutEditMode ? 'var(--vscode-button-secondaryForeground)' : '';
    editButton.style.border = focusLayoutEditMode ? '1px solid var(--vscode-focusBorder)' : '1px solid transparent';
    editButton.style.borderRadius = '4px';
    editButton.style.padding = '0 8px';
    editButton.style.minWidth = '48px';
    editButton.style.opacity = focusLayoutApplying ? '0.7' : '1';
}

function updateLayoutPointerInterlocks() {
    setPreviewPanDisabled(focusLayoutEditMode || focusLayoutApplying);

    document.querySelectorAll<HTMLElement>('[data-layout-key]').forEach(element => {
        const editable = element.dataset.layoutEditable === 'true';
        if (focusLayoutEditMode && editable) {
            element.style.cursor = 'grab';
        } else if (focusLayoutEditMode) {
            element.style.cursor = 'not-allowed';
        } else {
            element.style.cursor = '';
        }
    });
}

function getLayoutTargetElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
    const dragger = document.getElementById('dragger') as HTMLDivElement | null;
    const previousPointerEvents = dragger?.style.pointerEvents ?? '';
    if (dragger) {
        dragger.style.pointerEvents = 'none';
    }

    const target = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-layout-key]') ?? null;

    if (dragger) {
        dragger.style.pointerEvents = previousPointerEvents;
    }

    return target;
}

function getLayoutTargetElementFromMouseEvent(event: MouseEvent): HTMLElement | null {
    return (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-layout-key]')
        ?? getLayoutTargetElementAtPoint(event.clientX, event.clientY);
}

function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
}

function calculateFocusAllowed(focusTree: FocusTree, allowBranchOptionsValue: Record<string, boolean>) {
    const focuses = focusTree.focuses;

    let changed = true;
    while (changed) {
        changed = false;
        for (const key in focuses) {
            const focus = focuses[key];
            if (focus.prerequisite.length === 0) {
                continue;
            }

            if (focus.id in allowBranchOptionsValue) {
                continue;
            }

            let allow = true;
            for (const andPrerequests of focus.prerequisite) {
                if (andPrerequests.length === 0) {
                    continue;
                }
                allow = allow && andPrerequests.some(p => allowBranchOptionsValue[p] === true);
                const deny = andPrerequests.every(p => allowBranchOptionsValue[p] === false);
                if (deny) {
                    allowBranchOptionsValue[focus.id] = false;
                    changed = true;
                    break;
                }
            }
            if (allow) {
                allowBranchOptionsValue[focus.id] = true;
                changed = true;
            }
        }
    }
}

function updateSelectedFocusTree(clearCondition: boolean) {
    const focusTree = getRenderedFocusTree(focusTrees[selectedFocusTreeIndex]);
    const continuousFocuses = document.getElementById('continuousFocuses') as HTMLDivElement;

    if (focusTree.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        continuousFocuses.style.left = (focusTree.continuousFocusPositionX - 59) + 'px';
        continuousFocuses.style.top = (focusTree.continuousFocusPositionY + 7) + 'px';
        continuousFocuses.style.display = 'block';
    } else {
        continuousFocuses.style.display = 'none';
    }

    if (useConditionInFocus) {
        const conditionExprs = dedupeConditionExprs(focusTree.conditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));
        const currentInlayConditionExprs = dedupeConditionExprs(focusTree.inlayConditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));

        const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
        }

        if (conditions) {
            conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs.map(option =>
                    `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`
                ).join('')}`;
            conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }

        const inlayConditionContainerElement = document.getElementById('inlay-condition-container') as HTMLDivElement | null;
        if (inlayConditionContainerElement) {
            inlayConditionContainerElement.style.display = showInlayWindows() && currentInlayConditionExprs.length > 0 ? 'block' : 'none';
        }

        if (inlayConditions) {
            inlayConditions.select.innerHTML = `<span class="value"></span>
                ${currentInlayConditionExprs.map(option =>
                    `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`
                ).join('')}`;
            inlayConditions.selectedValues$.next(clearCondition ? [] : selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }

    } else {
        const allowBranchesContainerElement = document.getElementById('allowbranch-container') as HTMLDivElement | null;
        if (allowBranchesContainerElement) {
            allowBranchesContainerElement.style.display = focusTree.allowBranchOptions.length > 0 ? 'block' : 'none';
        }

        if (allowBranches) {
            allowBranches.select.innerHTML = `<span class="value"></span>
                ${focusTree.allowBranchOptions.map(option => `<div class="option" value="inbranch_${option}">${option}</div>`).join('')}`;
            allowBranches.selectAll();
        }
    }

    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLSelectElement | null;
    const inlayWindowsContainerElement = document.getElementById('inlay-window-container') as HTMLDivElement | null;
    const showInlayWindowsContainerElement = document.getElementById('show-inlay-windows-container') as HTMLDivElement | null;
    if (showInlayWindowsContainerElement) {
        showInlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'flex' : 'none';
    }
    if (inlayWindowsContainerElement) {
        inlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'block' : 'none';
    }
    if (inlayWindowsElement) {
        inlayWindowsElement.innerHTML = focusTree.inlayWindows.map(inlay => `<option value="${inlay.id}">${inlay.id}</option>`).join('');
        const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
        if (selectedInlayWindowId) {
            inlayWindowsElement.value = selectedInlayWindowId;
            setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
        }
    }

    const warnings = document.getElementById('warnings') as HTMLTextAreaElement | null;
    if (warnings) {
        warnings.value = focusTree.warnings.length === 0 ? feLocalize('worldmap.warnings.nowarnings', 'No warnings.') :
            focusTree.warnings.map(w => `[${w.source}] ${w.text}`).join('\n');
    }
}

function getFocusPosition(
    focus: Focus | undefined,
    positionByFocusId: Record<string, NumberPosition>,
    focusTree: FocusTree,
    focusStack: Focus[] = [],
    exprs: ConditionItem[],
): NumberPosition {
    if (focus === undefined) {
        return { x: 0, y: 0 };
    }

    const cached = positionByFocusId[focus.id];
    if (cached) {
        return cached;
    }

    if (focusStack.includes(focus)) {
        return { x: 0, y: 0 };
    }

    let position: NumberPosition = { x: focus.x, y: focus.y };
    if (focus.relativePositionId !== undefined) {
        focusStack.push(focus);
        const relativeFocusPosition = getFocusPosition(focusTree.focuses[focus.relativePositionId], positionByFocusId, focusTree, focusStack, exprs);
        focusStack.pop();
        position.x += relativeFocusPosition.x;
        position.y += relativeFocusPosition.y;
    }

    for (const offset of focus.offset) {
        if (offset.trigger !== undefined && applyCondition(offset.trigger, exprs)) {
            position.x += offset.x;
            position.y += offset.y;
        }
    }

    positionByFocusId[focus.id] = position;
    return position;
}

function getFocusIcon(focus: Focus, exprs: ConditionItem[], styleTable: StyleTable): string {
    for (const icon of focus.icon) {
        if (applyCondition(icon.condition, exprs)) {
            const iconName = icon.icon;
            return styleTable.name('focus-icon-' + normalizeForStyle(iconName ?? '-empty'));
        }
    }

    return styleTable.name('focus-icon-' + normalizeForStyle('-empty'));
}

function focusToGridItem(
    focus: Focus,
    focusTree: FocusTree,
    allowBranchOptionsValue: Record<string, boolean>,
    positionByFocusId: Record<string, NumberPosition>,
    exprs: ConditionItem[],
): GridBoxItem | undefined {
    if (useConditionInFocus && allowBranchOptionsValue[focus.id] === false) {
        return undefined;
    }

    const classNames = focus.inAllowBranch.map(v => 'inbranch_' + v).join(' ');
    const connections: GridBoxConnection[] = [];

    for (const prerequisites of focus.prerequisite) {
        const style = prerequisites.length > 1 ? "1px dashed #88aaff" : "1px solid #88aaff";

        prerequisites.forEach(p => {
            const fp = focusTree.focuses[p];
            const classNames2 = fp?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
            connections.push({
                target: p,
                targetType: 'parent',
                style: style,
                classNames: classNames + ' ' + classNames2,
            });
        });
    }

    focus.exclusive.forEach(e => {
        const fe = focusTree.focuses[e];
        const classNames2 = fe?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid red",
            classNames: classNames + ' ' + classNames2,
        });
    });

    const position = getFocusPosition(focus, positionByFocusId, focusTree, [], exprs);

    return {
        id: focus.id,
        htmlId: 'focus_' + focus.id,
        classNames: classNames + ' focus',
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}

function clearCheckedFocuses() {
    for (const focusId in checkedFocuses) {
        checkedFocuses[focusId].dispose();
    }
    checkedFocuses = {};
}

function setupCheckedFocuses(focuses: Focus[], focusTree: FocusTree) {
    const focusCheckState = getState().checkedFocuses ?? {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${normalizeForStyle(focus.id)}`) as HTMLInputElement;
        if (checkbox) {
            if (focusTree.conditionExprs.some(e => e.scopeName === '' && e.nodeContent === 'has_completed_focus = ' + focus.id)) {
                checkbox.checked = !!focusCheckState[focus.id];
                const checkboxItem = new Checkbox(checkbox);
                checkedFocuses[focus.id] = checkboxItem;
                checkbox.addEventListener('change', async () => {
                    if (checkbox.checked) {
                        for (const exclusiveFocus of focus.exclusive) {
                            const exclusiveCheckbox = checkedFocuses[exclusiveFocus];
                            if (exclusiveCheckbox) {
                                exclusiveCheckbox.input.checked = false;
                                focusCheckState[exclusiveFocus] = false;
                            }
                        }
                    }
                    focusCheckState[focus.id] = checkbox.checked;
                    setState({ checkedFocuses: focusCheckState });

                    const rect = checkbox.getBoundingClientRect();
                    const oldLeft = rect.left;
                    const oldTop = rect.top;
                    await buildContent();

                    const newCheckbox = document.getElementById(`checkbox-${normalizeForStyle(focus.id)}`) as HTMLInputElement;
                    if (newCheckbox) {
                        const newRect = newCheckbox.getBoundingClientRect();
                        window.scrollBy(newRect.left - oldLeft, newRect.top - oldTop);
                    }

                    retriggerSearch();
                });
            } else {
                checkbox.parentElement?.remove();
            }
        }
    }
}

function dedupeConditionExprs(exprs: ConditionItem[]): ConditionItem[] {
    const result: ConditionItem[] = [];
    for (const expr of exprs) {
        if (!result.some(existing => existing.scopeName === expr.scopeName && existing.nodeContent === expr.nodeContent)) {
            result.push(expr);
        }
    }

    return result;
}

function renderInlayWindows(focusTree: FocusTree, exprs: ConditionItem[]): string {
    if (!showInlayWindows()) {
        return '';
    }

    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
    if (!selectedInlayWindowId) {
        return '';
    }

    const selectedInlayWindow = focusTree.inlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow || !applyCondition(selectedInlayWindow.visible, exprs)) {
        return '';
    }

    const renderedInlayWindows: Record<string, string> = (window as any).renderedInlayWindows ?? {};
    const template = renderedInlayWindows[selectedInlayWindow.id] ?? '';
    return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return content.split(`{{inlay_slot_class:${slot.id}}}`).join(activeOption ? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile) : '');
    }, template);
}

function getActiveInlayOption<T extends { condition: any }>(options: T[], exprs: ConditionItem[]): T | undefined {
    for (const option of options) {
        if (applyCondition(option.condition, exprs)) {
            return option;
        }
    }

    return undefined;
}

function getInlayGfxClassName(gfxName: string | undefined, gfxFile: string | undefined): string {
    return 'st-inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}

let retriggerSearch: () => void = () => {};

function setupLayoutInteractionHandlers() {
    if (!focusLayoutEditorEnabled) {
        return;
    }

    document.addEventListener('click', event => {
        if (!focusLayoutEditMode) {
            return;
        }

        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-layout-key]');
        if (!target) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        focusLayoutSelectedKey = target.dataset.layoutKey;
        persistLayoutState();
        renderLayoutSelection();
        updateLayoutToolbar();
    }, true);

    document.addEventListener('mousedown', event => {
        if (!focusLayoutEditMode || focusLayoutApplying || event.button !== 0) {
            return;
        }

        if ((event.target as HTMLElement | null)?.closest('input, select, button, textarea, option')) {
            return;
        }

        const target = getLayoutTargetElementFromMouseEvent(event);
        const key = target?.dataset.layoutKey;
        if (!target || !key) {
            return;
        }

        const descriptor = currentLayoutTargets[key];
        if (!descriptor) {
            return;
        }

        focusLayoutSelectedKey = key;
        persistLayoutState();
        renderLayoutSelection();
        updateLayoutToolbar();

        if (!descriptor.editable) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        beginLayoutDrag(descriptor, target, event.pageX, event.pageY);
    }, true);
}

function beginLayoutDrag(target: LayoutTargetDescriptor, dragElement: HTMLElement | null, startPageX: number, startPageY: number) {
    const draft = ensureLayoutDraft();
    let draftChanged = false;

    if (dragElement) {
        dragElement.style.willChange = 'transform';
        dragElement.style.zIndex = '20';
        dragElement.style.cursor = 'grabbing';
    }

    const mouseMoveHandler = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.pageX - startPageX;
        const deltaY = moveEvent.pageY - startPageY;

        if (dragElement) {
            dragElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        }

        const nextPosition = calculateDraggedLayoutPosition(target, deltaX, deltaY, {
            scale: getState().scale || 1,
            xGridSize,
            yGridSize,
        });
        applyDraggedLayoutPosition(draft, target, nextPosition);
        draftChanged = nextPosition.x !== target.currentPosition.x || nextPosition.y !== target.currentPosition.y;
    };

    const mouseUpHandler = () => {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
        if (dragElement) {
            dragElement.style.transform = '';
            dragElement.style.willChange = '';
            dragElement.style.zIndex = '';
            dragElement.style.cursor = '';
        }

        if (!draftChanged) {
            focusLayoutDraft = undefined;
            persistLayoutState();
            updateLayoutToolbar();
            updateLayoutPointerInterlocks();
            return;
        }

        applyCurrentLayoutDraft();
    };

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
}

function applyCurrentLayoutDraft() {
    if (!focusLayoutDraft || focusLayoutApplying) {
        return;
    }

    focusLayoutApplying = true;
    persistLayoutState();
    updateLayoutToolbar();
    updateLayoutPointerInterlocks();
    void buildContent();
    vscode.postMessage({
        command: 'focusLayoutApply',
        draft: focusLayoutDraft,
    });
}

function setFocusLayoutEditMode(enabled: boolean) {
    focusLayoutEditMode = enabled;
    if (!enabled) {
        focusLayoutDraft = undefined;
        focusLayoutSelectedKey = undefined;
        focusLayoutApplying = false;
    }
    persistLayoutState();
    updateLayoutPointerInterlocks();
}

window.addEventListener('load', tryRun(async function() {
    setupLayoutInteractionHandlers();

    const showInlayWindowsElement = document.getElementById('show-inlay-windows') as HTMLInputElement | null;
    if (showInlayWindowsElement) {
        (window as any).__showInlayWindows = !!getState().showInlayWindows;
        showInlayWindowsElement.checked = !!(window as any).__showInlayWindows;
        showInlayWindowsElement.addEventListener('change', async () => {
            (window as any).__showInlayWindows = showInlayWindowsElement.checked;
            setState({ showInlayWindows: showInlayWindowsElement.checked });
            updateSelectedFocusTree(false);
            await buildContent();
            retriggerSearch();
        });
    }

    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    if (focusesElement) {
        focusesElement.value = selectedFocusTreeIndex.toString();
        focusesElement.addEventListener('change', async () => {
            selectedFocusTreeIndex = parseInt(focusesElement.value);
            setState({ selectedFocusTreeIndex });
            focusLayoutSelectedKey = undefined;
            updateSelectedFocusTree(true);
            await buildContent();
            retriggerSearch();
        });
    }

    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLSelectElement | null;
    if (inlayWindowsElement) {
        inlayWindowsElement.addEventListener('change', async () => {
            const focusTree = focusTrees[selectedFocusTreeIndex];
            setSelectedInlayWindowId(focusTree, inlayWindowsElement.value);
            focusLayoutSelectedKey = undefined;
            await buildContent();
            retriggerSearch();
        });
    }

    if (!useConditionInFocus) {
        const hiddenBranches = getState().hiddenBranches || {};
        for (const key in hiddenBranches) {
            showBranch(false, key);
        }

        const allowBranchesElement = document.getElementById('allowbranch') as HTMLDivElement | null;
        if (allowBranchesElement) {
            allowBranches = new DivDropdown(allowBranchesElement, true);
            allowBranches.selectAll();

            const allValues = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.next(allValues.filter(v => !hiddenBranches[v]));

            let oldSelection = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.subscribe(selection => {
                const showBranches = difference(selection, oldSelection);
                showBranches.forEach(s => showBranch(true, s));
                const hideBranches = difference(oldSelection, selection);
                hideBranches.forEach(s => showBranch(false, s));
                oldSelection = selection;

                const hiddenBranches = difference(allValues, selection);
                setState({ hiddenBranches });
            });
        }
    }

    const searchbox = document.getElementById('searchbox') as HTMLInputElement;
    let currentNavigatedIndex = 0;
    let oldSearchboxValue: string = getState().searchboxValue || '';
    let searchedFocus: HTMLDivElement[] = search(oldSearchboxValue, false);

    searchbox.value = oldSearchboxValue;

    const searchboxChangeFunc = function(this: HTMLInputElement) {
        const searchboxValue = this.value.toLowerCase();
        if (oldSearchboxValue !== searchboxValue) {
            currentNavigatedIndex = 0;
            searchedFocus = search(searchboxValue);
            oldSearchboxValue = searchboxValue;
            setState({ searchboxValue });
        }
    };

    searchbox.addEventListener('change', searchboxChangeFunc);
    searchbox.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const visibleSearchedFocus = searchedFocus.filter(f => f.style.display !== 'none');
            if (visibleSearchedFocus.length > 0) {
                currentNavigatedIndex = (currentNavigatedIndex + (e.shiftKey ? visibleSearchedFocus.length - 1 : 1)) % visibleSearchedFocus.length;
                visibleSearchedFocus[currentNavigatedIndex].scrollIntoView({ block: "center", inline: "center" });
            }
        } else {
            searchboxChangeFunc.apply(this);
        }
    });
    searchbox.addEventListener('keyup', searchboxChangeFunc);
    searchbox.addEventListener('paste', searchboxChangeFunc);
    searchbox.addEventListener('cut', searchboxChangeFunc);

    retriggerSearch = () => { searchedFocus = search(oldSearchboxValue, false); };

    if (useConditionInFocus) {
        const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
        if (conditionsElement) {
            conditions = new DivDropdown(conditionsElement, true);

            conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            conditions.selectedValues$.subscribe(async (selection) => {
                selectedExprs = selection.map<ConditionItem>(selection => {
                    const index = selection.indexOf('!|');
                    if (index === -1) {
                        return {
                            scopeName: '',
                            nodeContent: selection,
                        };
                    }

                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                });

                setState({ selectedExprs });

                await buildContent();
                retriggerSearch();
            });
        }

        const inlayConditionsElement = document.getElementById('inlay-conditions') as HTMLDivElement | null;
        if (inlayConditionsElement) {
            inlayConditions = new DivDropdown(inlayConditionsElement, true);

            inlayConditions.selectedValues$.next(selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            inlayConditions.selectedValues$.subscribe(async (selection) => {
                selectedInlayExprs = selection.map<ConditionItem>(selection => {
                    const index = selection.indexOf('!|');
                    if (index === -1) {
                        return {
                            scopeName: '',
                            nodeContent: selection,
                        };
                    }

                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                });

                setState({ selectedInlayExprs });

                await buildContent();
                retriggerSearch();
            });
        }
    }

    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
    enableZoom(contentElement, 0, 40);
    updateLayoutPointerInterlocks();

    const showWarnings = document.getElementById('show-warnings') as HTMLButtonElement;
    if (showWarnings) {
        const warnings = document.getElementById('warnings-container') as HTMLDivElement;
        showWarnings.addEventListener('click', () => {
            const visible = warnings.style.display === 'block';
            document.body.style.overflow = visible ? '' : 'hidden';
            warnings.style.display = visible ? 'none' : 'block';
        });
    }

    if (focusLayoutEditorEnabled) {
        const editButton = document.getElementById('focus-layout-edit') as HTMLButtonElement | null;
        editButton?.addEventListener('click', async () => {
            setFocusLayoutEditMode(!focusLayoutEditMode);
            await buildContent();
        });

        window.addEventListener('message', event => {
            const message = event.data as FocusLayoutMessage | undefined;
            if (!message || message.command !== 'focusLayoutApplyResult') {
                return;
            }

            focusLayoutApplying = false;
            if (message.ok) {
                focusLayoutDraft = undefined;
            } else {
                focusLayoutDraft = undefined;
                vscode.postMessage({ command: 'reload' });
            }

            persistLayoutState();
            updateLayoutToolbar();
            updateLayoutPointerInterlocks();
            void buildContent();
        });
    }

    updateSelectedFocusTree(false);
    await buildContent();
    scrollToState();
}));
