import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom, setPreviewPanDisabled, startPreviewPan } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { difference } from "lodash";
import { renderGridBoxCommon } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable, normalizeForStyle } from "../src/util/styletable";
import { FocusTree, Focus } from "../src/previewdef/focustree/schema";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { Checkbox } from "./util/checkbox";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import {
    FocusConditionPreset,
    FocusConditionPresetsByTree,
    filterConditionPresetExprKeys,
    findMatchingConditionPreset,
    normalizeConditionExprKeys,
    normalizeConditionPresetsByTree,
} from "../src/previewdef/focustree/conditionpresets";
import { getCachedFocusTreeLayoutPlan, invalidateCachedFocusTreeLayoutPlan } from "../src/previewdef/focustree/layoutplan";
import { collectCompletedFocusIds } from "../src/previewdef/focustree/conditionexprs";
import { shouldHydrateFocus as shouldHydrateFocusValue } from "../src/previewdef/focustree/focushydration";
import { getLocalPositionFromRenderedAbsolute } from "../src/previewdef/focustree/positioning";
import { getTopMostFocusAnchorId } from "../src/previewdef/focustree/relationanchor";
import { getDirectlyRelatedFocusIds } from "../src/previewdef/focustree/hoverrelations";
import { clampFocusTreeIndex as clampFocusTreeIndexValue, resolveFocusTreeSelection as resolveFocusTreeSelectionValue } from "../src/previewdef/focustree/selectionstate";
import { FocusTreeContentUpdateDecision, FocusTreeContentUpdateMessage, getFocusTreeContentUpdateDecision } from "../src/previewdef/focustree/webviewupdate";

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
let focusTrees: FocusTree[] = (window as any).focusTrees;
type PendingFocusLinkType = 'prerequisite' | 'exclusive';
const restoredState = getState();

let selectedExprs: ConditionItem[] = restoredState.selectedExprs ?? [];
let conditionPresetsByTree: FocusConditionPresetsByTree = normalizeConditionPresetsByTree(
    restoredState.conditionPresetsByTree ?? (window as any).persistedConditionPresetsByTree ?? {},
);
let selectedFocusTreeIndex: number = restoredState.selectedFocusTreeIndex ?? 0;
let selectedFocusTreeId: string | undefined = restoredState.selectedFocusTreeId;
let selectedFocusIdsByTree: Record<string, string[]> = restoredState.selectedFocusIdsByTree ?? {};
let allowBranches: DivDropdown | undefined = undefined;
let conditions: DivDropdown | undefined = undefined;
let conditionPresetsDropdown: DivDropdown | undefined = undefined;
let inlayWindows: DivDropdown | undefined = undefined;
let checkedFocuses: Record<string, Checkbox> = {};
let focusPositionEditMode: boolean = !!restoredState.focusPositionEditMode;
let currentRenderedFocusTree: FocusTree | undefined = undefined;
let currentFocusPositions: Record<string, NumberPosition> = {};
let currentRenderedFocusElements: Record<string, HTMLElement> = {};
let currentRenderedFocusElementsList: HTMLElement[] = [];
let currentOccupiedFocusPositionKeys = new Set<string>();
let currentSelectedFocusIds = new Set<string>();
let currentRenderedExprs: ConditionItem[] = [];
let currentCompletableFocusIds: ReadonlySet<string> = new Set();
let focusPositionDragBindings: Array<{ element: HTMLElement; eventName: 'mousedown' | 'pointerdown'; handler: EventListener }> = [];
let focusPositionDocumentVersion: number = (window as any).focusPositionDocumentVersion ?? 0;
let suppressEditableFocusClickUntil = 0;
let pendingFocusLinkParentId: string | undefined = undefined;
let pendingFocusLinkParentIds: string[] = [];
let pendingFocusLinkType: PendingFocusLinkType | undefined = undefined;
let hoveredRelationFocusId: string | undefined = undefined;
let focusNavigateTimer: number | undefined = undefined;
let focusContextMenuTargetId: string | undefined = undefined;
let suppressConditionSelectionChange = false;
let suppressConditionPresetSelectionChange = false;
let pendingConditionPresetTargetTreeId: string | undefined = undefined;
let pendingConditionPresetExprKeys: string[] = [];
let xGridSize: number = (window as any).xGridSize;
let yGridSize: number = (window as any).yGridSize ?? 130;
const focusToolbarHeight: number = (window as any).focusToolbarHeight ?? 68;
const continuousFocusWidth = 770;
const continuousFocusHeight = 380;
const continuousFocusLeftAnchorOffset = 59;
const continuousFocusTopAnchorOffset = 7;
const focusCreateSidePaddingColumns = 4;
const focusCreateTopPaddingRows = 4;
const focusCreateRightPaddingColumns = 4;
const focusCreateBottomPaddingRows = 4;
const focusCreateMinimumColumns = 6;
const focusCreateMinimumRows = 6;
const focusPositionDragThresholdPx = 4;
const focusNavigateDelayMs = 220;
let currentGridLeftPadding = 0;
let currentGridTopPadding = 0;
let currentCanvasWidth = 1;
let currentCanvasHeight = 1;
let pendingFocusHydrationFrame: number | undefined = undefined;
type FocusSelectionRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ActiveFocusSelectionMarquee = {
    startClientX: number;
    startClientY: number;
    dragGestureStarted: boolean;
    pointerId: number;
    captureOwner: HTMLElement;
};
let activeFocusSelectionMarquee: ActiveFocusSelectionMarquee | undefined = undefined;

function normalizeFocusIdForClassName(focusId: string): string {
    return normalizeForStyle(focusId);
}

function connectionTouchesFocusId(connectionElement: HTMLElement, prefix: 'source' | 'target', focusId: string): boolean {
    return connectionElement.classList.contains(`focus-connection-${prefix}-${normalizeFocusIdForClassName(focusId)}`);
}

function getFocusPositionKey(position: NumberPosition): string {
    return `${position.x},${position.y}`;
}

function setCurrentFocusPositions(nextPositions: Record<string, NumberPosition>) {
    currentFocusPositions = nextPositions;
    currentOccupiedFocusPositionKeys = new Set(
        Object.values(nextPositions).map(position => getFocusPositionKey(position)),
    );
}

function rebuildRenderedFocusElementCache() {
    currentRenderedFocusElements = {};
    currentRenderedFocusElementsList = [];

    document.querySelectorAll<HTMLElement>('[data-focus-id]').forEach(element => {
        const focusId = element.dataset.focusId;
        if (!focusId || currentRenderedFocusElements[focusId]) {
            return;
        }

        currentRenderedFocusElements[focusId] = element;
        currentRenderedFocusElementsList.push(element);
    });
}

function getCurrentSelectionTreeId(): string | undefined {
    return currentRenderedFocusTree?.id ?? selectedFocusTreeId ?? focusTrees[selectedFocusTreeIndex]?.id;
}

function clampFocusTreeIndex(index: number): number {
    return clampFocusTreeIndexValue(index, focusTrees.length);
}

function persistSelectedFocusTreeState() {
    setState({
        selectedFocusTreeIndex,
        selectedFocusTreeId,
    });
}

function ensureSelectedFocusTreeIndex(): number {
    const resolvedSelection = resolveFocusTreeSelectionValue(focusTrees, selectedFocusTreeId, selectedFocusTreeIndex);
    if (selectedFocusTreeIndex !== resolvedSelection.selectedFocusTreeIndex
        || selectedFocusTreeId !== resolvedSelection.selectedFocusTreeId) {
        selectedFocusTreeIndex = resolvedSelection.selectedFocusTreeIndex;
        selectedFocusTreeId = resolvedSelection.selectedFocusTreeId;
        persistSelectedFocusTreeState();
    }

    return selectedFocusTreeIndex;
}

function setSelectedFocusTreeByIndex(index: number) {
    selectedFocusTreeIndex = clampFocusTreeIndex(index);
    selectedFocusTreeId = focusTrees[selectedFocusTreeIndex]?.id;
    persistSelectedFocusTreeState();
}

function conditionItemToExprKey(expr: ConditionItem): string {
    return `${expr.scopeName}!|${expr.nodeContent}`;
}

function exprKeyToConditionItem(exprKey: string): ConditionItem {
    const separatorIndex = exprKey.indexOf('!|');
    if (separatorIndex < 0) {
        return { scopeName: '', nodeContent: exprKey };
    }

    return {
        scopeName: exprKey.slice(0, separatorIndex),
        nodeContent: exprKey.slice(separatorIndex + 2),
    };
}

function getTreeConditionExprKeys(focusTree: FocusTree): string[] {
    return normalizeConditionExprKeys(
        dedupeConditionExprs(focusTree.conditionExprs)
            .filter(e => e.scopeName !== ''
                || (!e.nodeContent.startsWith('has_focus_tree = ')
                    && !e.nodeContent.startsWith('has_completed_focus = ')))
            .map(conditionItemToExprKey),
    );
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeHtmlAttribute(value: string): string {
    return escapeHtml(value);
}

function setSelectedExprsFromExprKeys(exprKeys: readonly string[]) {
    selectedExprs = exprKeys.map(exprKeyToConditionItem);
    setState({ selectedExprs });
}

function getSelectedExprKeysForFocusTree(focusTree: FocusTree, clearCondition = false): string[] {
    return clearCondition
        ? []
        : filterConditionPresetExprKeys(selectedExprs.map(conditionItemToExprKey), getTreeConditionExprKeys(focusTree));
}

function getConditionPresetsForTree(treeId: string): FocusConditionPreset[] {
    return conditionPresetsByTree[treeId] ?? [];
}

function persistConditionPresets() {
    const normalizedConditionPresetsByTree = normalizeConditionPresetsByTree(conditionPresetsByTree);
    conditionPresetsByTree = normalizedConditionPresetsByTree;
    setState({ conditionPresetsByTree: normalizedConditionPresetsByTree });
    vscode.postMessage({
        command: 'persistFocusConditionPresets',
        presetsByTree: normalizedConditionPresetsByTree,
    });
}

function setConditionPresetsForTree(treeId: string, presets: FocusConditionPreset[]) {
    const nextConditionPresetsByTree = { ...conditionPresetsByTree };
    if (presets.length === 0) {
        delete nextConditionPresetsByTree[treeId];
    } else {
        nextConditionPresetsByTree[treeId] = presets;
    }

    conditionPresetsByTree = nextConditionPresetsByTree;
    persistConditionPresets();
}

function getSelectedExprKeys(): string[] {
    return normalizeConditionExprKeys(selectedExprs.map(conditionItemToExprKey));
}

function getSelectedConditionPreset(focusTree: FocusTree): FocusConditionPreset | undefined {
    return findMatchingConditionPreset(getConditionPresetsForTree(focusTree.id), getSelectedExprKeys());
}

function refreshConditionPresetUi(focusTree: FocusTree) {
    const presetContainer = document.getElementById('condition-preset-container') as HTMLDivElement | null;
    const hasConditionExprs = getTreeConditionExprKeys(focusTree).length > 0;
    if (presetContainer) {
        presetContainer.style.display = useConditionInFocus && hasConditionExprs ? 'flex' : 'none';
    }

    if (!conditionPresetsDropdown) {
        return;
    }

    const presets = getConditionPresetsForTree(focusTree.id);
    conditionPresetsDropdown.select.innerHTML = `<span class="value"></span>
        <div class="option" value="__custom__">${feLocalize('TODO', '(Custom)')}</div>
        ${presets.map(preset => `<div class="option" value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</div>`).join('')}`;
    const selectedPreset = getSelectedConditionPreset(focusTree);
    suppressConditionPresetSelectionChange = true;
    conditionPresetsDropdown.selectedValues$.next([selectedPreset?.id ?? '__custom__']);
    suppressConditionPresetSelectionChange = false;

    const deleteButton = document.getElementById('delete-condition-preset') as HTMLButtonElement | null;
    if (deleteButton) {
        deleteButton.disabled = !selectedPreset;
    }
}

function createConditionPresetId(name: string): string {
    const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const prefix = normalizedName || 'preset';
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveConditionPreset(treeId: string, name: string, exprKeys: readonly string[]) {
    const presets = getConditionPresetsForTree(treeId);
    const normalizedExprKeys = normalizeConditionExprKeys(exprKeys);
    const matchingPreset = findMatchingConditionPreset(presets, normalizedExprKeys);
    const trimmedName = name.trim();
    if (matchingPreset) {
        setConditionPresetsForTree(
            treeId,
            presets.map(preset => preset.id === matchingPreset.id ? { ...preset, name: trimmedName, exprKeys: normalizedExprKeys } : preset),
        );
        return;
    }

    setConditionPresetsForTree(treeId, [
        ...presets,
        {
            id: createConditionPresetId(trimmedName),
            name: trimmedName,
            exprKeys: normalizedExprKeys,
        },
    ]);
}

function getCurrentFocusTree(): FocusTree | undefined {
    ensureSelectedFocusTreeIndex();
    return focusTrees[selectedFocusTreeIndex];
}

function persistCurrentSelectedFocusIds() {
    const treeId = getCurrentSelectionTreeId();
    if (!treeId) {
        return;
    }

    const nextSelectedFocusIdsByTree = { ...selectedFocusIdsByTree };
    if (currentSelectedFocusIds.size === 0) {
        delete nextSelectedFocusIdsByTree[treeId];
    } else {
        nextSelectedFocusIdsByTree[treeId] = Array.from(currentSelectedFocusIds);
    }

    selectedFocusIdsByTree = nextSelectedFocusIdsByTree;
    setState({ selectedFocusIdsByTree });
}

function areFocusIdSetsEqual(left: Set<string>, right: Set<string>): boolean {
    if (left.size !== right.size) {
        return false;
    }

    return Array.from(left).every(focusId => right.has(focusId));
}

function setCurrentSelectedFocusIds(nextIds: Iterable<string>, persistState = true) {
    const nextSelectedFocusIds = new Set(nextIds);
    if (areFocusIdSetsEqual(currentSelectedFocusIds, nextSelectedFocusIds)) {
        return;
    }

    currentSelectedFocusIds = nextSelectedFocusIds;
    if (persistState) {
        persistCurrentSelectedFocusIds();
    }
    updateFocusPositionEditUi();
}

function syncCurrentSelectedFocusIds() {
    const treeId = getCurrentSelectionTreeId();
    const nextSelectedFocusIds = new Set(treeId ? (selectedFocusIdsByTree[treeId] ?? []) : []);
    const focusTree = currentRenderedFocusTree;
    if (focusTree) {
        Array.from(nextSelectedFocusIds).forEach(focusId => {
            if (!focusTree.focuses[focusId]) {
                nextSelectedFocusIds.delete(focusId);
            }
        });
    }

    currentSelectedFocusIds = nextSelectedFocusIds;
    persistCurrentSelectedFocusIds();
}

function clearCurrentSelectedFocusIds() {
    if (currentSelectedFocusIds.size === 0) {
        return;
    }

    setCurrentSelectedFocusIds([]);
}

function isFocusSelected(focusId: string | undefined): boolean {
    return !!focusId && currentSelectedFocusIds.has(focusId);
}

function getContinuousFocusDisplayPositionFromStored(x: number, y: number): NumberPosition {
    return {
        x: x - continuousFocusLeftAnchorOffset,
        y: y + continuousFocusTopAnchorOffset,
    };
}

function getContinuousFocusStoredPositionFromDisplay(left: number, top: number): NumberPosition {
    return {
        x: left + continuousFocusLeftAnchorOffset,
        y: top - continuousFocusTopAnchorOffset,
    };
}

function applyContinuousFocusElementPosition(focusTree: FocusTree | undefined) {
    const continuousFocuses = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    if (!continuousFocuses) {
        return;
    }

    if (focusTree?.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        const displayPosition = getContinuousFocusDisplayPositionFromStored(
            focusTree.continuousFocusPositionX,
            focusTree.continuousFocusPositionY,
        );
        continuousFocuses.style.left = `${displayPosition.x}px`;
        continuousFocuses.style.top = `${displayPosition.y}px`;
        continuousFocuses.style.display = 'block';
    } else {
        continuousFocuses.style.display = 'none';
    }
}

function isContinuousFocusEditable(focusTree: FocusTree | undefined): boolean {
    return !!focusTree
        && focusTree.kind === 'focus'
        && !!focusTree.continuousLayout?.editable
        && focusTree.continuousLayout.sourceFile === (window as any).focusPositionActiveFile;
}

function projectFocusPositionToCanvas(position: NumberPosition): NumberPosition {
    return {
        x: currentGridLeftPadding + position.x * xGridSize + xGridSize / 2,
        y: currentGridTopPadding + position.y * yGridSize + yGridSize / 2,
    };
}

function getSelectedInlayWindowIds() {
    return getState().selectedInlayWindowIds ?? {} as Record<string, string | undefined>;
}

function getSelectedInlayWindowId(focusTree: FocusTree, availableInlayWindowIds?: string[]): string | undefined {
    const availableIds = availableInlayWindowIds ?? focusTree.inlayWindows.map(inlay => inlay.id);
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (selected && availableIds.includes(selected)) {
        return selected;
    }

    return availableIds[0];
}

function setSelectedInlayWindowId(focusTree: FocusTree, inlayWindowId: string | undefined) {
    const selectedInlayWindowIds = getSelectedInlayWindowIds();
    selectedInlayWindowIds[focusTree.id] = inlayWindowId;
    setState({ selectedInlayWindowIds });
}

function setFocusPositionEditMode(enabled: boolean) {
    focusPositionEditMode = enabled;
    setPreviewPanDisabled(enabled);
    setState({ focusPositionEditMode: enabled });
    clearPendingFocusNavigate();
    clearPendingFocusLink();
    if (!enabled) {
        clearCurrentSelectedFocusIds();
    }
    updateFocusPositionEditUi();
}

function hasPendingFocusLink(): boolean {
    return pendingFocusLinkParentId !== undefined && pendingFocusLinkType !== undefined;
}

function setHoveredRelationFocusId(focusId: string | undefined) {
    if (hoveredRelationFocusId === focusId) {
        return;
    }

    hoveredRelationFocusId = focusId;
    updateFocusPositionEditUi();
}

function updateFocusPositionEditUi() {
    const editButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    if (editButton) {
        editButton.setAttribute('aria-pressed', focusPositionEditMode ? 'true' : 'false');
        editButton.style.color = focusPositionEditMode ? 'var(--vscode-focusBorder)' : '';
        editButton.style.background = focusPositionEditMode ? 'rgba(32, 124, 229, 0.14)' : '';
        editButton.style.borderRadius = focusPositionEditMode ? '3px' : '';
    }

    const hoveredRelatedFocusIds = new Set(
        currentRenderedFocusTree
            ? getDirectlyRelatedFocusIds(currentRenderedFocusTree.focuses, hoveredRelationFocusId)
            : [],
    );
    const hasHoveredRelations = hoveredRelatedFocusIds.size > 0 && !hasPendingFocusLink();

    currentRenderedFocusElementsList.forEach(element => {
        const editable = element.dataset.focusEditable === 'true';
        const isPendingParent = hasPendingFocusLink() && !!element.dataset.focusId && pendingFocusLinkParentIds.includes(element.dataset.focusId);
        const isSelected = isFocusSelected(element.dataset.focusId);
        const isHovered = !!element.dataset.focusId && element.dataset.focusId === hoveredRelationFocusId;
        const isHoverRelated = !!element.dataset.focusId && hoveredRelatedFocusIds.has(element.dataset.focusId);
        element.style.cursor = focusPositionEditMode && editable ? 'grab' : 'pointer';
        element.style.opacity = hasHoveredRelations
            ? isHoverRelated ? '1' : '0.32'
            : '';
        element.style.filter = hasHoveredRelations
            ? isHoverRelated ? '' : 'saturate(0.45)'
            : '';
        element.style.boxShadow = isPendingParent
            ? pendingFocusLinkType === 'exclusive'
                ? '0 0 0 2px rgba(255, 96, 96, 0.95) inset'
                : '0 0 0 2px rgba(255, 196, 64, 0.95) inset'
            : isSelected
                ? '0 0 0 2px rgba(96, 196, 255, 0.95) inset'
            : focusPositionEditMode && editable
                ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset'
                : '';
    });

    document.querySelectorAll<HTMLElement>('.focus-connection').forEach(connectionElement => {
        if (!hasHoveredRelations) {
            connectionElement.style.opacity = '';
            connectionElement.style.filter = '';
            return;
        }

        const isHoverRelatedConnection = Array.from(hoveredRelatedFocusIds).some(relatedFocusId => connectionTouchesFocusId(connectionElement, 'source', relatedFocusId))
            && Array.from(hoveredRelatedFocusIds).some(relatedFocusId => connectionTouchesFocusId(connectionElement, 'target', relatedFocusId));

        connectionElement.style.opacity = isHoverRelatedConnection ? '1' : '0.14';
        connectionElement.style.filter = isHoverRelatedConnection ? 'saturate(1.1)' : 'saturate(0.35)';
    });

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    const continuousEditable = isContinuousFocusEditable(currentRenderedFocusTree);
    if (continuousFocusElement) {
        continuousFocusElement.style.cursor = focusPositionEditMode && continuousEditable ? 'grab' : 'default';
        continuousFocusElement.style.pointerEvents = focusPositionEditMode && continuousEditable ? 'auto' : 'none';
        continuousFocusElement.style.boxShadow = focusPositionEditMode && continuousEditable
            ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset'
            : '';
    }
}

function getSelectionRect(startClientX: number, startClientY: number, currentClientX: number, currentClientY: number): FocusSelectionRect {
    const left = Math.min(startClientX, currentClientX);
    const top = Math.min(startClientY, currentClientY);
    const right = Math.max(startClientX, currentClientX);
    const bottom = Math.max(startClientY, currentClientY);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
    };
}

function ensureFocusSelectionOverlay(): HTMLDivElement {
    let overlay = document.getElementById('focus-selection-overlay') as HTMLDivElement | null;
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'focus-selection-overlay';
    overlay.style.position = 'fixed';
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.border = '1px solid rgba(96, 196, 255, 0.95)';
    overlay.style.background = 'rgba(96, 196, 255, 0.12)';
    overlay.style.zIndex = '995';
    document.body.appendChild(overlay);
    return overlay;
}

function hideFocusSelectionOverlay() {
    const overlay = document.getElementById('focus-selection-overlay') as HTMLDivElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function updateFocusSelectionOverlay(selectionRect: FocusSelectionRect) {
    const overlay = ensureFocusSelectionOverlay();
    overlay.style.display = 'block';
    overlay.style.left = `${selectionRect.left}px`;
    overlay.style.top = `${selectionRect.top}px`;
    overlay.style.width = `${selectionRect.width}px`;
    overlay.style.height = `${selectionRect.height}px`;
}

function rectsIntersect(selectionRect: FocusSelectionRect, rect: DOMRect): boolean {
    return selectionRect.left <= rect.right
        && selectionRect.right >= rect.left
        && selectionRect.top <= rect.bottom
        && selectionRect.bottom >= rect.top;
}

function getSelectedFocusIdsFromRect(selectionRect: FocusSelectionRect): string[] {
    return currentRenderedFocusElementsList
        .filter(element => {
            if (!element.dataset.focusId) {
                return false;
            }

            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rectsIntersect(selectionRect, rect);
        })
        .map(element => element.dataset.focusId!)
        .filter((focusId, index, focusIds) => focusIds.indexOf(focusId) === index);
}

function clearActiveFocusSelectionMarquee() {
    if (activeFocusSelectionMarquee) {
        try {
            activeFocusSelectionMarquee.captureOwner.releasePointerCapture(activeFocusSelectionMarquee.pointerId);
        } catch {
            // Ignore stale pointer capture releases.
        }
    }
    activeFocusSelectionMarquee = undefined;
    hideFocusSelectionOverlay();
}

function getFocusElement(target: EventTarget | null): HTMLDivElement | null {
    const focusElement = (target as HTMLElement | null)?.closest<HTMLDivElement>('[data-focus-id]');
    return focusElement ?? null;
}

function getEditableFocusElement(target: EventTarget | null): HTMLDivElement | null {
    const focusElement = getFocusElement(target);
    return focusElement?.dataset.focusEditable === 'true' ? focusElement : null;
}

function getFocusElementAtPoint(clientX: number, clientY: number): HTMLDivElement | null {
    const focusElement = getFocusElement(getElementAtPointIgnoringDragger(clientX, clientY));
    return focusElement;
}

function getEditableFocusElementAtPoint(clientX: number, clientY: number): HTMLDivElement | null {
    const focusElement = getEditableFocusElement(getElementAtPointIgnoringDragger(clientX, clientY));
    return focusElement;
}

function getElementAtPointIgnoringDragger(clientX: number, clientY: number): HTMLElement | null {
    const dragger = document.getElementById('dragger') as HTMLDivElement | null;
    const previousPointerEvents = dragger?.style.pointerEvents ?? '';
    if (dragger) {
        dragger.style.pointerEvents = 'none';
    }

    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

    if (dragger) {
        dragger.style.pointerEvents = previousPointerEvents;
    }

    return element;
}

function getEditableFocusElementFromMouseEvent(event: MouseEvent): HTMLDivElement | null {
    return getEditableFocusElement(event.target) ?? getEditableFocusElementAtPoint(event.clientX, event.clientY);
}

function getFocusElementFromMouseEvent(event: MouseEvent): HTMLDivElement | null {
    return getFocusElement(event.target) ?? getFocusElementAtPoint(event.clientX, event.clientY);
}

function clearPendingFocusNavigate() {
    if (focusNavigateTimer !== undefined) {
        window.clearTimeout(focusNavigateTimer);
        focusNavigateTimer = undefined;
    }
}

function ensureFocusContextMenu(): HTMLDivElement {
    let menu = document.getElementById('focus-context-menu') as HTMLDivElement | null;
    if (menu) {
        return menu;
    }

    menu = document.createElement('div');
    menu.id = 'focus-context-menu';
    menu.style.position = 'fixed';
    menu.style.display = 'none';
    menu.style.minWidth = '140px';
    menu.style.padding = '4px 0';
    menu.style.background = 'var(--vscode-menu-background)';
    menu.style.color = 'var(--vscode-menu-foreground)';
    menu.style.border = '1px solid var(--vscode-menu-border, var(--vscode-panel-border))';
    menu.style.boxShadow = '0 4px 18px rgba(0, 0, 0, 0.35)';
    menu.style.zIndex = '1100';
    menu.addEventListener('mousedown', event => {
        event.stopPropagation();
    });
    menu.addEventListener('click', event => {
        event.stopPropagation();
    });
    menu.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
    });

    const createMenuButton = (label: string, mouseDownHandler: (focusId: string) => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.height = '28px';
        button.style.padding = '0 12px';
        button.style.textAlign = 'left';
        button.style.background = 'transparent';
        button.style.color = 'inherit';
        button.style.border = 'none';
        button.style.cursor = 'pointer';
        button.addEventListener('mouseenter', () => {
            button.style.background = 'var(--vscode-list-hoverBackground)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent';
        });
        button.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            const focusId = button.dataset.focusId ?? focusContextMenuTargetId;
            hideFocusContextMenu();
            if (!focusId) {
                return;
            }

            mouseDownHandler(focusId);
        });
        return button;
    };

    const linkItem = createMenuButton('Link focus', focusId => {
        startPendingFocusLink(focusId, undefined, undefined, 'prerequisite');
    });
    const exclusiveItem = createMenuButton('Link mutually exclusive', focusId => {
        startPendingFocusLink(focusId, undefined, undefined, 'exclusive');
    });
    const deleteItem = createMenuButton('Delete focus', focusId => {
        const focusIds = resolveFocusDeleteTargetIds(focusId);
        vscode.postMessage({
            command: 'deleteFocus',
            focusId,
            focusIds,
            documentVersion: focusPositionDocumentVersion,
        });
    });

    menu.appendChild(linkItem);
    menu.appendChild(exclusiveItem);
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    return menu;
}

function hideFocusContextMenu() {
    focusContextMenuTargetId = undefined;
    const menu = document.getElementById('focus-context-menu') as HTMLDivElement | null;
    if (menu) {
        delete menu.dataset.focusId;
        menu.querySelectorAll('button').forEach(button => {
            delete (button as HTMLButtonElement).dataset.focusId;
        });
        menu.style.display = 'none';
    }
}

function showFocusContextMenu(focusId: string, clientX: number, clientY: number) {
    const menu = ensureFocusContextMenu();
    focusContextMenuTargetId = focusId;
    menu.dataset.focusId = focusId;
    menu.querySelectorAll('button').forEach(button => {
        (button as HTMLButtonElement).dataset.focusId = focusId;
    });
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.display = 'block';

    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width - 4);
    const maxTop = Math.max(0, window.innerHeight - rect.height - 4);
    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;
}

function navigateToFocusDefinition(focusElement: HTMLElement) {
    const startStr = focusElement.getAttribute('start');
    const endStr = focusElement.getAttribute('end');
    const file = focusElement.getAttribute('file') ?? undefined;
    const start = !startStr || startStr === 'undefined' ? undefined : parseInt(startStr, 10);
    const end = !endStr ? undefined : parseInt(endStr, 10);
    vscode.postMessage({
        command: 'navigate',
        start,
        end,
        file,
    });
}

function scheduleFocusNavigate(focusElement: HTMLElement) {
    clearPendingFocusNavigate();
    focusNavigateTimer = window.setTimeout(() => {
        focusNavigateTimer = undefined;
        if (!focusPositionEditMode || hasPendingFocusLink()) {
            return;
        }

        navigateToFocusDefinition(focusElement);
    }, focusNavigateDelayMs);
}

function setupFocusPositionDragHandlers() {
    document.addEventListener('mouseover', event => {
        const focusElement = getFocusElement(event.target);
        setHoveredRelationFocusId(focusElement?.dataset.focusId);
    }, true);

    document.addEventListener('mouseout', event => {
        const focusElement = getFocusElement(event.target);
        if (!focusElement) {
            return;
        }

        const relatedFocusElement = getFocusElement((event as MouseEvent).relatedTarget);
        if (relatedFocusElement?.dataset.focusId === focusElement.dataset.focusId) {
            return;
        }

        if (hoveredRelationFocusId === focusElement.dataset.focusId) {
            setHoveredRelationFocusId(undefined);
        }
    }, true);

    document.addEventListener('contextmenu', event => {
        if (!focusPositionEditMode) {
            hideFocusContextMenu();
            return;
        }

        const focusElement = getEditableFocusElementFromMouseEvent(event);
        if (!focusElement) {
            hideFocusContextMenu();
            return;
        }

        const focusId = focusElement.dataset.focusId;
        if (!focusId) {
            hideFocusContextMenu();
            return;
        }

        clearPendingFocusNavigate();
        clearPendingFocusLink();
        event.preventDefault();
        event.stopPropagation();
        showFocusContextMenu(focusId, event.clientX, event.clientY);
    }, true);

    document.addEventListener('click', event => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('#focus-context-menu')) {
            hideFocusContextMenu();
        }

        if (!focusPositionEditMode) {
            return;
        }

        if (Date.now() <= suppressEditableFocusClickUntil) {
            suppressEditableFocusClickUntil = 0;
            clearPendingFocusNavigate();
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const focusElement = getFocusElementFromMouseEvent(event);
        if (hasPendingFocusLink()) {
            clearPendingFocusNavigate();
            event.preventDefault();
            event.stopPropagation();

            if (!focusElement) {
                clearPendingFocusLink();
                return;
            }

            const parentFocusId = pendingFocusLinkParentId;
            const parentFocusIds = [...pendingFocusLinkParentIds];
            const anchorParentFocusId = resolvePendingFocusLinkAnchorId(parentFocusIds, parentFocusId ?? '');
            const linkType = pendingFocusLinkType;
            const childFocusId = focusElement.dataset.focusId;
            clearPendingFocusLink();
            if (!parentFocusId || !anchorParentFocusId || !childFocusId || !linkType || anchorParentFocusId === childFocusId) {
                return;
            }

            if (!currentRenderedFocusTree) {
                return;
            }

            if (linkType === 'exclusive') {
                vscode.postMessage({
                    command: 'applyFocusExclusiveLinkEdit',
                    sourceFocusId: parentFocusId,
                    targetFocusId: childFocusId,
                    documentVersion: focusPositionDocumentVersion,
                });
                return;
            }

            const childFocus = currentRenderedFocusTree.focuses[childFocusId];
            const childAbsolutePosition = currentFocusPositions[childFocusId];
            if (!childFocus || !childAbsolutePosition) {
                return;
            }

            const updatedLinkState = updatePrerequisiteGroupsAfterLinkApply(
                childFocus.prerequisite,
                parentFocusIds,
                anchorParentFocusId,
                childFocus.relativePositionId,
            );
            const linkedChildFocus: Focus = {
                ...childFocus,
                relativePositionId: updatedLinkState.relativePositionId,
                prerequisite: updatedLinkState.prerequisiteGroups,
                exclusive: childFocus.exclusive,
                icon: childFocus.icon,
                offset: childFocus.offset,
                inAllowBranch: childFocus.inAllowBranch,
            };
            const targetLocalPosition = getLocalPositionFromRenderedAbsolute(
                linkedChildFocus,
                currentRenderedFocusTree,
                currentRenderedExprs,
                childAbsolutePosition,
            );

            vscode.postMessage({
                command: 'applyFocusLinkEdit',
                parentFocusId: anchorParentFocusId,
                parentFocusIds,
                childFocusId,
                targetLocalX: targetLocalPosition.x,
                targetLocalY: targetLocalPosition.y,
                documentVersion: focusPositionDocumentVersion,
            });
            return;
        }

        if (!focusElement) {
            if (getBlankCanvasPanTarget(event)) {
                clearCurrentSelectedFocusIds();
            }
            return;
        }

        clearPendingFocusNavigate();
        event.preventDefault();
        event.stopPropagation();
        if (event.detail <= 1) {
            scheduleFocusNavigate(focusElement);
        }
    }, true);

    document.addEventListener('dblclick', event => {
        if (!focusPositionEditMode) {
            return;
        }

        const focusElement = getFocusElementFromMouseEvent(event);
        if (!focusElement) {
            return;
        }

        const parentFocusId = focusElement.dataset.focusId;
        if (!parentFocusId) {
            return;
        }

        clearPendingFocusNavigate();
        event.preventDefault();
        event.stopPropagation();
        startPendingFocusLink(parentFocusId, event.clientX, event.clientY, 'prerequisite');
    }, true);

    document.addEventListener('mousemove', event => {
        if (!hasPendingFocusLink()) {
            return;
        }

        updatePendingFocusLinkTarget(event.clientX, event.clientY);
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            hideFocusContextMenu();
            if (hasPendingFocusLink()) {
                clearPendingFocusLink();
                return;
            }

            clearActiveFocusSelectionMarquee();
            clearCurrentSelectedFocusIds();
        }
    }, true);

    window.addEventListener('scroll', () => {
        hideFocusContextMenu();
    }, true);
}

function setupFocusSelectionMarqueeHandler() {
    document.addEventListener('pointerdown', event => {
        if (!focusPositionEditMode || event.button !== 0 || !event.shiftKey || hasPendingFocusLink()) {
            return;
        }

        const captureOwner = getBlankCanvasPanTarget(event);
        if (!captureOwner) {
            return;
        }

        clearPendingFocusNavigate();
        hideFocusContextMenu();
        event.preventDefault();
        event.stopPropagation();
        captureOwner.setPointerCapture?.(event.pointerId);
        activeFocusSelectionMarquee = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            dragGestureStarted: false,
            pointerId: event.pointerId,
            captureOwner,
        };
        hideFocusSelectionOverlay();
    }, true);

    document.addEventListener('pointermove', event => {
        if (!activeFocusSelectionMarquee || event.pointerId !== activeFocusSelectionMarquee.pointerId) {
            return;
        }

        const selectionRect = getSelectionRect(
            activeFocusSelectionMarquee.startClientX,
            activeFocusSelectionMarquee.startClientY,
            event.clientX,
            event.clientY,
        );

        if (!activeFocusSelectionMarquee.dragGestureStarted
            && Math.max(selectionRect.width, selectionRect.height) < focusPositionDragThresholdPx) {
            return;
        }

        activeFocusSelectionMarquee.dragGestureStarted = true;
        updateFocusSelectionOverlay(selectionRect);
        setCurrentSelectedFocusIds(getSelectedFocusIdsFromRect(selectionRect), false);
    }, true);

    const finishSelectionMarquee = () => {
        if (!activeFocusSelectionMarquee) {
            return;
        }

        const dragGestureStarted = activeFocusSelectionMarquee.dragGestureStarted;
        clearActiveFocusSelectionMarquee();
        if (dragGestureStarted) {
            persistCurrentSelectedFocusIds();
            suppressEditableFocusClickUntil = Date.now() + 250;
        }
    };

    document.addEventListener('pointerup', event => {
        if (!activeFocusSelectionMarquee || event.pointerId !== activeFocusSelectionMarquee.pointerId) {
            return;
        }

        finishSelectionMarquee();
    }, true);

    document.addEventListener('pointercancel', event => {
        if (!activeFocusSelectionMarquee || event.pointerId !== activeFocusSelectionMarquee.pointerId) {
            return;
        }

        clearActiveFocusSelectionMarquee();
    }, true);
}

function ensurePendingFocusLinkOverlay(): SVGSVGElement {
    let overlay = document.getElementById('focus-link-overlay') as SVGSVGElement | null;
    if (overlay) {
        return overlay;
    }

    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.id = 'focus-link-overlay';
    overlay.setAttribute('width', '100%');
    overlay.setAttribute('height', '100%');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'none';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = 'focus-link-overlay-line';
    line.setAttribute('stroke', '#ffc440');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-dasharray', '8 5');
    overlay.appendChild(line);

    document.body.appendChild(overlay);
    return overlay;
}

function getFocusElementById(focusId: string): HTMLElement | undefined {
    return currentRenderedFocusElements[focusId];
}

function getElementViewportCenter(element: HTMLElement): NumberPosition {
    const rect = element.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
}

function refreshPendingFocusLinkOverlay(targetClientX?: number, targetClientY?: number) {
    if (!hasPendingFocusLink()) {
        return;
    }

    const parentFocusId = pendingFocusLinkParentId;
    if (!parentFocusId) {
        return;
    }

    const parentElement = getFocusElementById(parentFocusId);
    if (!parentElement) {
        clearPendingFocusLink();
        return;
    }

    const overlay = ensurePendingFocusLinkOverlay();
    const line = overlay.querySelector('#focus-link-overlay-line') as SVGLineElement | null;
    if (!line) {
        return;
    }

    const parentCenter = getElementViewportCenter(parentElement);
    const x2 = targetClientX ?? parentCenter.x;
    const y2 = targetClientY ?? parentCenter.y;
    line.setAttribute('x1', `${parentCenter.x}`);
    line.setAttribute('y1', `${parentCenter.y}`);
    line.setAttribute('x2', `${x2}`);
    line.setAttribute('y2', `${y2}`);
    line.setAttribute('stroke', pendingFocusLinkType === 'exclusive' ? '#ff6666' : '#ffc440');
    line.setAttribute('stroke-dasharray', pendingFocusLinkType === 'exclusive' ? '0' : '8 5');
    overlay.style.display = 'block';
}

function startPendingFocusLink(
    parentFocusId: string,
    clientX?: number,
    clientY?: number,
    type: PendingFocusLinkType = 'prerequisite',
) {
    pendingFocusLinkParentIds = resolvePendingFocusLinkParentIds(parentFocusId);
    pendingFocusLinkParentId = parentFocusId;
    pendingFocusLinkType = type;
    const parentElement = getFocusElementById(parentFocusId);
    const parentCenter = parentElement ? getElementViewportCenter(parentElement) : undefined;
    refreshPendingFocusLinkOverlay(clientX ?? parentCenter?.x, clientY ?? parentCenter?.y);
    updateFocusPositionEditUi();
}

function resolvePendingFocusLinkParentIds(anchorFocusId: string): string[] {
    const selectedFocusIds = currentSelectedFocusIds.has(anchorFocusId)
        ? Array.from(currentSelectedFocusIds)
        : [];
    const focusIds = selectedFocusIds.length > 1 ? selectedFocusIds : [anchorFocusId];
    return Array.from(new Set(focusIds.filter(Boolean)));
}

function resolveFocusDeleteTargetIds(anchorFocusId: string): string[] {
    const selectedFocusIds = currentSelectedFocusIds.has(anchorFocusId)
        ? Array.from(currentSelectedFocusIds)
        : [];
    const focusIds = selectedFocusIds.length > 1 ? selectedFocusIds : [anchorFocusId];
    return Array.from(new Set(focusIds.filter(Boolean)));
}

function resolvePendingFocusLinkAnchorId(parentFocusIds: readonly string[], fallbackFocusId: string): string {
    return getTopMostFocusAnchorId(parentFocusIds, currentFocusPositions, fallbackFocusId);
}

function areFocusIdArraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const rightSet = new Set(right);
    return left.every(focusId => rightSet.has(focusId));
}

function getMatchingPrerequisiteGroupIndex(prerequisiteGroups: readonly string[][], parentFocusIds: readonly string[]): number {
    return prerequisiteGroups.findIndex(group => parentFocusIds.some(parentFocusId => group.includes(parentFocusId)));
}

function updatePrerequisiteGroupsAfterLinkApply(
    prerequisiteGroups: string[][],
    parentFocusIds: readonly string[],
    anchorParentFocusId: string,
    currentRelativePositionId: string | undefined,
): { prerequisiteGroups: string[][]; relativePositionId: string | undefined } {
    const nextPrerequisiteGroups = prerequisiteGroups.map(group => [...group]);
    const matchingGroupIndex = getMatchingPrerequisiteGroupIndex(nextPrerequisiteGroups, parentFocusIds);
    const matchingGroup = matchingGroupIndex !== -1 ? nextPrerequisiteGroups[matchingGroupIndex] : undefined;
    const hasExactGroup = !!matchingGroup && areFocusIdArraysEqual(matchingGroup, parentFocusIds);

    if (hasExactGroup && currentRelativePositionId === anchorParentFocusId) {
        nextPrerequisiteGroups.splice(matchingGroupIndex, 1);
        return {
            prerequisiteGroups: nextPrerequisiteGroups,
            relativePositionId: undefined,
        };
    }

    if (matchingGroup) {
        nextPrerequisiteGroups[matchingGroupIndex] = Array.from(new Set([...matchingGroup, ...parentFocusIds]));
    } else {
        nextPrerequisiteGroups.push([...parentFocusIds]);
    }

    return {
        prerequisiteGroups: nextPrerequisiteGroups,
        relativePositionId: anchorParentFocusId,
    };
}

function updatePendingFocusLinkTarget(clientX: number, clientY: number) {
    refreshPendingFocusLinkOverlay(clientX, clientY);
}

function clearPendingFocusLink() {
    pendingFocusLinkParentId = undefined;
    pendingFocusLinkParentIds = [];
    pendingFocusLinkType = undefined;
    const overlay = document.getElementById('focus-link-overlay') as SVGSVGElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }

    updateFocusPositionEditUi();
}

function isBlankCreateTarget(event: MouseEvent): boolean {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element) {
        return false;
    }

    if (element.closest('[data-focus-id], #inlaywindowplaceholder, #continuousFocuses, .toolbar-outer, #warnings-container, input, select, button, textarea, option')) {
        return false;
    }

    const toolbar = document.querySelector('.toolbar-outer') as HTMLElement | null;
    const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
    if (event.clientY < toolbarBottom) {
        return false;
    }

    const contentElement = document.getElementById('focustreecontent') as HTMLElement | null;
    const contentRect = contentElement?.getBoundingClientRect();
    if (!contentRect) {
        return false;
    }

    return event.clientX >= contentRect.left && event.clientY >= contentRect.top;
}

function getBlankCanvasPanTarget(event: MouseEvent): HTMLElement | null {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element || element.id === 'dragger') {
        return null;
    }

    if (element.closest('[data-focus-id], .navigator, #continuousFocuses, .toolbar-outer, #warnings-container, input, select, button, textarea, option, ul.select-dropdown, li')) {
        return null;
    }

    const contentElement = document.getElementById('focustreecontent') as HTMLElement | null;
    const contentRect = contentElement?.getBoundingClientRect();
    if (!contentRect) {
        return null;
    }

    if (event.clientX < contentRect.left || event.clientY < contentRect.top) {
        return null;
    }

    return element;
}

function getAbsoluteGridPositionFromMouseEvent(event: MouseEvent): NumberPosition | undefined {
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    if (!contentElement) {
        return undefined;
    }

    const scale = getState().scale || 1;
    const contentRect = contentElement.getBoundingClientRect();
    const localX = (event.clientX - contentRect.left) / scale;
    const localY = (event.clientY - contentRect.top) / scale;

    return {
        x: Math.floor((localX - currentGridLeftPadding) / xGridSize),
        y: Math.floor((localY - currentGridTopPadding) / yGridSize),
    };
}

function hasRenderedFocusAtAbsolutePosition(position: NumberPosition): boolean {
    return currentOccupiedFocusPositionKeys.has(getFocusPositionKey(position));
}

function setupFocusTemplateCreateHandler() {
    document.addEventListener('click', event => {
        if (!focusPositionEditMode || !currentRenderedFocusTree) {
            return;
        }

        if (event.detail < 2) {
            return;
        }

        if (!isBlankCreateTarget(event)) {
            return;
        }

        const targetPosition = getAbsoluteGridPositionFromMouseEvent(event);
        if (!targetPosition || hasRenderedFocusAtAbsolutePosition(targetPosition)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearPendingFocusNavigate();

        vscode.postMessage({
            command: 'createFocusTemplateAtPosition',
            treeEditKey: currentRenderedFocusTree.createTemplate?.editKey ?? '',
            targetAbsoluteX: targetPosition.x,
            targetAbsoluteY: targetPosition.y,
            documentVersion: focusPositionDocumentVersion,
        });
    }, true);
}

function setupBlankCanvasPanFallback() {
    document.addEventListener('mousedown', event => {
        if (event.button !== 0 || event.defaultPrevented || event.shiftKey) {
            return;
        }

        if (!getBlankCanvasPanTarget(event)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        startPreviewPan(event.pageX, event.pageY, true);
    }, true);
}

function clearFocusPositionDragBindings() {
    focusPositionDragBindings.forEach(binding => {
        binding.element.removeEventListener(binding.eventName, binding.handler, true);
    });
    focusPositionDragBindings = [];
}

function bindFocusPositionDragHandlers() {
    clearFocusPositionDragBindings();

    currentRenderedFocusElementsList
        .filter(focusElement => focusElement.dataset.focusEditable === 'true')
        .forEach(focusElement => {
        const handler = (event: MouseEvent) => {
            if (!focusPositionEditMode || event.button !== 0) {
                return;
            }

            if ((event.target as HTMLElement | null)?.closest('input, select, button, textarea, option')) {
                return;
            }

            const focusId = focusElement.dataset.focusId;
            if (!focusId || !currentRenderedFocusTree) {
                return;
            }

            const focus = currentRenderedFocusTree.focuses[focusId];
            const currentPosition = currentFocusPositions[focusId];
            if (!focus || !currentPosition) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const startingPosition = { ...currentPosition };
            let nextAbsolutePosition = { ...startingPosition };
            let dragGestureStarted = false;

            focusElement.style.cursor = 'grabbing';
            focusElement.style.zIndex = '20';
            focusElement.style.willChange = 'transform';

            const mouseMoveHandler = (moveEvent: MouseEvent) => {
                const scale = getState().scale || 1;
                const deltaPageX = moveEvent.pageX - event.pageX;
                const deltaPageY = moveEvent.pageY - event.pageY;
                if (!dragGestureStarted && Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) < focusPositionDragThresholdPx) {
                    return;
                }

                dragGestureStarted = true;
                const deltaGridX = Math.round(deltaPageX / scale / xGridSize);
                const deltaGridY = Math.round(deltaPageY / scale / yGridSize);
                nextAbsolutePosition = {
                    x: startingPosition.x + deltaGridX,
                    y: startingPosition.y + deltaGridY,
                };
                focusElement.style.transform = `translate(${deltaPageX / scale}px, ${deltaPageY / scale}px)`;
            };

            const mouseUpHandler = () => {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                focusElement.style.transform = '';
                focusElement.style.cursor = 'grab';
                focusElement.style.zIndex = '';
                focusElement.style.willChange = '';

                if (!dragGestureStarted) {
                    return;
                }

                suppressEditableFocusClickUntil = Date.now() + 250;

                if (!currentRenderedFocusTree) {
                    return;
                }

                if (nextAbsolutePosition.x === startingPosition.x && nextAbsolutePosition.y === startingPosition.y) {
                    return;
                }

                const targetLocalPosition = getLocalPositionFromRenderedAbsolute(
                    focus,
                    currentRenderedFocusTree,
                    currentRenderedExprs,
                    nextAbsolutePosition,
                );

                vscode.postMessage({
                    command: 'applyFocusPositionEdit',
                    focusId,
                    targetLocalX: targetLocalPosition.x,
                    targetLocalY: targetLocalPosition.y,
                    documentVersion: focusPositionDocumentVersion,
                });
            };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        focusElement.addEventListener('mousedown', handler, true);
        focusPositionDragBindings.push({ element: focusElement, eventName: 'mousedown', handler: handler as EventListener });
    });

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    const focusTree = currentRenderedFocusTree;
    if (!continuousFocusElement || !isContinuousFocusEditable(focusTree)) {
        return;
    }

    const handler = (event: PointerEvent) => {
        if (!focusPositionEditMode || event.button !== 0 || hasPendingFocusLink() || !currentRenderedFocusTree) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        continuousFocusElement.setPointerCapture?.(event.pointerId);

        const startingLeft = parseFloat(continuousFocusElement.style.left || '0');
        const startingTop = parseFloat(continuousFocusElement.style.top || '0');
        let nextLeft = startingLeft;
        let nextTop = startingTop;
        let dragGestureStarted = false;

        continuousFocusElement.style.cursor = 'grabbing';
        continuousFocusElement.style.zIndex = '20';
        continuousFocusElement.style.willChange = 'left, top';

        const pointerMoveHandler = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }

            const scale = getState().scale || 1;
            const deltaPageX = moveEvent.pageX - event.pageX;
            const deltaPageY = moveEvent.pageY - event.pageY;
            if (!dragGestureStarted && Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) < focusPositionDragThresholdPx) {
                return;
            }

            dragGestureStarted = true;
            nextLeft = startingLeft + deltaPageX / scale;
            nextTop = startingTop + deltaPageY / scale;
            continuousFocusElement.style.left = `${nextLeft}px`;
            continuousFocusElement.style.top = `${nextTop}px`;
        };

        const finishContinuousDrag = () => {
            continuousFocusElement.removeEventListener('pointermove', pointerMoveHandler);
            continuousFocusElement.removeEventListener('pointerup', pointerUpHandler);
            continuousFocusElement.removeEventListener('pointercancel', pointerCancelHandler);
            try {
                continuousFocusElement.releasePointerCapture(event.pointerId);
            } catch {
                // Ignore stale pointer capture releases.
            }
            continuousFocusElement.style.cursor = focusPositionEditMode ? 'grab' : 'default';
            continuousFocusElement.style.zIndex = '';
            continuousFocusElement.style.willChange = '';

            if (!dragGestureStarted || !currentRenderedFocusTree) {
                applyContinuousFocusElementPosition(currentRenderedFocusTree);
                return;
            }

            const nextStoredPosition = getContinuousFocusStoredPositionFromDisplay(nextLeft, nextTop);
            const roundedTargetX = Math.round(nextStoredPosition.x);
            const roundedTargetY = Math.round(nextStoredPosition.y);
            if (roundedTargetX === currentRenderedFocusTree.continuousFocusPositionX
                && roundedTargetY === currentRenderedFocusTree.continuousFocusPositionY) {
                applyContinuousFocusElementPosition(currentRenderedFocusTree);
                return;
            }

            vscode.postMessage({
                command: 'applyContinuousFocusPositionEdit',
                focusTreeEditKey: currentRenderedFocusTree.continuousLayout?.editKey ?? '',
                targetX: roundedTargetX,
                targetY: roundedTargetY,
                documentVersion: focusPositionDocumentVersion,
            });
        };

        const pointerUpHandler = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== event.pointerId) {
                return;
            }

            finishContinuousDrag();
        };

        const pointerCancelHandler = (cancelEvent: PointerEvent) => {
            if (cancelEvent.pointerId !== event.pointerId) {
                return;
            }

            finishContinuousDrag();
        };

        continuousFocusElement.addEventListener('pointermove', pointerMoveHandler);
        continuousFocusElement.addEventListener('pointerup', pointerUpHandler);
        continuousFocusElement.addEventListener('pointercancel', pointerCancelHandler);
    };

    continuousFocusElement.addEventListener('pointerdown', handler, true);
    focusPositionDragBindings.push({ element: continuousFocusElement, eventName: 'pointerdown', handler: handler as EventListener });
}

function updateFocusPositionAfterApply(focusId: string, targetLocalX: number, targetLocalY: number) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const focus = currentRenderedFocusTree.focuses[focusId];
    if (!focus) {
        return;
    }

    focus.x = targetLocalX;
    focus.y = targetLocalY;
    invalidateCachedFocusTreeLayoutPlan(currentRenderedFocusTree);
    const layoutPlan = getCachedFocusTreeLayoutPlan(currentRenderedFocusTree, currentRenderedExprs, useConditionInFocus);
    setCurrentFocusPositions({ ...layoutPlan.focusPosition });
}

function updateContinuousFocusPositionAfterApply(focusTreeEditKey: string, targetX: number, targetY: number) {
    const targetTree = focusTrees.find(focusTree => focusTree.continuousLayout?.editKey === focusTreeEditKey);
    if (!targetTree) {
        return;
    }

    targetTree.continuousFocusPositionX = targetX;
    targetTree.continuousFocusPositionY = targetY;
    if (targetTree.continuousLayout) {
        targetTree.continuousLayout.basePosition = { x: targetX, y: targetY };
    }
}

function updateFocusLinkAfterApply(
    parentFocusId: string,
    childFocusId: string,
    targetLocalX?: number,
    targetLocalY?: number,
    parentFocusIds?: readonly string[],
) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const childFocus = currentRenderedFocusTree.focuses[childFocusId];
    if (!childFocus) {
        return;
    }

    const normalizedParentFocusIds = Array.from(new Set((parentFocusIds && parentFocusIds.length > 0 ? parentFocusIds : [parentFocusId]).filter(focusId => focusId && focusId !== childFocusId)));
    const updatedLinkState = updatePrerequisiteGroupsAfterLinkApply(
        childFocus.prerequisite,
        normalizedParentFocusIds,
        parentFocusId,
        childFocus.relativePositionId,
    );
    childFocus.prerequisite = updatedLinkState.prerequisiteGroups;
    childFocus.relativePositionId = updatedLinkState.relativePositionId;
    if (targetLocalX !== undefined && targetLocalY !== undefined) {
        childFocus.x = targetLocalX;
        childFocus.y = targetLocalY;
    }
    invalidateCachedFocusTreeLayoutPlan(currentRenderedFocusTree);
    const layoutPlan = getCachedFocusTreeLayoutPlan(currentRenderedFocusTree, currentRenderedExprs, useConditionInFocus);
    setCurrentFocusPositions({ ...layoutPlan.focusPosition });
}

function updateFocusExclusiveLinkAfterApply(sourceFocusId: string, targetFocusId: string) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const sourceFocus = currentRenderedFocusTree.focuses[sourceFocusId];
    const targetFocus = currentRenderedFocusTree.focuses[targetFocusId];
    if (!sourceFocus) {
        return;
    }

    if (!targetFocus) {
        return;
    }

    const hasExistingExclusiveLink = sourceFocus.exclusive.includes(targetFocusId)
        || targetFocus.exclusive.includes(sourceFocusId);
    if (hasExistingExclusiveLink) {
        sourceFocus.exclusive = sourceFocus.exclusive.filter(focusId => focusId !== targetFocusId);
        targetFocus.exclusive = targetFocus.exclusive.filter(focusId => focusId !== sourceFocusId);
    } else {
        sourceFocus.exclusive.push(targetFocusId);
        targetFocus.exclusive.push(sourceFocusId);
    }

    invalidateCachedFocusTreeLayoutPlan(currentRenderedFocusTree);
}

async function buildContent() {
    const checkedFocusesExprs = getCheckedFocusConditionExprs();
    clearCheckedFocuses();

    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
    const focustreeplaceholder = document.getElementById('focustreeplaceholder') as HTMLDivElement;
    const styleTable = new StyleTable();
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }
    const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs];
    const gridbox: GridBoxType = (window as any).gridBox;
    const layoutPlan = getCachedFocusTreeLayoutPlan(focusTree, exprs, useConditionInFocus);
    const renderExprs = exprs;
    const focusGridBoxItems = layoutPlan.focusGridBoxItems;
    const focusPosition = layoutPlan.focusPosition;
    const completableFocusIds = layoutPlan.completableFocusIds;
    currentCompletableFocusIds = completableFocusIds;
    currentRenderedFocusTree = focusTree;
    if (hasPendingFocusLink() && !focusTree.focuses[pendingFocusLinkParentId!]) {
        clearPendingFocusLink();
    }
    if (hoveredRelationFocusId && !focusTree.focuses[hoveredRelationFocusId]) {
        hoveredRelationFocusId = undefined;
    }
    syncCurrentSelectedFocusIds();
    setCurrentFocusPositions({ ...focusPosition });
    currentRenderedExprs = renderExprs;
    applyContinuousFocusElementPosition(focusTree);
    const leftPadding = (gridbox.position.x._value ?? 0)
        + (focusCreateSidePaddingColumns * xGridSize)
        - Math.min(layoutPlan.minX * xGridSize, 0);
    currentGridLeftPadding = leftPadding;
    currentGridTopPadding = (gridbox.position.y._value ?? 0)
        + (focusCreateTopPaddingRows * yGridSize)
        - Math.min(layoutPlan.minY * yGridSize, 0);

    const focusTreeContent = await renderGridBoxCommon({
        ...gridbox,
        position: {
            ...gridbox.position,
            x: toNumberLike(leftPadding),
            y: toNumberLike(currentGridTopPadding),
        }
    }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        id: 'focus-gridbox',
        styleTable,
        items: arrayToMap(focusGridBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(renderFocusShellHtml(focusTree.focuses[item.id])),
        cornerPosition: 0.5,
    });

    focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement((window as any).styleNonce);
    const minimumCanvasWidth = currentGridLeftPadding + Math.max(layoutPlan.maxX + 1 + focusCreateRightPaddingColumns, focusCreateMinimumColumns) * xGridSize;
    const minimumCanvasHeight = currentGridTopPadding + Math.max(layoutPlan.maxY + 1 + focusCreateBottomPaddingRows, focusCreateMinimumRows) * yGridSize;
    currentCanvasWidth = minimumCanvasWidth;
    currentCanvasHeight = minimumCanvasHeight;
    focustreeplaceholder.style.minWidth = `${minimumCanvasWidth}px`;
    contentElement.style.minWidth = `${minimumCanvasWidth}px`;
    focustreeplaceholder.style.minHeight = `${minimumCanvasHeight}px`;
    contentElement.style.minHeight = `${minimumCanvasHeight}px`;
    rebuildRenderedFocusElementCache();
    hydrateVisibleFocusElements({ rebindDragHandlers: false });
    const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement;
    inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, renderExprs);

    bindFocusPositionDragHandlers();
    subscribeNavigators();
    updateFocusPositionEditUi();
}

function updateSelectedFocusTree(clearCondition: boolean) {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }
    applyContinuousFocusElementPosition(focusTree);

    if (useConditionInFocus) {
        const conditionExprs = getTreeConditionExprKeys(focusTree).map(exprKeyToConditionItem);
        const nextSelectedExprKeys = getSelectedExprKeysForFocusTree(focusTree, clearCondition);
        setSelectedExprsFromExprKeys(nextSelectedExprKeys);

        const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'flex' : 'none';
        }

        if (conditions) {
            conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs.map(option => `<div class="option" value='${conditionItemToExprKey(option)}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`).join('')}`;
            suppressConditionSelectionChange = true;
            conditions.selectedValues$.next(nextSelectedExprKeys);
            suppressConditionSelectionChange = false;
        }
        refreshConditionPresetUi(focusTree);

    } else {
        const presetContainerElement = document.getElementById('condition-preset-container') as HTMLDivElement | null;
        if (presetContainerElement) {
            presetContainerElement.style.display = 'none';
        }
        const allowBranchesContainerElement = document.getElementById('allowbranch-container') as HTMLDivElement | null;
        if (allowBranchesContainerElement) {
            allowBranchesContainerElement.style.display = focusTree.allowBranchOptions.length > 0 ? 'flex' : 'none';
        }

        if (allowBranches) {
            allowBranches.select.innerHTML = `<span class="value"></span>
                ${focusTree.allowBranchOptions.map(option => `<div class="option" value="inbranch_${option}">${option}</div>`).join('')}`;
            allowBranches.selectAll();
        }
    }

    const visibleInlayWindows = getVisibleInlayWindows(focusTree);
    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLDivElement | null;
    const inlayWindowsContainerElement = document.getElementById('inlay-window-container') as HTMLDivElement | null;
    if (inlayWindowsContainerElement) {
        inlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'flex' : 'none';
    }
    if (inlayWindowsElement) {
        inlayWindowsElement.innerHTML = `<span class="value"></span>
            ${visibleInlayWindows.map(inlay => `<div class="option" value="${inlay.id}">${inlay.id}</div>`).join('')}`;
        const selectedInlayWindowId = getSelectedInlayWindowId(focusTree, visibleInlayWindows.map(inlay => inlay.id));
        setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
        inlayWindows?.selectedValues$.next(selectedInlayWindowId ? [selectedInlayWindowId] : []);
    }

    renderWarningsPanel(focusTree);
}

function getWarningPanelClassNames() {
    const template = document.getElementById('warnings-entry-template') as HTMLDivElement | null;
    return {
        entry: template?.dataset.warningEntryClass ?? '',
        entryMuted: template?.dataset.warningEntryMutedClass ?? '',
        meta: template?.dataset.warningMetaClass ?? '',
        text: template?.dataset.warningTextClass ?? '',
        warning: template?.dataset.warningWarningClass ?? '',
        info: template?.dataset.warningInfoClass ?? '',
    };
}

function formatStructuredWarning(warning: FocusTree['warnings'][number]): string {
    return `[${warning.severity}][${warning.code}][${warning.kind}][${warning.source}] ${warning.text}`;
}

function renderWarningsPanel(focusTree: FocusTree) {
    const warningsElement = document.getElementById('warnings') as HTMLDivElement | null;
    if (!warningsElement) {
        return;
    }

    if (focusTree.warnings.length === 0) {
        warningsElement.innerHTML = `<div>${escapeHtml(feLocalize('TODO', 'No warnings.'))}</div>`;
        return;
    }

    const classes = getWarningPanelClassNames();
    warningsElement.innerHTML = focusTree.warnings.map((warning, index) => {
        const hasNavigation = !!warning.navigations?.length;
        const severityClass = warning.severity === 'warning' ? classes.warning : classes.info;
        const entryClass = [classes.entry, severityClass, hasNavigation ? '' : classes.entryMuted].filter(Boolean).join(' ');
        const navigationText = warning.navigations?.length
            ? feLocalize('TODO', 'Navigate')
            : feLocalize('TODO', 'No navigation');
        return `<button
            type="button"
            class="${entryClass}"
            data-warning-index="${index}"
            ${hasNavigation ? '' : 'disabled'}
            title="${escapeHtml(formatStructuredWarning(warning))}">
                <span class="${classes.meta}">${escapeHtml(`[${warning.severity}][${warning.code}][${warning.kind}][${warning.source}]`)}</span>
                <span class="${classes.text}">${escapeHtml(warning.text)}</span>
                <span class="${classes.meta}">${escapeHtml(navigationText)}</span>
            </button>`;
    }).join('');

    warningsElement.querySelectorAll<HTMLButtonElement>('[data-warning-index]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const index = Number(button.dataset.warningIndex ?? '-1');
            const warning = focusTree.warnings[index];
            const navigation = warning?.navigations?.[0];
            if (!warning || !navigation) {
                return;
            }

            vscode.postMessage({
                command: 'navigate',
                start: navigation.start,
                end: navigation.end,
                file: navigation.file,
            });
        });
    });
}

function markRenderedFocusHydrationState(content: string, hydrated: boolean): string {
    return content.replace(
        'data-focus-source-file=',
        `data-focus-hydrated="${hydrated ? 'true' : 'false'}" data-focus-source-file=`,
    );
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

function renderFocusShellHtml(focus: Focus): string {
    const sourceFile = focus.layout?.sourceFile ?? focus.file;
    const navigationFileAttribute = focus.file === (window as any).focusPositionActiveFile
        ? ''
        : ` file="${escapeHtmlAttribute(focus.file)}"`;
    return `<div
    class="navigator"
    start="${focus.token?.start}"
    end="${focus.token?.end}"${navigationFileAttribute}
    data-focus-id="${escapeHtmlAttribute(focus.id)}"
    data-focus-editable="${focus.isInCurrentFile && focus.layout?.editable === true ? 'true' : 'false'}"
    data-focus-hydrated="false"
    data-focus-source-file="${escapeHtmlAttribute(sourceFile)}"
    style="width:100%;height:100%;display:block;"></div>`;
}

function renderCurrentFocusHtml(focusTree: FocusTree, focusId: string): string | undefined {
    const focus = focusTree.focuses[focusId];
    const renderedFocus: Record<string, string> = (window as any).renderedFocus ?? {};
    const template = renderedFocus[focusId];
    if (!focus || !template) {
        return undefined;
    }

    const position = currentFocusPositions[focusId];
    if (!position) {
        return undefined;
    }

    const iconClass = getFocusIcon(focus, currentRenderedExprs, new StyleTable());
    return markRenderedFocusHydrationState(
        template
            .replace('{{position}}', `${position.x}, ${position.y}`)
            .replace('{{iconClass}}', iconClass),
        true,
    );
}

function shouldHydrateFocusElement(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return shouldHydrateFocusValue({
        alreadyHydrated: element.dataset.focusHydrated === 'true',
        isSelected: isFocusSelected(element.dataset.focusId),
        rect: {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
        },
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
    });
}

function hydrateVisibleFocusElements(options?: { rebindDragHandlers?: boolean }) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const hydratedFocusIds: string[] = [];
    currentRenderedFocusElementsList.forEach(element => {
        if (!shouldHydrateFocusElement(element)) {
            return;
        }

        const focusId = element.dataset.focusId;
        if (!focusId) {
            return;
        }

        const wrapper = document.getElementById(`focus_${focusId}`) as HTMLDivElement | null;
        const nextHtml = renderCurrentFocusHtml(currentRenderedFocusTree!, focusId);
        if (!wrapper || !nextHtml) {
            return;
        }

        wrapper.innerHTML = nextHtml;
        hydratedFocusIds.push(focusId);
    });

    if (hydratedFocusIds.length === 0) {
        return;
    }

    rebuildRenderedFocusElementCache();
    if (options?.rebindDragHandlers && focusPositionEditMode) {
        bindFocusPositionDragHandlers();
    }
    subscribeNavigators();
    setupCheckedFocuses(
        hydratedFocusIds
            .map(focusId => currentRenderedFocusTree!.focuses[focusId])
            .filter((focus): focus is Focus => !!focus),
        currentCompletableFocusIds,
    );
    updateFocusPositionEditUi();
}

function scheduleVisibleFocusHydration(force = false) {
    if (force) {
        if (pendingFocusHydrationFrame !== undefined) {
            window.cancelAnimationFrame(pendingFocusHydrationFrame);
            pendingFocusHydrationFrame = undefined;
        }
        hydrateVisibleFocusElements({ rebindDragHandlers: false });
        return;
    }

    if (pendingFocusHydrationFrame !== undefined) {
        return;
    }

    pendingFocusHydrationFrame = window.requestAnimationFrame(() => {
        pendingFocusHydrationFrame = undefined;
        hydrateVisibleFocusElements({ rebindDragHandlers: true });
    });
}

function clearCheckedFocuses() {
    for (const focusId in checkedFocuses) {
        checkedFocuses[focusId].dispose();
    }
    checkedFocuses = {};
}

function setupCheckedFocuses(focuses: Focus[], completableFocusIds: ReadonlySet<string>) {
    const focusCheckState = getState().checkedFocuses ?? {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${normalizeForStyle(focus.id)}`) as HTMLInputElement;
        if (checkbox) {
            if (completableFocusIds.has(focus.id)) {
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

function getCheckedFocusConditionExprs(): ConditionItem[] {
    const focusCheckState = getState().checkedFocuses ?? {};
    return Object.keys(focusCheckState)
        .filter(fid => focusCheckState[fid])
        .map(fid => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + fid }));
}

function getToolbarConditionExprs(focusTree: FocusTree): ConditionItem[] {
    return [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...getCheckedFocusConditionExprs(), ...selectedExprs];
}

function getVisibleInlayWindows(focusTree: FocusTree): typeof focusTree.inlayWindows {
    if (!useConditionInFocus) {
        return focusTree.inlayWindows;
    }

    const exprs = getToolbarConditionExprs(focusTree);
    return focusTree.inlayWindows.filter(inlay => applyCondition(inlay.visible, exprs));
}

function renderInlayWindows(focusTree: FocusTree, exprs: ConditionItem[]): string {
    const visibleInlayWindows = getVisibleInlayWindows(focusTree);
    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree, visibleInlayWindows.map(inlay => inlay.id));
    if (!selectedInlayWindowId) {
        return '';
    }

    const selectedInlayWindow = visibleInlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow) {
        return '';
    }

    const renderedInlayWindows: Record<string, string> = (window as any).renderedInlayWindows ?? {};
    const template = renderedInlayWindows[selectedInlayWindow.id] ?? '';
    return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return content.split(`{{inlay_slot_class:${slot.id}}}`).join(activeOption ? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile) : '');
    }, template);
}

function replaceFocusTreeDynamicStyles(dynamicStyleCss: string | undefined) {
    if (dynamicStyleCss === undefined) {
        return;
    }

    const styleElement = document.getElementById('focus-tree-dynamic-style') as HTMLStyleElement | null;
    if (styleElement) {
        styleElement.textContent = dynamicStyleCss;
    }
}

function refreshFocusTreeSelectorOptions() {
    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    ensureSelectedFocusTreeIndex();
    if (!focusesElement) {
        return;
    }

    focusesElement.innerHTML = focusTrees.map((focus, i) => `<option value="${i}">${focus.id}</option>`).join('');
    focusesElement.value = selectedFocusTreeIndex.toString();
}

function applyFocusTreePatches(focusTreePatches: Array<{ treeId: string; tree: FocusTree }> | undefined) {
    if (!focusTreePatches || focusTreePatches.length === 0) {
        return;
    }

    const patchByTreeId = new Map(focusTreePatches.map(patch => [patch.treeId, patch.tree]));
    focusTrees = focusTrees.map(focusTree => patchByTreeId.get(focusTree.id) ?? focusTree);
    (window as any).focusTrees = focusTrees;
}

function applyStringMapPatch(
    targetWindowKey: 'renderedFocus' | 'renderedInlayWindows',
    changedEntries: Record<string, string> | undefined,
    removedKeys: string[] | undefined,
) {
    if ((!changedEntries || Object.keys(changedEntries).length === 0)
        && (!removedKeys || removedKeys.length === 0)) {
        return;
    }

    const currentValue: Record<string, string> = { ...((window as any)[targetWindowKey] ?? {}) };
    if (changedEntries) {
        Object.assign(currentValue, changedEntries);
    }
    if (removedKeys) {
        removedKeys.forEach(key => {
            delete currentValue[key];
        });
    }
    (window as any)[targetWindowKey] = currentValue;
}

function applyFocusTreeContentUpdate(message: FocusTreeContentUpdateMessage & {
    dynamicStyleCss?: string;
    documentVersion?: number;
}) {
    if (message.documentVersion !== undefined && message.documentVersion < focusPositionDocumentVersion) {
        return false;
    }

    if (message.focusTrees) {
        focusTrees = message.focusTrees;
        (window as any).focusTrees = message.focusTrees;
        refreshFocusTreeSelectorOptions();
    } else if (message.focusTreePatches) {
        applyFocusTreePatches(message.focusTreePatches);
    }
    if (message.renderedFocus) {
        (window as any).renderedFocus = message.renderedFocus;
    } else {
        applyStringMapPatch('renderedFocus', message.renderedFocusPatch, message.removedRenderedFocusIds);
    }
    if (message.renderedInlayWindows) {
        (window as any).renderedInlayWindows = message.renderedInlayWindows;
    } else {
        applyStringMapPatch('renderedInlayWindows', message.renderedInlayWindowPatch, message.removedRenderedInlayWindowIds);
    }
    if (!message.focusTrees && message.focusTreePatches) {
        refreshFocusTreeSelectorOptions();
    }
    if (message.gridBox) {
        (window as any).gridBox = message.gridBox;
    }
    if (message.xGridSize !== undefined) {
        xGridSize = message.xGridSize;
        (window as any).xGridSize = message.xGridSize;
    }
    if (message.yGridSize !== undefined) {
        yGridSize = message.yGridSize;
        (window as any).yGridSize = message.yGridSize;
    }

    replaceFocusTreeDynamicStyles(message.dynamicStyleCss);
    focusPositionDocumentVersion = message.documentVersion ?? focusPositionDocumentVersion;
    return true;
}

function applyIncrementalCurrentTreeUpdate(
    focusTree: FocusTree,
    decision: FocusTreeContentUpdateDecision,
): boolean {
    currentRenderedFocusTree = focusTree;
    currentCompletableFocusIds = collectCompletedFocusIds(focusTree.conditionExprs);

    if (decision.changedCurrentTreeFocusIds.length > 0) {
        for (const focusId of decision.changedCurrentTreeFocusIds) {
            const focusElement = document.getElementById(`focus_${focusId}`) as HTMLDivElement | null;
            const nextHtml = renderCurrentFocusHtml(focusTree, focusId);
            if (!focusElement || !nextHtml) {
                return false;
            }

            focusElement.innerHTML = nextHtml;
        }

        rebuildRenderedFocusElementCache();
        bindFocusPositionDragHandlers();
        subscribeNavigators();
        clearCheckedFocuses();
        setupCheckedFocuses(Object.values(focusTree.focuses), currentCompletableFocusIds);
    }

    if (decision.shouldRefreshCurrentTreeInlay) {
        const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement | null;
        if (!inlayWindowPlaceholder) {
            return false;
        }

        inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, currentRenderedExprs);
        subscribeNavigators();
    }

    updateFocusPositionEditUi();
    scheduleVisibleFocusHydration();
    retriggerSearch();
    return true;
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
const rebuildContentSafely = tryRun(async (options?: { restoreScroll?: boolean }) => {
    await buildContent();
    if (options?.restoreScroll) {
        scrollToState();
    }
    retriggerSearch();
});

window.addEventListener('load', tryRun(async function() {
    window.addEventListener('message', event => {
        const message = event.data as {
            command?: string;
            documentVersion?: number;
            name?: string;
            focusId?: string;
            focusTreeEditKey?: string;
            targetLocalX?: number;
            targetLocalY?: number;
            targetX?: number;
            targetY?: number;
            parentFocusId?: string;
            parentFocusIds?: string[];
            childFocusId?: string;
            sourceFocusId?: string;
            targetFocusId?: string;
            focusTrees?: FocusTree[];
            renderedFocus?: Record<string, string>;
            renderedInlayWindows?: Record<string, string>;
            gridBox?: any;
            dynamicStyleCss?: string;
            xGridSize?: number;
            yGridSize?: number;
        };
        if (message.command === 'focusTreeContentUpdated') {
            const previousCurrentTree = getCurrentFocusTree();
            if (!applyFocusTreeContentUpdate(message)) {
                return;
            }

            const nextCurrentTree = getCurrentFocusTree();
            const updateDecision = getFocusTreeContentUpdateDecision(previousCurrentTree, nextCurrentTree, message);
            if (updateDecision.shouldRefreshSelectedTreeUi) {
                updateSelectedFocusTree(false);
            }

            if (updateDecision.shouldRebuildContent) {
                void rebuildContentSafely();
                return;
            }

            if (updateDecision.shouldApplyIncrementalUpdate && nextCurrentTree) {
                const appliedIncrementally = applyIncrementalCurrentTreeUpdate(nextCurrentTree, updateDecision);
                if (!appliedIncrementally) {
                    void rebuildContentSafely();
                }
            }
            return;
        }

        if (message.command === 'focusConditionPresetNameResolved') {
            const presetName = message.name?.trim();
            const targetTreeId = pendingConditionPresetTargetTreeId;
            pendingConditionPresetTargetTreeId = undefined;
            const exprKeys = pendingConditionPresetExprKeys;
            pendingConditionPresetExprKeys = [];
            if (!presetName || !targetTreeId) {
                return;
            }

            saveConditionPreset(targetTreeId, presetName, exprKeys);
            const focusTree = getCurrentFocusTree();
            if (focusTree && focusTree.id === targetTreeId) {
                refreshConditionPresetUi(focusTree);
            }
            return;
        }

        if (message.command !== 'focusPositionEditApplied'
            && message.command !== 'continuousFocusPositionEditApplied'
            && message.command !== 'focusLinkEditApplied'
            && message.command !== 'focusExclusiveLinkEditApplied') {
            return;
        }

        focusPositionDocumentVersion = message.documentVersion ?? focusPositionDocumentVersion;
        if (message.command === 'focusPositionEditApplied'
            && message.focusId !== undefined
            && message.targetLocalX !== undefined
            && message.targetLocalY !== undefined) {
            updateFocusPositionAfterApply(message.focusId, message.targetLocalX, message.targetLocalY);
        }
        if (message.command === 'continuousFocusPositionEditApplied'
            && message.focusTreeEditKey !== undefined
            && message.targetX !== undefined
            && message.targetY !== undefined) {
            updateContinuousFocusPositionAfterApply(message.focusTreeEditKey, message.targetX, message.targetY);
        }
        if (message.command === 'focusLinkEditApplied'
            && message.parentFocusId !== undefined
            && message.childFocusId !== undefined) {
            updateFocusLinkAfterApply(
                message.parentFocusId,
                message.childFocusId,
                message.targetLocalX,
                message.targetLocalY,
                message.parentFocusIds,
            );
        }
        if (message.command === 'focusExclusiveLinkEditApplied'
            && message.sourceFocusId !== undefined
            && message.targetFocusId !== undefined) {
            updateFocusExclusiveLinkAfterApply(message.sourceFocusId, message.targetFocusId);
        }

        void rebuildContentSafely();
    });

    try {
        setupFocusPositionDragHandlers();
        setupFocusSelectionMarqueeHandler();
        setupFocusTemplateCreateHandler();
        setupBlankCanvasPanFallback();
        window.addEventListener('scroll', () => {
            scheduleVisibleFocusHydration();
        }, { passive: true });
        window.addEventListener('resize', () => {
            scheduleVisibleFocusHydration();
        });

        const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
        if (focusesElement) {
            ensureSelectedFocusTreeIndex();
            focusesElement.value = selectedFocusTreeIndex.toString();
            focusesElement.addEventListener('change', async () => {
                setSelectedFocusTreeByIndex(parseInt(focusesElement.value, 10));
                updateSelectedFocusTree(true);
                await rebuildContentSafely();
            });
        }

        const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLDivElement | null;
        if (inlayWindowsElement) {
            inlayWindows = new DivDropdown(inlayWindowsElement);
            let previousSelection = inlayWindows.selectedValues$.value[0];
            inlayWindows.selectedValues$.subscribe(async selection => {
                const focusTree = getCurrentFocusTree();
                const nextSelection = selection[0];
                if (!focusTree || previousSelection === nextSelection) {
                    return;
                }

                previousSelection = nextSelection;
                setSelectedInlayWindowId(focusTree, nextSelection);
                await rebuildContentSafely();
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
            const conditionPresetsElement = document.getElementById('condition-presets') as HTMLDivElement | null;
            if (conditionPresetsElement) {
                conditionPresetsDropdown = new DivDropdown(conditionPresetsElement);
                conditionPresetsDropdown.selectedValues$.subscribe(async selection => {
                    if (suppressConditionPresetSelectionChange) {
                        return;
                    }

                    const focusTree = getCurrentFocusTree();
                    const nextSelection = selection[0];
                    if (!focusTree) {
                        return;
                    }
                    if (!nextSelection || nextSelection === '__custom__') {
                        refreshConditionPresetUi(focusTree);
                        return;
                    }

                    const preset = getConditionPresetsForTree(focusTree.id).find(currentPreset => currentPreset.id === nextSelection);
                    if (!preset) {
                        refreshConditionPresetUi(focusTree);
                        return;
                    }

                    const filteredExprKeys = filterConditionPresetExprKeys(preset.exprKeys, getTreeConditionExprKeys(focusTree));
                    setSelectedExprsFromExprKeys(filteredExprKeys);
                    if (conditions) {
                        suppressConditionSelectionChange = true;
                        conditions.selectedValues$.next(filteredExprKeys);
                        suppressConditionSelectionChange = false;
                    }
                    refreshConditionPresetUi(focusTree);
                    await rebuildContentSafely();
                });
            }

            const saveConditionPresetButton = document.getElementById('save-condition-preset') as HTMLButtonElement | null;
            saveConditionPresetButton?.addEventListener('click', () => {
                const focusTree = getCurrentFocusTree();
                if (!focusTree) {
                    return;
                }

                pendingConditionPresetTargetTreeId = focusTree.id;
                pendingConditionPresetExprKeys = getSelectedExprKeys();
                vscode.postMessage({
                    command: 'promptFocusConditionPresetName',
                    initialValue: getSelectedConditionPreset(focusTree)?.name ?? '',
                });
            });

            const deleteConditionPresetButton = document.getElementById('delete-condition-preset') as HTMLButtonElement | null;
            deleteConditionPresetButton?.addEventListener('click', async () => {
                const focusTree = getCurrentFocusTree();
                const selectedPreset = focusTree ? getSelectedConditionPreset(focusTree) : undefined;
                if (!focusTree || !selectedPreset) {
                    return;
                }

                setConditionPresetsForTree(
                    focusTree.id,
                    getConditionPresetsForTree(focusTree.id).filter(preset => preset.id !== selectedPreset.id),
                );
                refreshConditionPresetUi(focusTree);
                await rebuildContentSafely();
            });

            const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
            if (conditionsElement) {
                conditions = new DivDropdown(conditionsElement, true);
                conditions.selectedValues$.subscribe(async (selection) => {
                    if (suppressConditionSelectionChange) {
                        return;
                    }

                    const focusTree = getCurrentFocusTree();
                    if (!focusTree) {
                        return;
                    }

                    setSelectedExprsFromExprKeys(selection);
                    refreshConditionPresetUi(focusTree);

                    await rebuildContentSafely();
                });
            }
        }

        const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
        enableZoom(contentElement, 0, focusToolbarHeight);
        setPreviewPanDisabled(focusPositionEditMode);

        const focusPositionEditButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
        focusPositionEditButton?.addEventListener('click', async () => {
            setFocusPositionEditMode(!focusPositionEditMode);
            await rebuildContentSafely();
        });

        const showWarnings = document.getElementById('show-warnings') as HTMLButtonElement;
        if (showWarnings) {
            const warnings = document.getElementById('warnings-container') as HTMLDivElement;
            showWarnings.addEventListener('click', () => {
                const visible = warnings.style.display === 'block';
                document.body.style.overflow = visible ? '' : 'hidden';
                warnings.style.display = visible ? 'none' : 'block';
            });
        }

        updateSelectedFocusTree(false);
        await rebuildContentSafely({ restoreScroll: true });
    } finally {
        vscode.postMessage({ command: 'focusTreeWebviewReady' });
    }
}));
