import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom } from "./util/common";
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
    FocusLayoutFocusDraft,
    FocusLayoutMessage,
    FocusLayoutOffsetDraft,
    FocusLayoutPointDraft,
} from "../src/previewdef/focustree/layouteditcommon";

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
const focusLayoutDocumentVersion: number = (window as any).focusLayoutDocumentVersion ?? 0;
const xGridSize: number = (window as any).xGridSize;
const yGridSize: number = (window as any).yGridSize ?? 130;

interface LayoutTargetDescriptor {
    key: string;
    kind: 'focus' | 'continuous' | 'inlayRef';
    label: string;
    editable: boolean;
    sourceFile: string;
    sourceStart?: number;
    sourceEnd?: number;
    currentPosition: NumberPosition;
    focusId?: string;
}

let focusLayoutEditMode = focusLayoutEditorEnabled && !!getState().focusLayoutEditMode;
let focusLayoutDraft = restoreLayoutDraft();
let focusLayoutSelectedKey: string | undefined = getState().focusLayoutSelectedKey;
let focusLayoutStale = !!getState().focusLayoutStale;
let focusLayoutStatusMessage: string | undefined = getState().focusLayoutStatusMessage;
let focusLayoutPendingApplyVersion: number | undefined = getState().focusLayoutPendingApplyVersion;
let currentLayoutTargets: Record<string, LayoutTargetDescriptor> = {};

if (focusLayoutPendingApplyVersion !== undefined && focusLayoutDocumentVersion >= focusLayoutPendingApplyVersion) {
    focusLayoutDraft = undefined;
    focusLayoutEditMode = false;
    focusLayoutSelectedKey = undefined;
    focusLayoutStale = false;
    focusLayoutStatusMessage = undefined;
    focusLayoutPendingApplyVersion = undefined;
    persistLayoutState();
} else if (focusLayoutDraft && focusLayoutDraft.baseVersion !== focusLayoutDocumentVersion) {
    focusLayoutStale = true;
}

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

function restoreLayoutDraft(): FocusLayoutDraft | undefined {
    const stored = getState().focusLayoutDraft as FocusLayoutDraft | undefined;
    if (!stored) {
        return undefined;
    }

    return stored;
}

function persistLayoutState() {
    setState({
        focusLayoutDraft,
        focusLayoutEditMode,
        focusLayoutSelectedKey,
        focusLayoutStale,
        focusLayoutStatusMessage,
        focusLayoutPendingApplyVersion,
    });
}

function createLayoutDraftFromFocusTrees(): FocusLayoutDraft {
    const draft: FocusLayoutDraft = {
        baseVersion: focusLayoutDocumentVersion,
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
    if (!focusLayoutDraft || focusLayoutDraft.baseVersion !== focusLayoutDocumentVersion) {
        focusLayoutDraft = createLayoutDraftFromFocusTrees();
    }

    return focusLayoutDraft;
}

function postDraftChange() {
    if (!focusLayoutDraft) {
        return;
    }

    persistLayoutState();
    vscode.postMessage({
        command: 'focusLayoutDraftChange',
        draft: focusLayoutDraft,
    });
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
                return { x: offsetDraft.x, y: offsetDraft.y, trigger: undefined };
            }

            const offsetIndex = layoutOffsets.findIndex(offset => offset.editKey === offsetDraft.editKey);
            const originalOffset = offsetIndex >= 0 ? focus.offset[offsetIndex] : undefined;
            return {
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
    currentLayoutTargets = createLayoutTargetIndex(focusTree, focusPosition);
    syncContinuousLayoutTarget(focusTree);
    if (focusLayoutSelectedKey && !currentLayoutTargets[focusLayoutSelectedKey]) {
        focusLayoutSelectedKey = undefined;
    }
    renderLayoutSelection();
    renderLayoutInspector();
    updateLayoutToolbar();
    persistLayoutState();
}

function createLayoutTargetIndex(focusTree: FocusTree, focusPosition: Record<string, NumberPosition>): Record<string, LayoutTargetDescriptor> {
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
            editable: focus.layout?.editable === true && focus.layout.sourceFile === focusLayoutActiveFile && !focusLayoutStale,
            sourceFile: focus.layout?.sourceFile ?? focus.file,
            sourceStart: focus.layout?.sourceRange?.start ?? focus.token?.start,
            sourceEnd: focus.layout?.sourceRange?.end ?? focus.token?.end,
            currentPosition: position,
            focusId: focus.id,
        };
    }

    if (focusTree.continuousFocusLayout && focusTree.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        result[focusTree.continuousFocusLayout.editKey] = {
            key: focusTree.continuousFocusLayout.editKey,
            kind: 'continuous',
            label: focusTree.continuousFocusLayout.label,
            editable: focusTree.continuousFocusLayout.editable && focusTree.continuousFocusLayout.sourceFile === focusLayoutActiveFile && !focusLayoutStale,
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
            editable: inlay.layout.editable && inlay.layout.sourceFile === focusLayoutActiveFile && !focusLayoutStale,
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
    continuous.setAttribute('data-layout-editable', layout.editable && layout.sourceFile === focusLayoutActiveFile && !focusLayoutStale ? 'true' : 'false');
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

    if (!focusLayoutSelectedKey) {
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
    const applyButton = document.getElementById('focus-layout-apply') as HTMLButtonElement | null;
    const discardButton = document.getElementById('focus-layout-discard') as HTMLButtonElement | null;
    if (!editButton || !applyButton || !discardButton) {
        return;
    }

    editButton.textContent = focusLayoutEditMode ? feLocalize('TODO', 'Editing Layout') : feLocalize('TODO', 'Edit Layout');
    editButton.disabled = focusLayoutEditMode;
    applyButton.style.display = focusLayoutEditMode ? '' : 'none';
    discardButton.style.display = focusLayoutEditMode ? '' : 'none';
    applyButton.disabled = !focusLayoutDraft || focusLayoutStale || focusLayoutPendingApplyVersion !== undefined;
}

function renderLayoutInspector() {
    if (!focusLayoutEditorEnabled) {
        return;
    }

    const inspector = document.getElementById('focus-layout-inspector') as HTMLDivElement | null;
    const content = document.getElementById('focus-layout-inspector-content') as HTMLDivElement | null;
    if (!inspector || !content) {
        return;
    }

    if (!focusLayoutEditMode) {
        inspector.style.display = 'none';
        return;
    }

    inspector.style.display = 'block';
    const selected = focusLayoutSelectedKey ? currentLayoutTargets[focusLayoutSelectedKey] : undefined;
    const staleBanner = focusLayoutStale ? `
        <div style="padding:8px 10px; margin-bottom:10px; border-radius:6px; background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder);">
            <div style="margin-bottom:6px;">${feLocalize('TODO', 'The document changed while this draft was open.')}</div>
            <button id="focus-layout-reload">${feLocalize('TODO', 'Reload From Document')}</button>
            <button id="focus-layout-discard-stale" style="margin-left:6px;">${feLocalize('TODO', 'Discard Draft')}</button>
        </div>` : '';
    const status = focusLayoutStatusMessage ? `<div style="margin-bottom:10px; color: var(--vscode-descriptionForeground);">${escapeHtml(focusLayoutStatusMessage)}</div>` : '';

    if (!selected) {
        content.innerHTML = `${staleBanner}${status}
            <h3 style="margin-top:0;">${feLocalize('TODO', 'Focus Layout Editor')}</h3>
            <p style="margin-bottom:0;">${feLocalize('TODO', 'Select a focus, continuous focus area, or inlay window to edit its layout fields.')}</p>`;
        wireLayoutInspectorActions();
        return;
    }

    if (selected.kind === 'focus') {
        const focusDraft = focusLayoutDraft?.focuses[selected.key];
        content.innerHTML = `${staleBanner}${status}${renderFocusLayoutInspector(selected, focusDraft)}`;
    } else {
        const pointDraft = (selected.kind === 'continuous'
            ? focusLayoutDraft?.continuous[selected.key]
            : focusLayoutDraft?.inlayRefs[selected.key]) as FocusLayoutPointDraft | undefined;
        content.innerHTML = `${staleBanner}${status}${renderPointLayoutInspector(selected, pointDraft)}`;
    }

    wireLayoutInspectorActions();
}

function renderFocusLayoutInspector(selected: LayoutTargetDescriptor, focusDraft: FocusLayoutFocusDraft | undefined): string {
    const editable = !!focusDraft?.editable && !focusLayoutStale;
    const activeFocusIds = Object.values(ensureLayoutDraft().focuses)
        .filter(focus => focus.editable && focus.sourceFile === focusLayoutActiveFile)
        .map(focus => focus.focusId)
        .sort((a, b) => a.localeCompare(b));
    const offsetRows = focusDraft?.offsets.map(offset => `
        <div data-offset-key="${escapeHtml(offset.editKey)}" style="display:grid; grid-template-columns: 1fr 1fr auto; gap:6px; margin-bottom:8px; align-items:end;">
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>X</span>
                <input type="number" data-offset-field="x" value="${offset.x}" ${editable ? '' : 'disabled'} />
            </label>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>Y</span>
                <input type="number" data-offset-field="y" value="${offset.y}" ${editable ? '' : 'disabled'} />
            </label>
            <button data-offset-delete="${escapeHtml(offset.editKey)}" ${editable ? '' : 'disabled'}>${feLocalize('TODO', 'Delete')}</button>
            ${offset.hasTrigger ? `<div style="grid-column:1 / span 3; color: var(--vscode-descriptionForeground);">${feLocalize('TODO', 'Trigger is preserved and remains read-only in this preview editor.')}</div>` : ''}
        </div>`).join('') ?? '';

    return `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
            <div>
                <h3 style="margin:0;">${escapeHtml(selected.label)}</h3>
                <div style="color: var(--vscode-descriptionForeground); margin-top:4px;">${feLocalize('TODO', 'Rendered position')}: ${selected.currentPosition.x}, ${selected.currentPosition.y}</div>
            </div>
            <span style="padding:2px 8px; border-radius:999px; background:${editable ? 'var(--vscode-badge-background)' : 'rgba(127,127,127,0.25)'}; color: var(--vscode-badge-foreground);">${editable ? feLocalize('TODO', 'Editable') : feLocalize('TODO', 'Read-only')}</span>
        </div>
        <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
            <div style="font-size:12px; color: var(--vscode-descriptionForeground);">${escapeHtml(selected.sourceFile)}</div>
            <button id="focus-layout-open-source">${feLocalize('TODO', 'Open Source')}</button>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>${feLocalize('TODO', 'Base X')}</span>
                <input id="focus-layout-x" type="number" value="${focusDraft?.x ?? selected.currentPosition.x}" ${editable ? '' : 'disabled'} />
            </label>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>${feLocalize('TODO', 'Base Y')}</span>
                <input id="focus-layout-y" type="number" value="${focusDraft?.y ?? selected.currentPosition.y}" ${editable ? '' : 'disabled'} />
            </label>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>${feLocalize('TODO', 'Relative Position ID')}</span>
                <select id="focus-layout-relative" ${editable ? '' : 'disabled'}>
                    <option value="">${feLocalize('TODO', '(none)')}</option>
                    ${activeFocusIds.map(focusId => `<option value="${escapeHtml(focusId)}" ${focusDraft?.relativePositionId === focusId ? 'selected' : ''}>${escapeHtml(focusId)}</option>`).join('')}
                </select>
            </label>
            <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong>${feLocalize('TODO', 'Offsets')}</strong>
                    <button id="focus-layout-add-offset" ${editable ? '' : 'disabled'}>${feLocalize('TODO', 'Add Offset')}</button>
                </div>
                ${offsetRows || `<div style="color: var(--vscode-descriptionForeground);">${feLocalize('TODO', 'No offsets')}</div>`}
            </div>
        </div>`;
}

function renderPointLayoutInspector(selected: LayoutTargetDescriptor, pointDraft: FocusLayoutPointDraft | undefined): string {
    const editable = !!pointDraft?.editable && !focusLayoutStale;
    return `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
            <div>
                <h3 style="margin:0;">${escapeHtml(selected.label)}</h3>
                <div style="color: var(--vscode-descriptionForeground); margin-top:4px;">${feLocalize('TODO', 'Current position')}: ${selected.currentPosition.x}, ${selected.currentPosition.y}</div>
            </div>
            <span style="padding:2px 8px; border-radius:999px; background:${editable ? 'var(--vscode-badge-background)' : 'rgba(127,127,127,0.25)'}; color: var(--vscode-badge-foreground);">${editable ? feLocalize('TODO', 'Editable') : feLocalize('TODO', 'Read-only')}</span>
        </div>
        <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
            <div style="font-size:12px; color: var(--vscode-descriptionForeground);">${escapeHtml(selected.sourceFile)}</div>
            <button id="focus-layout-open-source">${feLocalize('TODO', 'Open Source')}</button>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>X</span>
                <input id="focus-layout-x" type="number" value="${pointDraft?.x ?? selected.currentPosition.x}" ${editable ? '' : 'disabled'} />
            </label>
            <label style="display:flex; flex-direction:column; gap:4px;">
                <span>Y</span>
                <input id="focus-layout-y" type="number" value="${pointDraft?.y ?? selected.currentPosition.y}" ${editable ? '' : 'disabled'} />
            </label>
        </div>`;
}

function wireLayoutInspectorActions() {
    if (!focusLayoutEditorEnabled) {
        return;
    }

    const reloadButton = document.getElementById('focus-layout-reload') as HTMLButtonElement | null;
    reloadButton?.addEventListener('click', () => {
        focusLayoutDraft = createLayoutDraftFromFocusTrees();
        focusLayoutStale = false;
        focusLayoutStatusMessage = undefined;
        focusLayoutPendingApplyVersion = undefined;
        persistLayoutState();
        vscode.postMessage({ command: 'focusLayoutReload' });
        void buildContent();
    });

    const discardStaleButton = document.getElementById('focus-layout-discard-stale') as HTMLButtonElement | null;
    discardStaleButton?.addEventListener('click', discardLayoutDraft);

    const openSourceButton = document.getElementById('focus-layout-open-source') as HTMLButtonElement | null;
    openSourceButton?.addEventListener('click', () => {
        const target = focusLayoutSelectedKey ? currentLayoutTargets[focusLayoutSelectedKey] : undefined;
        if (!target || target.sourceStart === undefined) {
            return;
        }

        vscode.postMessage({
            command: 'navigate',
            start: target.sourceStart,
            end: target.sourceEnd ?? target.sourceStart,
            file: target.sourceFile === focusLayoutActiveFile ? undefined : target.sourceFile,
        });
    });

    const xInput = document.getElementById('focus-layout-x') as HTMLInputElement | null;
    xInput?.addEventListener('change', () => updateSelectedLayoutScalar('x', parseInt(xInput.value, 10) || 0));

    const yInput = document.getElementById('focus-layout-y') as HTMLInputElement | null;
    yInput?.addEventListener('change', () => updateSelectedLayoutScalar('y', parseInt(yInput.value, 10) || 0));

    const relativeSelect = document.getElementById('focus-layout-relative') as HTMLSelectElement | null;
    relativeSelect?.addEventListener('change', () => {
        if (!focusLayoutSelectedKey) {
            return;
        }
        const draft = ensureLayoutDraft().focuses[focusLayoutSelectedKey];
        if (!draft || !draft.editable || focusLayoutStale) {
            return;
        }
        draft.relativePositionId = relativeSelect.value || null;
        postDraftChange();
        void buildContent();
    });

    const addOffsetButton = document.getElementById('focus-layout-add-offset') as HTMLButtonElement | null;
    addOffsetButton?.addEventListener('click', () => {
        if (!focusLayoutSelectedKey) {
            return;
        }
        const draft = ensureLayoutDraft().focuses[focusLayoutSelectedKey];
        if (!draft || !draft.editable || focusLayoutStale) {
            return;
        }

        draft.offsets.push({
            editKey: `offset:new:${draft.editKey}:${Date.now()}:${draft.offsets.length}`,
            x: 0,
            y: 0,
            hasTrigger: false,
            isNew: true,
        });
        postDraftChange();
        void buildContent();
    });

    document.querySelectorAll<HTMLElement>('[data-offset-key]').forEach(row => {
        const offsetKey = row.getAttribute('data-offset-key');
        if (!offsetKey || !focusLayoutSelectedKey) {
            return;
        }

        const xField = row.querySelector<HTMLInputElement>('[data-offset-field="x"]');
        const yField = row.querySelector<HTMLInputElement>('[data-offset-field="y"]');
        xField?.addEventListener('change', () => updateSelectedOffset(offsetKey, 'x', parseInt(xField.value, 10) || 0));
        yField?.addEventListener('change', () => updateSelectedOffset(offsetKey, 'y', parseInt(yField.value, 10) || 0));
    });

    document.querySelectorAll<HTMLButtonElement>('[data-offset-delete]').forEach(button => {
        const offsetKey = button.getAttribute('data-offset-delete');
        if (!offsetKey) {
            return;
        }
        button.addEventListener('click', () => {
            if (!focusLayoutSelectedKey) {
                return;
            }
            const draft = ensureLayoutDraft().focuses[focusLayoutSelectedKey];
            if (!draft || !draft.editable || focusLayoutStale) {
                return;
            }
            draft.offsets = draft.offsets.filter(offset => offset.editKey !== offsetKey);
            postDraftChange();
            void buildContent();
        });
    });
}

function updateSelectedLayoutScalar(field: 'x' | 'y', value: number) {
    if (!focusLayoutSelectedKey || focusLayoutStale) {
        return;
    }

    const draft = ensureLayoutDraft();
    const target = currentLayoutTargets[focusLayoutSelectedKey];
    if (!target) {
        return;
    }

    if (target.kind === 'focus') {
        const focusDraft = draft.focuses[focusLayoutSelectedKey];
        if (!focusDraft || !focusDraft.editable) {
            return;
        }
        focusDraft[field] = Math.round(value);
    } else {
        const pointDraft = (target.kind === 'continuous' ? draft.continuous[focusLayoutSelectedKey] : draft.inlayRefs[focusLayoutSelectedKey]);
        if (!pointDraft || !pointDraft.editable) {
            return;
        }
        pointDraft[field] = Math.round(value);
    }

    postDraftChange();
    void buildContent();
}

function updateSelectedOffset(offsetKey: string, field: 'x' | 'y', value: number) {
    if (!focusLayoutSelectedKey || focusLayoutStale) {
        return;
    }

    const draft = ensureLayoutDraft().focuses[focusLayoutSelectedKey];
    const offset = draft?.offsets.find(existing => existing.editKey === offsetKey);
    if (!draft || !draft.editable || !offset) {
        return;
    }

    offset[field] = Math.round(value);
    postDraftChange();
    void buildContent();
}

function discardLayoutDraft() {
    focusLayoutDraft = undefined;
    focusLayoutEditMode = false;
    focusLayoutSelectedKey = undefined;
    focusLayoutStale = false;
    focusLayoutStatusMessage = undefined;
    focusLayoutPendingApplyVersion = undefined;
    persistLayoutState();
    vscode.postMessage({ command: 'focusLayoutDiscard' });
    void buildContent();
}

function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
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
        focusLayoutStatusMessage = undefined;
        persistLayoutState();
        renderLayoutSelection();
        renderLayoutInspector();
    }, true);

    document.addEventListener('mousedown', event => {
        if (!focusLayoutEditMode || focusLayoutStale || event.button !== 0) {
            return;
        }

        if ((event.target as HTMLElement | null)?.closest('input, select, button, textarea, option')) {
            return;
        }

        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-layout-key]');
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
        renderLayoutInspector();

        if (!descriptor.editable) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        beginLayoutDrag(descriptor, event.pageX, event.pageY);
    }, true);
}

function beginLayoutDrag(target: LayoutTargetDescriptor, startPageX: number, startPageY: number) {
    const draft = ensureLayoutDraft();
    const scale = getState().scale || 1;
    const focusDraft = target.kind === 'focus' ? draft.focuses[target.key] : undefined;
    const pointDraft = target.kind !== 'focus'
        ? (target.kind === 'continuous' ? draft.continuous[target.key] : draft.inlayRefs[target.key])
        : undefined;

    if ((focusDraft && !focusDraft.editable) || (pointDraft && !pointDraft.editable)) {
        return;
    }

    const baseX = focusDraft?.x ?? pointDraft?.x ?? 0;
    const baseY = focusDraft?.y ?? pointDraft?.y ?? 0;

    const mouseMoveHandler = (moveEvent: MouseEvent) => {
        const deltaX = (moveEvent.pageX - startPageX) / scale;
        const deltaY = (moveEvent.pageY - startPageY) / scale;
        if (target.kind === 'focus' && focusDraft) {
            focusDraft.x = Math.round(baseX + deltaX / xGridSize);
            focusDraft.y = Math.round(baseY + deltaY / yGridSize);
        } else if (pointDraft) {
            pointDraft.x = Math.round(baseX + deltaX);
            pointDraft.y = Math.round(baseY + deltaY);
        }

        focusLayoutStatusMessage = undefined;
        postDraftChange();
        void buildContent();
    };

    const mouseUpHandler = () => {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
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
            if (focusLayoutEditMode) {
                return;
            }

            focusLayoutDraft = createLayoutDraftFromFocusTrees();
            focusLayoutEditMode = true;
            focusLayoutStale = false;
            focusLayoutStatusMessage = undefined;
            focusLayoutPendingApplyVersion = undefined;
            persistLayoutState();
            await buildContent();
        });

        const applyButton = document.getElementById('focus-layout-apply') as HTMLButtonElement | null;
        applyButton?.addEventListener('click', () => {
            if (!focusLayoutDraft || focusLayoutStale) {
                return;
            }

            focusLayoutStatusMessage = undefined;
            focusLayoutPendingApplyVersion = focusLayoutDocumentVersion + 1;
            persistLayoutState();
            vscode.postMessage({
                command: 'focusLayoutApply',
                draft: focusLayoutDraft,
            });
            renderLayoutInspector();
            updateLayoutToolbar();
        });

        const discardButton = document.getElementById('focus-layout-discard') as HTMLButtonElement | null;
        discardButton?.addEventListener('click', discardLayoutDraft);

        window.addEventListener('message', event => {
            const message = event.data as FocusLayoutMessage | undefined;
            if (!message || message.command !== 'focusLayoutApplyResult') {
                return;
            }

            if (message.ok) {
                focusLayoutDraft = undefined;
                focusLayoutEditMode = false;
                focusLayoutSelectedKey = undefined;
                focusLayoutStale = false;
                focusLayoutStatusMessage = message.message;
                focusLayoutPendingApplyVersion = undefined;
            } else {
                focusLayoutPendingApplyVersion = undefined;
                focusLayoutStale = !!message.stale;
                focusLayoutStatusMessage = message.message ?? feLocalize('TODO', 'Failed to apply the layout draft.');
            }

            persistLayoutState();
            void buildContent();
        });
    }

    updateSelectedFocusTree(false);
    await buildContent();
    scrollToState();
}));
