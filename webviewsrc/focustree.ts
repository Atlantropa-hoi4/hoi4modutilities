import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom, setPreviewPanDisabled, startPreviewPan } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { difference, minBy } from "lodash";
import { renderGridBoxCommon, GridBoxItem, GridBoxConnection } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable, normalizeForStyle } from "../src/util/styletable";
import { FocusTree, Focus } from "../src/previewdef/focustree/schema";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { Checkbox } from "./util/checkbox";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import { evaluateFocusBadgeState } from "../src/previewdef/focustree/focusbadges";
import { collectFocusRelationVisualizationState } from "../src/previewdef/focustree/focusrelations";
import {
    buildFocusMinimapModel,
    createFocusMinimapTransform,
    getFocusMinimapViewportRect,
    getScrollTargetForCanvasPoint,
    projectCanvasPointToMinimap,
    projectMinimapPointToCanvas,
} from "../src/previewdef/focustree/focusminimap";
import { getFocusPosition, getLocalPositionFromRenderedAbsolute } from "../src/previewdef/focustree/positioning";
import {
    conditionItemToExprKey,
    customConditionPresetId,
    deleteConditionPreset,
    exprKeyToConditionItem,
    filterConditionExprKeys,
    findMatchingConditionPresetId,
    FocusConditionPreset,
    normalizeConditionExprKeys,
} from "../src/previewdef/focustree/conditionpresets";

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
                setLastNavigatedFocusId(focus.dataset.focusId ?? focus.id.replace(/^focus_/, ''));
                navigated = true;
            }
            searchedFocus.push(focus);
        } else {
            focus.style.outlineWidth = '0';
            focus.style.background = 'transparent';
        }
    }

    currentSearchedFocusIds = new Set(searchedFocus.map(focus => focus.dataset.focusId ?? focus.id.replace(/^focus_/, '')).filter(Boolean));
    updateFocusMinimapUi();

    return searchedFocus;
}

const useConditionInFocus: boolean = (window as any).useConditionInFocus;
let focusTrees: FocusTree[] = (window as any).focusTrees;
type PendingFocusLinkType = 'prerequisite' | 'exclusive';
type ActiveRelationMode = 'idle' | 'hover' | 'selection' | 'pending-link';
type FocusConditionPresetTestAction =
    | 'snapshot'
    | 'selectConditions'
    | 'savePreset'
    | 'applyPreset'
    | 'deletePreset';
type FocusConditionPresetTestMessage = {
    command: 'focusConditionPresetTest';
    requestId: string;
    action: FocusConditionPresetTestAction;
    name?: string;
    presetId?: string;
    exprKeys?: string[];
};
type FocusConditionPresetTestSnapshot = {
    treeId: string;
    availableExprKeys: string[];
    selectedExprKeys: string[];
    selectedPresetId?: string;
    presets: Array<{
        id: string;
        name: string;
        exprKeys: string[];
    }>;
};

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedConditionExprKeysByTree: Record<string, string[]> = getState().selectedConditionExprKeysByTree ?? {};
let conditionPresetsByTree: Record<string, FocusConditionPreset[]> = getState().conditionPresetsByTree ?? {};
let selectedConditionPresetIdByTree: Record<string, string | undefined> = getState().selectedConditionPresetIdByTree ?? {};
let selectedFocusTreeIndex: number = Math.min(focusTrees.length - 1, getState().selectedFocusTreeIndex ?? 0);
let selectedFocusIdsByTree: Record<string, string[]> = getState().selectedFocusIdsByTree ?? {};
let allowBranches: DivDropdown | undefined = undefined;
let conditions: DivDropdown | undefined = undefined;
let conditionPresets: DivDropdown | undefined = undefined;
let inlayWindows: DivDropdown | undefined = undefined;
let checkedFocuses: Record<string, Checkbox> = {};
let focusPositionEditMode: boolean = !!getState().focusPositionEditMode;
let currentRenderedFocusTree: FocusTree | undefined = undefined;
let currentFocusPositions: Record<string, NumberPosition> = {};
let currentRenderedFocusElements: Record<string, HTMLElement> = {};
let currentRenderedFocusElementsList: HTMLElement[] = [];
let currentRenderedRelationElementsList: HTMLElement[] = [];
let currentOccupiedFocusPositionKeys = new Set<string>();
let currentSelectedFocusIds = new Set<string>();
let persistedRelationFocusIds = new Set<string>();
let currentSearchedFocusIds = new Set<string>();
let currentRenderedExprs: ConditionItem[] = [];
let focusPositionDragBindings: Array<{ element: HTMLElement; handler: (event: MouseEvent) => void }> = [];
let focusPositionDocumentVersion: number = (window as any).focusPositionDocumentVersion ?? 0;
let suppressEditableFocusClickUntil = 0;
let pendingFocusLinkParentId: string | undefined = undefined;
let pendingFocusLinkType: PendingFocusLinkType | undefined = undefined;
let hoveredRelationFocusId: string | undefined = undefined;
let activeRelationMode: ActiveRelationMode = 'idle';
let focusNavigateTimer: number | undefined = undefined;
let focusContextMenuTargetId: string | undefined = undefined;
let pendingConditionPresetSaveRequest = false;
let suppressConditionSelectionChange = false;
let suppressConditionPresetSelectionChange = false;
let focusMinimapCollapsed: boolean = !!getState().focusMinimapCollapsed;
let lastNavigatedFocusIdByTree: Record<string, string | undefined> = getState().lastNavigatedFocusIdByTree ?? {};
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
type FocusSelectionRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ActiveFocusSelectionMarquee = {
    startClientX: number;
    startClientY: number;
    dragGestureStarted: boolean;
};
let activeFocusSelectionMarquee: ActiveFocusSelectionMarquee | undefined = undefined;
let activeFocusMinimapDrag = false;

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

function rebuildRenderedRelationElementCache() {
    currentRenderedRelationElementsList = Array.from(
        document.querySelectorAll<HTMLElement>('.focus-relation-line[data-relation-kind][data-source-focus-id][data-target-focus-id]'),
    );
}

function getCurrentSelectionTreeId(): string | undefined {
    return currentRenderedFocusTree?.id ?? focusTrees[selectedFocusTreeIndex]?.id;
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

function getCurrentSelectedConditionExprKeys(): string[] {
    return normalizeConditionExprKeys(selectedExprs.map(conditionItemToExprKey));
}

function persistConditionPresetState() {
    setState({
        conditionPresetsByTree,
        selectedConditionPresetIdByTree,
        selectedConditionExprKeysByTree,
    });
}

function getConditionPresetsForTree(treeId: string): FocusConditionPreset[] {
    return conditionPresetsByTree[treeId] ?? [];
}

function setConditionPresetsForTree(treeId: string, presets: FocusConditionPreset[]) {
    const nextConditionPresetsByTree = { ...conditionPresetsByTree };
    if (presets.length === 0) {
        delete nextConditionPresetsByTree[treeId];
    } else {
        nextConditionPresetsByTree[treeId] = presets;
    }

    conditionPresetsByTree = nextConditionPresetsByTree;
    persistConditionPresetState();
}

function setSelectedConditionPresetId(treeId: string, presetId: string | undefined) {
    const nextSelectedConditionPresetIdByTree = { ...selectedConditionPresetIdByTree };
    if (!presetId) {
        delete nextSelectedConditionPresetIdByTree[treeId];
    } else {
        nextSelectedConditionPresetIdByTree[treeId] = presetId;
    }

    selectedConditionPresetIdByTree = nextSelectedConditionPresetIdByTree;
    persistConditionPresetState();
}

function setSelectedConditionExprKeysForTree(treeId: string, exprKeys: string[]) {
    const nextSelectedConditionExprKeysByTree = { ...selectedConditionExprKeysByTree };
    if (exprKeys.length === 0) {
        delete nextSelectedConditionExprKeysByTree[treeId];
    } else {
        nextSelectedConditionExprKeysByTree[treeId] = exprKeys;
    }

    selectedConditionExprKeysByTree = nextSelectedConditionExprKeysByTree;
    persistConditionPresetState();
}

function syncCurrentSelectedConditionPresetId(focusTree: FocusTree) {
    const treeId = focusTree.id;
    const matchingPresetId = findMatchingConditionPresetId(getConditionPresetsForTree(treeId), getCurrentSelectedConditionExprKeys());
    setSelectedConditionPresetId(treeId, matchingPresetId);
    return matchingPresetId;
}

function updateConditionPresetUi(focusTree: FocusTree) {
    const container = document.getElementById('condition-preset-container') as HTMLDivElement | null;
    if (container) {
        container.style.display = useConditionInFocus ? 'flex' : 'none';
    }

    const saveButton = document.getElementById('save-condition-preset') as HTMLButtonElement | null;
    const deleteButton = document.getElementById('delete-condition-preset') as HTMLButtonElement | null;
    if (saveButton) {
        saveButton.disabled = !useConditionInFocus;
    }

    const presetsElement = document.getElementById('condition-presets') as HTMLDivElement | null;
    if (!presetsElement || !conditionPresets) {
        if (deleteButton) {
            deleteButton.disabled = true;
        }
        return;
    }

    const presets = getConditionPresetsForTree(focusTree.id);
    presetsElement.innerHTML = `<span class="value"></span>
        <div class="option" value="${customConditionPresetId}">(Custom)</div>
        ${presets.map(preset => `<div class="option" value="${preset.id}">${preset.name}</div>`).join('')}`;

    const selectedPresetId = selectedConditionPresetIdByTree[focusTree.id];
    suppressConditionPresetSelectionChange = true;
    conditionPresets.selectedValues$.next([selectedPresetId ?? customConditionPresetId]);
    suppressConditionPresetSelectionChange = false;

    if (deleteButton) {
        deleteButton.disabled = !selectedPresetId;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildConditionPresetTestSnapshot(focusTree: FocusTree): FocusConditionPresetTestSnapshot {
    return {
        treeId: focusTree.id,
        availableExprKeys: getTreeConditionExprKeys(focusTree),
        selectedExprKeys: getCurrentSelectedConditionExprKeys(),
        selectedPresetId: selectedConditionPresetIdByTree[focusTree.id],
        presets: getConditionPresetsForTree(focusTree.id).map(preset => ({
            id: preset.id,
            name: preset.name,
            exprKeys: [...preset.exprKeys],
        })),
    };
}

function setSelectedExprsForFocusTree(
    focusTree: FocusTree,
    exprKeys: readonly string[],
    options?: { persistSelection?: boolean; syncPreset?: boolean; updateDropdown?: boolean },
) {
    const nextExprKeys = filterConditionExprKeys(exprKeys, getTreeConditionExprKeys(focusTree));
    selectedExprs = nextExprKeys.map(exprKeyToConditionItem);
    setState({ selectedExprs });
    if (options?.persistSelection !== false) {
        setSelectedConditionExprKeysForTree(focusTree.id, nextExprKeys);
    }

    if (conditions && options?.updateDropdown !== false) {
        suppressConditionSelectionChange = true;
        conditions.selectedValues$.next(nextExprKeys);
        suppressConditionSelectionChange = false;
    }

    if (options?.syncPreset !== false) {
        syncCurrentSelectedConditionPresetId(focusTree);
        updateConditionPresetUi(focusTree);
    }
}

function restoreSelectedExprsForFocusTree(focusTree: FocusTree, clearCondition: boolean) {
    const storedExprKeys = clearCondition ? [] : (selectedConditionExprKeysByTree[focusTree.id] ?? []);
    setSelectedExprsForFocusTree(focusTree, storedExprKeys, { persistSelection: true, syncPreset: true, updateDropdown: true });
}

function createConditionPresetId(): string {
    return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentFocusTree(): FocusTree | undefined {
    return focusTrees[selectedFocusTreeIndex];
}

function requestSaveCurrentConditionPreset() {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }

    pendingConditionPresetSaveRequest = true;
    vscode.postMessage({
        command: 'promptFocusConditionPresetName',
        initialValue: '',
    });
}

function saveCurrentConditionPreset(name: string) {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
        return;
    }

    const exprKeys = getCurrentSelectedConditionExprKeys();
    const existingPresets = getConditionPresetsForTree(focusTree.id);
    const existingPreset = existingPresets.find(preset => preset.name.toLowerCase() === trimmedName.toLowerCase());
    const presetId = existingPreset?.id ?? createConditionPresetId();
    const nextPreset: FocusConditionPreset = {
        id: presetId,
        name: trimmedName,
        exprKeys,
    };
    const nextPresets = existingPreset
        ? existingPresets.map(preset => preset.id === presetId ? nextPreset : preset)
        : [...existingPresets, nextPreset];
    setConditionPresetsForTree(focusTree.id, nextPresets);
    setSelectedConditionPresetId(focusTree.id, presetId);
    updateConditionPresetUi(focusTree);
}

function deleteCurrentConditionPreset() {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }

    const selectedPresetId = selectedConditionPresetIdByTree[focusTree.id];
    if (!selectedPresetId) {
        return;
    }

    const remainingPresets = deleteConditionPreset(getConditionPresetsForTree(focusTree.id), selectedPresetId);
    setConditionPresetsForTree(focusTree.id, remainingPresets);
    syncCurrentSelectedConditionPresetId(focusTree);
    updateConditionPresetUi(focusTree);
}

async function applyConditionPresetById(focusTree: FocusTree, selectedPresetId: string) {
    const preset = getConditionPresetsForTree(focusTree.id).find(candidate => candidate.id === selectedPresetId);
    if (!preset) {
        syncCurrentSelectedConditionPresetId(focusTree);
        updateConditionPresetUi(focusTree);
        throw new Error(`Unknown condition preset id: ${selectedPresetId}`);
    }

    const filteredExprKeys = filterConditionExprKeys(preset.exprKeys, getTreeConditionExprKeys(focusTree));
    setSelectedExprsForFocusTree(focusTree, filteredExprKeys, {
        persistSelection: true,
        syncPreset: true,
        updateDropdown: true,
    });

    if (preset.exprKeys.length > 0 && filteredExprKeys.length === 0) {
        vscode.postMessage({
            command: 'showFocusConditionPresetWarning',
            message: 'Saved condition preset no longer matches this tree.',
        });
    }

    await buildContent();
}

async function handleConditionPresetTestMessage(message: FocusConditionPresetTestMessage) {
    const respond = (payload: { snapshot?: FocusConditionPresetTestSnapshot; error?: string }) => {
        vscode.postMessage({
            command: 'focusConditionPresetTestResponse',
            requestId: message.requestId,
            ...payload,
        });
    };

    try {
        const focusTree = getCurrentFocusTree();
        if (!focusTree) {
            throw new Error('No focus tree is currently selected.');
        }

        if (message.action === 'selectConditions') {
            setSelectedExprsForFocusTree(focusTree, normalizeConditionExprKeys(message.exprKeys ?? []), {
                persistSelection: true,
                syncPreset: true,
                updateDropdown: true,
            });
            await buildContent();
            retriggerSearch();
            respond({ snapshot: buildConditionPresetTestSnapshot(focusTree) });
            return;
        }

        if (message.action === 'savePreset') {
            if (!message.name) {
                throw new Error('A preset name is required to save a condition preset.');
            }

            saveCurrentConditionPreset(message.name);
            await buildContent();
            retriggerSearch();
            respond({ snapshot: buildConditionPresetTestSnapshot(focusTree) });
            return;
        }

        if (message.action === 'applyPreset') {
            if (!message.presetId) {
                throw new Error('A preset id is required to apply a condition preset.');
            }

            await applyConditionPresetById(focusTree, message.presetId);
            retriggerSearch();
            respond({ snapshot: buildConditionPresetTestSnapshot(focusTree) });
            return;
        }

        if (message.action === 'deletePreset') {
            deleteCurrentConditionPreset();
            await buildContent();
            retriggerSearch();
            respond({ snapshot: buildConditionPresetTestSnapshot(focusTree) });
            return;
        }

        respond({ snapshot: buildConditionPresetTestSnapshot(focusTree) });
    } catch (error) {
        respond({ error: error instanceof Error ? error.message : String(error) });
    }
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
    persistedRelationFocusIds = new Set(nextSelectedFocusIds);
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
    persistedRelationFocusIds = new Set(nextSelectedFocusIds);
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

function getCurrentScale(): number {
    return getState().scale || 1;
}

function getCurrentLastNavigatedFocusId(): string | undefined {
    const treeId = getCurrentSelectionTreeId();
    return treeId ? lastNavigatedFocusIdByTree[treeId] : undefined;
}

function setLastNavigatedFocusId(focusId: string | undefined) {
    const treeId = getCurrentSelectionTreeId();
    if (!treeId) {
        return;
    }

    const nextLastNavigatedFocusIdByTree = { ...lastNavigatedFocusIdByTree };
    if (!focusId) {
        delete nextLastNavigatedFocusIdByTree[treeId];
    } else {
        nextLastNavigatedFocusIdByTree[treeId] = focusId;
    }

    lastNavigatedFocusIdByTree = nextLastNavigatedFocusIdByTree;
    setState({ lastNavigatedFocusIdByTree });
    updateFocusMinimapUi();
}

function getContentPageOrigin(): NumberPosition {
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    const rect = contentElement?.getBoundingClientRect();
    return {
        x: (rect?.left ?? 0) + window.scrollX,
        y: (rect?.top ?? 0) + window.scrollY,
    };
}

function scrollCanvasPointIntoView(canvasPoint: NumberPosition) {
    const origin = getContentPageOrigin();
    const target = getScrollTargetForCanvasPoint({
        canvasPoint,
        contentPageLeft: origin.x,
        contentPageTop: origin.y,
        scale: getCurrentScale(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
    });
    window.scrollTo(Math.max(0, target.x), Math.max(0, target.y));
}

function navigatePreviewToFocusId(focusId: string, options?: { updateLastNavigated?: boolean }) {
    const focusPosition = currentFocusPositions[focusId];
    if (!focusPosition) {
        return;
    }

    const center = projectFocusPositionToCanvas(focusPosition);
    scrollCanvasPointIntoView(center);
    if (options?.updateLastNavigated !== false) {
        setLastNavigatedFocusId(focusId);
    }
}

function navigatePreviewToContinuousFocus() {
    const center = getCurrentContinuousFocusCanvasCenter();
    if (!center) {
        return;
    }

    scrollCanvasPointIntoView(center);
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

function getCurrentContinuousFocusCanvasCenter(): NumberPosition | undefined {
    const focusTree = currentRenderedFocusTree ?? focusTrees[selectedFocusTreeIndex];
    if (!focusTree
        || focusTree.continuousFocusPositionX === undefined
        || focusTree.continuousFocusPositionY === undefined) {
        return undefined;
    }

    const displayPosition = getContinuousFocusDisplayPositionFromStored(
        focusTree.continuousFocusPositionX,
        focusTree.continuousFocusPositionY,
    );
    return {
        x: displayPosition.x + continuousFocusWidth / 2,
        y: displayPosition.y + continuousFocusHeight / 2,
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

function getActiveRelationFocusIds(): string[] {
    if (hasPendingFocusLink() && pendingFocusLinkParentId) {
        activeRelationMode = 'pending-link';
        return [pendingFocusLinkParentId];
    }

    if (focusPositionEditMode && persistedRelationFocusIds.size > 0) {
        activeRelationMode = 'selection';
        return Array.from(persistedRelationFocusIds);
    }

    if (hoveredRelationFocusId && currentRenderedFocusTree?.focuses[hoveredRelationFocusId]) {
        activeRelationMode = 'hover';
        return [hoveredRelationFocusId];
    }

    activeRelationMode = 'idle';
    return [];
}

function ensureFocusRelationSummaryOverlay(): HTMLDivElement {
    let overlay = document.getElementById('focus-relation-summary-overlay') as HTMLDivElement | null;
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'focus-relation-summary-overlay';
    overlay.style.position = 'fixed';
    overlay.style.display = 'none';
    overlay.style.minWidth = '190px';
    overlay.style.maxWidth = '260px';
    overlay.style.padding = '8px 10px';
    overlay.style.border = '1px solid var(--vscode-panel-border)';
    overlay.style.background = 'var(--vscode-editorHoverWidget-background, var(--vscode-editor-background))';
    overlay.style.color = 'var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))';
    overlay.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.32)';
    overlay.style.whiteSpace = 'pre-line';
    overlay.style.lineHeight = '1.35';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1040';
    document.body.appendChild(overlay);
    return overlay;
}

function hideFocusRelationSummaryOverlay() {
    const overlay = document.getElementById('focus-relation-summary-overlay') as HTMLDivElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function getRelationSummaryAnchorFocusId(activeFocusIds: readonly string[]): string | undefined {
    if (hasPendingFocusLink()) {
        return pendingFocusLinkParentId;
    }

    if (persistedRelationFocusIds.size > 0) {
        return activeFocusIds.find(focusId => !!currentRenderedFocusElements[focusId]);
    }

    return hoveredRelationFocusId;
}

function getRelationLintSummaryLine(focusTree: FocusTree, activeFocusIds: readonly string[]): string | undefined {
    const lintMessages = Array.from(new Set(
        activeFocusIds
            .map(focusId => focusTree.focuses[focusId]?.lintMessages ?? [])
            .flat(),
    ));

    if (lintMessages.length === 0) {
        return undefined;
    }

    const summary = lintMessages.slice(0, 2).join('; ');
    const suffix = lintMessages.length > 2
        ? feLocalize('TODO', ' (+{0} more)', lintMessages.length - 2)
        : '';
    return feLocalize('TODO', 'Lint: {0}{1}', summary, suffix);
}

function updateFocusRelationSummaryOverlay(activeFocusIds: readonly string[]) {
    if (!currentRenderedFocusTree || activeFocusIds.length === 0) {
        hideFocusRelationSummaryOverlay();
        return;
    }

    const anchorFocusId = getRelationSummaryAnchorFocusId(activeFocusIds);
    if (!anchorFocusId) {
        hideFocusRelationSummaryOverlay();
        return;
    }

    const anchorElement = currentRenderedFocusElements[anchorFocusId];
    if (!anchorElement) {
        hideFocusRelationSummaryOverlay();
        return;
    }

    const relationState = collectFocusRelationVisualizationState(currentRenderedFocusTree, activeFocusIds);
    const overlay = ensureFocusRelationSummaryOverlay();
    const heading = activeRelationMode === 'pending-link'
        ? feLocalize('TODO', 'Link source relations')
        : activeFocusIds.length > 1
            ? feLocalize('TODO', 'Selected relations ({0})', activeFocusIds.length)
            : feLocalize('TODO', 'Relations for {0}', anchorFocusId);
    const lines = [
        heading,
        feLocalize('TODO', 'Prerequisites: {0} focus(es) across {1} group(s)', relationState.prerequisiteFocusCount, relationState.prerequisiteGroupCount),
        feLocalize('TODO', 'Mutually exclusive: {0} focus(es)', relationState.exclusiveCount),
    ];
    if (relationState.hasGroupedPrerequisite) {
        lines.push(feLocalize('TODO', 'Dashed lines indicate grouped prerequisites.'));
    }
    const lintLine = getRelationLintSummaryLine(currentRenderedFocusTree, activeFocusIds);
    if (lintLine) {
        lines.push(lintLine);
    }

    overlay.textContent = lines.join('\n');
    overlay.style.display = 'block';
    const anchorRect = anchorElement.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const preferredLeft = Math.min(
        anchorRect.right + 12,
        Math.max(8, window.innerWidth - overlayRect.width - 8),
    );
    const fallbackLeft = Math.max(8, anchorRect.left - overlayRect.width - 12);
    overlay.style.left = `${preferredLeft >= anchorRect.left ? preferredLeft : fallbackLeft}px`;
    overlay.style.top = `${Math.min(
        Math.max(8, anchorRect.bottom + 8),
        Math.max(8, window.innerHeight - overlayRect.height - 8),
    )}px`;
}

function updateFocusRelationVisualizationUi() {
    const activeFocusIds = getActiveRelationFocusIds();
    if (!currentRenderedFocusTree || activeFocusIds.length === 0) {
        currentRenderedRelationElementsList.forEach(element => {
            element.style.opacity = '';
            element.style.filter = '';
            element.style.zIndex = '';
        });
        currentRenderedFocusElementsList.forEach(element => {
            element.style.opacity = '';
        });
        hideFocusRelationSummaryOverlay();
        return;
    }

    const relationState = collectFocusRelationVisualizationState(currentRenderedFocusTree, activeFocusIds);
    const activeFocusIdSet = new Set(relationState.activeFocusIds);
    const relatedFocusIdSet = new Set(relationState.relatedFocusIds);

    currentRenderedRelationElementsList.forEach(element => {
        const relationKind = element.dataset.relationKind;
        const sourceFocusId = element.dataset.sourceFocusId;
        const targetFocusId = element.dataset.targetFocusId;
        const relevant = relationKind === 'prerequisite'
            ? !!sourceFocusId && activeFocusIdSet.has(sourceFocusId)
            : (!!sourceFocusId && activeFocusIdSet.has(sourceFocusId))
                || (!!targetFocusId && activeFocusIdSet.has(targetFocusId));

        element.style.opacity = relevant ? '1' : '0.12';
        element.style.filter = relevant
            ? relationKind === 'exclusive'
                ? 'drop-shadow(0 0 2px rgba(255, 96, 96, 0.7))'
                : 'drop-shadow(0 0 2px rgba(136, 170, 255, 0.7))'
            : '';
        element.style.zIndex = relevant ? '1' : '0';
    });

    currentRenderedFocusElementsList.forEach(element => {
        const focusId = element.dataset.focusId;
        if (!focusId) {
            return;
        }

        element.style.opacity = relatedFocusIdSet.has(focusId) ? '1' : '0.55';
    });

    updateFocusRelationSummaryOverlay(activeFocusIds);
}

function updateFocusMinimapCollapsedUi() {
    const minimap = document.getElementById('focus-minimap') as HTMLDivElement | null;
    const minimapBody = document.getElementById('focus-minimap-body') as HTMLDivElement | null;
    const toggleButton = document.getElementById('toggle-focus-minimap') as HTMLButtonElement | null;
    if (!minimap || !minimapBody || !toggleButton) {
        return;
    }

    minimapBody.style.display = focusMinimapCollapsed ? 'none' : 'flex';
    minimap.style.width = focusMinimapCollapsed ? 'auto' : '188px';
    toggleButton.innerHTML = `<i class="codicon ${focusMinimapCollapsed ? 'codicon-chevron-left' : 'codicon-chevron-down'}"></i>`;
    toggleButton.setAttribute('aria-pressed', focusMinimapCollapsed ? 'true' : 'false');
}

function getFocusMinimapElements() {
    return {
        minimap: document.getElementById('focus-minimap') as HTMLDivElement | null,
        canvas: document.getElementById('focus-minimap-canvas') as HTMLDivElement | null,
        points: document.getElementById('focus-minimap-points') as HTMLDivElement | null,
        viewport: document.getElementById('focus-minimap-viewport') as HTMLDivElement | null,
        tooltip: document.getElementById('focus-minimap-tooltip') as HTMLDivElement | null,
        jumpToSelected: document.getElementById('jump-to-selected') as HTMLButtonElement | null,
        jumpToContinuous: document.getElementById('jump-to-continuous') as HTMLButtonElement | null,
    };
}

function updateFocusMinimapTooltip(canvas: HTMLDivElement, tooltip: HTMLDivElement, clientX: number, clientY: number) {
    if (!currentRenderedFocusTree) {
        tooltip.style.display = 'none';
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const transform = createFocusMinimapTransform(currentCanvasWidth, currentCanvasHeight, rect.width, rect.height, 8);
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    const model = buildFocusMinimapModel({
        positions: currentFocusPositions,
        xGridSize,
        yGridSize,
        leftPadding: currentGridLeftPadding,
        topPadding: currentGridTopPadding,
        canvasWidth: currentCanvasWidth,
        canvasHeight: currentCanvasHeight,
        selectedFocusIds: currentSelectedFocusIds,
        searchedFocusIds: currentSearchedFocusIds,
        lastNavigatedFocusId: getCurrentLastNavigatedFocusId(),
        continuousCanvasPoint: getCurrentContinuousFocusCanvasCenter(),
    });

    let nearestLabel: string | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const focusPoint of model.points) {
        const minimapPoint = projectCanvasPointToMinimap({ x: focusPoint.canvasX, y: focusPoint.canvasY }, transform);
        const dx = minimapPoint.x - point.x;
        const dy = minimapPoint.y - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestLabel = focusPoint.focusId;
        }
    }
    if (model.continuousPoint) {
        const minimapPoint = projectCanvasPointToMinimap(
            { x: model.continuousPoint.canvasX, y: model.continuousPoint.canvasY },
            transform,
        );
        const dx = minimapPoint.x - point.x;
        const dy = minimapPoint.y - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestLabel = model.continuousPoint.label;
        }
    }

    if (!nearestLabel || nearestDistance > 14) {
        tooltip.style.display = 'none';
        return;
    }

    tooltip.textContent = nearestLabel;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(point.x + 10, rect.width - tooltip.offsetWidth - 4)}px`;
    tooltip.style.top = `${Math.min(point.y + 10, rect.height - tooltip.offsetHeight - 4)}px`;
}

function updateFocusMinimapUi() {
    const { minimap, canvas, points, viewport, tooltip, jumpToSelected, jumpToContinuous } = getFocusMinimapElements();
    if (!minimap || !canvas || !points || !viewport || !tooltip) {
        return;
    }

    updateFocusMinimapCollapsedUi();
    if (focusMinimapCollapsed) {
        return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const transform = createFocusMinimapTransform(currentCanvasWidth, currentCanvasHeight, canvasRect.width, canvasRect.height, 8);
    const minimapModel = buildFocusMinimapModel({
        positions: currentFocusPositions,
        xGridSize,
        yGridSize,
        leftPadding: currentGridLeftPadding,
        topPadding: currentGridTopPadding,
        canvasWidth: currentCanvasWidth,
        canvasHeight: currentCanvasHeight,
        selectedFocusIds: currentSelectedFocusIds,
        searchedFocusIds: currentSearchedFocusIds,
        lastNavigatedFocusId: getCurrentLastNavigatedFocusId(),
        continuousCanvasPoint: getCurrentContinuousFocusCanvasCenter(),
    });

    const focusPointMarkup = minimapModel.points.map(point => {
        const projected = projectCanvasPointToMinimap({ x: point.canvasX, y: point.canvasY }, transform);
        const size = point.isSelected ? 6 : point.isSearched ? 5 : 4;
        const background = point.isSelected
            ? 'rgba(96, 196, 255, 1)'
            : point.isSearched
                ? 'rgba(255, 96, 96, 1)'
                : point.isLastNavigated
                    ? 'rgba(255, 196, 64, 1)'
                    : 'rgba(180, 180, 180, 0.9)';
        const border = point.isLastNavigated ? '1px solid rgba(255, 196, 64, 1)' : '1px solid rgba(0, 0, 0, 0.35)';
        return `<div data-focus-id="${escapeHtml(point.focusId)}" style="
            position:absolute;
            left:${projected.x - size / 2}px;
            top:${projected.y - size / 2}px;
            width:${size}px;
            height:${size}px;
            border-radius:999px;
            background:${background};
            border:${border};
            box-sizing:border-box;
        "></div>`;
    }).join('');
    const continuousPointMarkup = minimapModel.continuousPoint ? (() => {
        const projected = projectCanvasPointToMinimap(
            { x: minimapModel.continuousPoint!.canvasX, y: minimapModel.continuousPoint!.canvasY },
            transform,
        );
        return `<div data-continuous-point="true" style="
            position:absolute;
            left:${projected.x - 4}px;
            top:${projected.y - 4}px;
            width:8px;
            height:8px;
            border-radius:2px;
            background:rgba(255, 196, 64, 0.95);
            border:1px solid rgba(0, 0, 0, 0.45);
            box-sizing:border-box;
        "></div>`;
    })() : '';
    points.innerHTML = focusPointMarkup + continuousPointMarkup;

    const viewportRect = getFocusMinimapViewportRect({
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        contentPageLeft: getContentPageOrigin().x,
        contentPageTop: getContentPageOrigin().y,
        scale: getCurrentScale(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        transform,
        canvasWidth: currentCanvasWidth,
        canvasHeight: currentCanvasHeight,
    });
    viewport.style.display = minimapModel.points.length > 0 ? 'block' : 'none';
    viewport.style.left = `${viewportRect.left}px`;
    viewport.style.top = `${viewportRect.top}px`;
    viewport.style.width = `${viewportRect.width}px`;
    viewport.style.height = `${viewportRect.height}px`;
    tooltip.style.display = 'none';

    if (jumpToSelected) {
        jumpToSelected.disabled = currentSelectedFocusIds.size === 0;
    }
    if (jumpToContinuous) {
        const continuous = document.getElementById('continuousFocuses') as HTMLDivElement | null;
        jumpToContinuous.disabled = !continuous || continuous.style.display === 'none';
    }
}

function updateFocusPositionEditUi() {
    const editButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    if (editButton) {
        editButton.setAttribute('aria-pressed', focusPositionEditMode ? 'true' : 'false');
        editButton.style.color = focusPositionEditMode ? 'var(--vscode-focusBorder)' : '';
        editButton.style.background = focusPositionEditMode ? 'rgba(32, 124, 229, 0.14)' : '';
        editButton.style.borderRadius = focusPositionEditMode ? '3px' : '';
    }

    currentRenderedFocusElementsList.forEach(element => {
        const editable = element.dataset.focusEditable === 'true';
        const isPendingParent = hasPendingFocusLink() && element.dataset.focusId === pendingFocusLinkParentId;
        const isSelected = isFocusSelected(element.dataset.focusId);
        element.style.cursor = focusPositionEditMode && editable ? 'grab' : 'pointer';
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

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    const continuousEditable = isContinuousFocusEditable(currentRenderedFocusTree);
    if (continuousFocusElement) {
        continuousFocusElement.style.cursor = focusPositionEditMode && continuousEditable ? 'grab' : 'default';
        continuousFocusElement.style.boxShadow = focusPositionEditMode && continuousEditable
            ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset'
            : '';
    }
    updateFocusRelationVisualizationUi();
    updateFocusMinimapUi();
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
        vscode.postMessage({
            command: 'deleteFocus',
            focusId,
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
    if (focusElement.dataset.focusId) {
        setLastNavigatedFocusId(focusElement.dataset.focusId);
    }
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
            const linkType = pendingFocusLinkType;
            const childFocusId = focusElement.dataset.focusId;
            clearPendingFocusLink();
            if (!parentFocusId || !childFocusId || !linkType || parentFocusId === childFocusId) {
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

            const isExistingLink = childFocus.prerequisite.some(group => group.includes(parentFocusId))
                || childFocus.relativePositionId === parentFocusId;
            const linkedChildFocus: Focus = {
                ...childFocus,
                relativePositionId: isExistingLink ? undefined : parentFocusId,
                prerequisite: childFocus.prerequisite,
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
                parentFocusId,
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
        updateFocusRelationVisualizationUi();
        updateFocusMinimapUi();
    }, true);

    window.addEventListener('resize', () => {
        updateFocusRelationVisualizationUi();
        updateFocusMinimapUi();
    });
}

function setupFocusSelectionMarqueeHandler() {
    document.addEventListener('mousedown', event => {
        if (!focusPositionEditMode || event.button !== 0 || !event.shiftKey || hasPendingFocusLink()) {
            return;
        }

        if (!getBlankCanvasPanTarget(event)) {
            return;
        }

        clearPendingFocusNavigate();
        hideFocusContextMenu();
        event.preventDefault();
        event.stopPropagation();
        activeFocusSelectionMarquee = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            dragGestureStarted: false,
        };
        hideFocusSelectionOverlay();
    }, true);

    document.addEventListener('mousemove', event => {
        if (!activeFocusSelectionMarquee) {
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

    document.addEventListener('mouseup', () => {
        if (!activeFocusSelectionMarquee) {
            return;
        }

        const dragGestureStarted = activeFocusSelectionMarquee.dragGestureStarted;
        clearActiveFocusSelectionMarquee();
        if (dragGestureStarted) {
            persistCurrentSelectedFocusIds();
            suppressEditableFocusClickUntil = Date.now() + 250;
        }
    }, true);

    document.addEventListener('mouseleave', () => {
        if (!activeFocusSelectionMarquee) {
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
    pendingFocusLinkParentId = parentFocusId;
    pendingFocusLinkType = type;
    const parentElement = getFocusElementById(parentFocusId);
    const parentCenter = parentElement ? getElementViewportCenter(parentElement) : undefined;
    refreshPendingFocusLinkOverlay(clientX ?? parentCenter?.x, clientY ?? parentCenter?.y);
    updateFocusPositionEditUi();
}

function updatePendingFocusLinkTarget(clientX: number, clientY: number) {
    refreshPendingFocusLinkOverlay(clientX, clientY);
}

function clearPendingFocusLink() {
    pendingFocusLinkParentId = undefined;
    pendingFocusLinkType = undefined;
    const overlay = document.getElementById('focus-link-overlay') as SVGSVGElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }

    updateFocusPositionEditUi();
}

function navigatePreviewFromMinimapClientPoint(clientX: number, clientY: number) {
    const { canvas } = getFocusMinimapElements();
    if (!canvas) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const transform = createFocusMinimapTransform(currentCanvasWidth, currentCanvasHeight, rect.width, rect.height, 8);
    const canvasPoint = projectMinimapPointToCanvas({
        x: clientX - rect.left,
        y: clientY - rect.top,
    }, transform);
    scrollCanvasPointIntoView(canvasPoint);
}

function setupFocusMinimapHandlers() {
    const { minimap, canvas, jumpToSelected, jumpToContinuous } = getFocusMinimapElements();
    if (!minimap || !canvas) {
        return;
    }

    minimap.addEventListener('mousedown', event => {
        event.stopPropagation();
    }, true);
    minimap.addEventListener('click', event => {
        event.stopPropagation();
    }, true);
    minimap.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
    }, true);
    minimap.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
    }, true);

    const toggleButton = document.getElementById('toggle-focus-minimap') as HTMLButtonElement | null;
    toggleButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        focusMinimapCollapsed = !focusMinimapCollapsed;
        setState({ focusMinimapCollapsed });
        updateFocusMinimapUi();
    });

    jumpToSelected?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const focusId = Array.from(currentSelectedFocusIds)[0];
        if (focusId) {
            navigatePreviewToFocusId(focusId);
        }
    });

    jumpToContinuous?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        navigatePreviewToContinuousFocus();
    });

    canvas.addEventListener('mousedown', event => {
        if (focusMinimapCollapsed || event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        activeFocusMinimapDrag = true;
        navigatePreviewFromMinimapClientPoint(event.clientX, event.clientY);
    });

    canvas.addEventListener('mousemove', event => {
        const { tooltip } = getFocusMinimapElements();
        if (!tooltip) {
            return;
        }

        updateFocusMinimapTooltip(canvas, tooltip, event.clientX, event.clientY);
        if (activeFocusMinimapDrag) {
            event.preventDefault();
            event.stopPropagation();
            navigatePreviewFromMinimapClientPoint(event.clientX, event.clientY);
        }
    });

    canvas.addEventListener('mouseleave', () => {
        const { tooltip } = getFocusMinimapElements();
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    });

    document.addEventListener('mouseup', () => {
        activeFocusMinimapDrag = false;
    }, true);
}

function isBlankCreateTarget(event: MouseEvent): boolean {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element) {
        return false;
    }

    if (element.closest('[data-focus-id], #inlaywindowplaceholder, #continuousFocuses, #focus-minimap, .toolbar-outer, #warnings-container, input, select, button, textarea, option')) {
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

    if (element.closest('[data-focus-id], .navigator, #continuousFocuses, #focus-minimap, .toolbar-outer, #warnings-container, input, select, button, textarea, option, ul.select-dropdown, li')) {
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
    document.addEventListener('dblclick', event => {
        if (!focusPositionEditMode || !currentRenderedFocusTree) {
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
        binding.element.removeEventListener('mousedown', binding.handler, true);
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
        focusPositionDragBindings.push({ element: focusElement, handler });
    });

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    const focusTree = currentRenderedFocusTree;
    if (!continuousFocusElement || !isContinuousFocusEditable(focusTree)) {
        return;
    }

    const handler = (event: MouseEvent) => {
        if (!focusPositionEditMode || event.button !== 0 || hasPendingFocusLink() || !currentRenderedFocusTree) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const startingLeft = parseFloat(continuousFocusElement.style.left || '0');
        const startingTop = parseFloat(continuousFocusElement.style.top || '0');
        let nextLeft = startingLeft;
        let nextTop = startingTop;
        let dragGestureStarted = false;

        continuousFocusElement.style.cursor = 'grabbing';
        continuousFocusElement.style.zIndex = '20';
        continuousFocusElement.style.willChange = 'left, top';

        const mouseMoveHandler = (moveEvent: MouseEvent) => {
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

        const mouseUpHandler = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
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

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    continuousFocusElement.addEventListener('mousedown', handler, true);
    focusPositionDragBindings.push({ element: continuousFocusElement, handler });
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

    const recalculatedPositions: Record<string, NumberPosition> = {};
    Object.values(currentRenderedFocusTree.focuses).forEach(currentFocus => {
        getFocusPosition(currentFocus, recalculatedPositions, currentRenderedFocusTree!, currentRenderedExprs);
    });
    setCurrentFocusPositions(recalculatedPositions);
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

function updateFocusLinkAfterApply(parentFocusId: string, childFocusId: string, targetLocalX?: number, targetLocalY?: number) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const childFocus = currentRenderedFocusTree.focuses[childFocusId];
    if (!childFocus) {
        return;
    }

    const existingGroupIndex = childFocus.prerequisite.findIndex(group => group.includes(parentFocusId));
    const hasExistingLink = existingGroupIndex !== -1 || childFocus.relativePositionId === parentFocusId;
    if (hasExistingLink) {
        if (existingGroupIndex !== -1) {
            const updatedGroup = childFocus.prerequisite[existingGroupIndex].filter(focusId => focusId !== parentFocusId);
            if (updatedGroup.length === 0) {
                childFocus.prerequisite.splice(existingGroupIndex, 1);
            } else {
                childFocus.prerequisite[existingGroupIndex] = updatedGroup;
            }
        }
        if (childFocus.relativePositionId === parentFocusId) {
            childFocus.relativePositionId = undefined;
        }
    } else {
        childFocus.prerequisite.push([parentFocusId]);
        childFocus.relativePositionId = parentFocusId;
    }
    if (targetLocalX !== undefined && targetLocalY !== undefined) {
        childFocus.x = targetLocalX;
        childFocus.y = targetLocalY;
    }

    const recalculatedPositions: Record<string, NumberPosition> = {};
    Object.values(currentRenderedFocusTree.focuses).forEach(currentFocus => {
        getFocusPosition(currentFocus, recalculatedPositions, currentRenderedFocusTree!, currentRenderedExprs);
    });
    setCurrentFocusPositions(recalculatedPositions);
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
}

async function buildContent() {
    const checkedFocusesExprs = getCheckedFocusConditionExprs();
    clearCheckedFocuses();

    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
    const focustreeplaceholder = document.getElementById('focustreeplaceholder') as HTMLDivElement;
    const styleTable = new StyleTable();
    const renderedFocus: Record<string, string> = (window as any).renderedFocus;
    const focusTree = focusTrees[selectedFocusTreeIndex];
    const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs];
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
    const renderExprs = exprs;
    const focusGridBoxItems = focuses.map(focus => focusToGridItem(focus, focusTree, allowBranchOptionsValue, focusPosition, renderExprs)).filter((v): v is GridBoxItem => !!v);
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

    const minX = minBy(Object.values(focusPosition), 'x')?.x ?? 0;
    const minY = minBy(Object.values(focusPosition), 'y')?.y ?? 0;
    const maxX = Math.max(...Object.values(focusPosition).map(position => position.x), 0);
    const maxY = Math.max(...Object.values(focusPosition).map(position => position.y), 0);
    const leftPadding = (gridbox.position.x._value ?? 0)
        + (focusCreateSidePaddingColumns * xGridSize)
        - Math.min(minX * xGridSize, 0);
    currentGridLeftPadding = leftPadding;
    currentGridTopPadding = (gridbox.position.y._value ?? 0)
        + (focusCreateTopPaddingRows * yGridSize)
        - Math.min(minY * yGridSize, 0);

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
        onRenderItem: item => Promise.resolve(
            renderedFocus[item.id]
                .replace('{{position}}', item.gridX + ', ' + item.gridY)
                .replace('{{iconClass}}', getFocusIcon(focusTree.focuses[item.id], renderExprs, styleTable))
                .replace('{{lintBadges}}', renderFocusLintBadges(focusTree.focuses[item.id]))
                .replace('{{statusBadges}}', renderFocusStatusBadges(focusTree.focuses[item.id], renderExprs))
                .replace('{{statusSummary}}', renderFocusStatusSummary(focusTree.focuses[item.id], renderExprs))
            ),
        cornerPosition: 0.5,
    });

    focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement((window as any).styleNonce);
    const emptyStateElement = document.getElementById('focus-empty-state') as HTMLDivElement | null;
    if (emptyStateElement) {
        emptyStateElement.style.display = focusGridBoxItems.length === 0 && focuses.length > 0 ? 'block' : 'none';
    }
    const minimumCanvasWidth = currentGridLeftPadding + Math.max(maxX + 1 + focusCreateRightPaddingColumns, focusCreateMinimumColumns) * xGridSize;
    const minimumCanvasHeight = currentGridTopPadding + Math.max(maxY + 1 + focusCreateBottomPaddingRows, focusCreateMinimumRows) * yGridSize;
    currentCanvasWidth = minimumCanvasWidth;
    currentCanvasHeight = minimumCanvasHeight;
    focustreeplaceholder.style.minWidth = `${minimumCanvasWidth}px`;
    contentElement.style.minWidth = `${minimumCanvasWidth}px`;
    focustreeplaceholder.style.minHeight = `${minimumCanvasHeight}px`;
    contentElement.style.minHeight = `${minimumCanvasHeight}px`;
    rebuildRenderedFocusElementCache();
    rebuildRenderedRelationElementCache();
    const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement;
    inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, renderExprs);

    bindFocusPositionDragHandlers();
    subscribeNavigators();
    setupCheckedFocuses(focuses, focusTree);
    updateFocusPositionEditUi();
    updateFocusMinimapUi();
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
    const focusTree = focusTrees[selectedFocusTreeIndex];
    applyContinuousFocusElementPosition(focusTree);

    if (useConditionInFocus) {
        const conditionExprs = getTreeConditionExprKeys(focusTree).map(exprKeyToConditionItem);

        const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'flex' : 'none';
        }

        if (conditions) {
            conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs.map(option => `<div class="option" value='${conditionItemToExprKey(option)}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`).join('')}`;
        }

        restoreSelectedExprsForFocusTree(focusTree, clearCondition);
        updateConditionPresetUi(focusTree);

    } else {
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

function renderFocusLintBadge(kind: 'warning' | 'info', label: string, title: string): string {
    return `<span class="focus-lint-badge focus-lint-badge-${kind}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderFocusLintBadges(focus: Focus): string {
    const badges: string[] = [];
    if (focus.lintWarningCount > 0) {
        badges.push(renderFocusLintBadge(
            'warning',
            `!${focus.lintWarningCount}`,
            feLocalize('TODO', 'Structural warnings: {0}', focus.lintWarningCount),
        ));
    }
    if (focus.lintInfoCount > 0) {
        badges.push(renderFocusLintBadge(
            'info',
            `i${focus.lintInfoCount}`,
            feLocalize('TODO', 'Structural info findings: {0}', focus.lintInfoCount),
        ));
    }

    return badges.length > 0
        ? `<div class="focus-lint-badges" aria-hidden="true">${badges.join('')}</div>`
        : '';
}

function getFocusLintSummaryLine(focus: Focus): string | undefined {
    if (!focus.lintMessages || focus.lintMessages.length === 0) {
        return undefined;
    }

    const summary = focus.lintMessages.slice(0, 2).join('; ');
    const suffix = focus.lintMessages.length > 2
        ? feLocalize('TODO', ' (+{0} more)', focus.lintMessages.length - 2)
        : '';
    return feLocalize('TODO', 'Lint: {0}{1}', summary, suffix);
}

function renderFocusStatusBadge(kind: string, label: string, title: string): string {
    return `<span class="focus-status-badge focus-status-badge-${kind}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderFocusStatusBadges(focus: Focus, exprs: ConditionItem[]): string {
    const status = evaluateFocusBadgeState(focus, exprs, { enableAvailability: useConditionInFocus });
    const badges: string[] = [];

    if (status.showAvailability) {
        badges.push(status.isAvailable
            ? renderFocusStatusBadge('available', 'OK', feLocalize('TODO', 'Available under current conditions'))
            : renderFocusStatusBadge('blocked', 'Blocked', feLocalize('TODO', 'Blocked by current conditions')));
    }
    if (status.hasAllowBranch) {
        badges.push(renderFocusStatusBadge('branch', 'Branch', feLocalize('TODO', 'Branch-gated focus')));
    }
    if (status.availableIfCapitulated) {
        badges.push(renderFocusStatusBadge('capitulated', 'Cap', feLocalize('TODO', 'Available when capitulated')));
    }
    if (status.prerequisiteFocusCount > 0) {
        badges.push(renderFocusStatusBadge(
            'prerequisite',
            `P${status.prerequisiteFocusCount}`,
            feLocalize('TODO', 'Prerequisites: {0} focus(es) in {1} group(s)', status.prerequisiteFocusCount, status.prerequisiteGroupCount),
        ));
    }
    if (status.exclusiveCount > 0) {
        badges.push(renderFocusStatusBadge(
            'exclusive',
            `X${status.exclusiveCount}`,
            feLocalize('TODO', 'Mutually exclusive with {0} focus(es)', status.exclusiveCount),
        ));
    }

    if (badges.length === 0) {
        return '';
    }

    return `<div class="focus-status-badges" aria-hidden="true">${badges.join('')}</div>`;
}

function renderFocusStatusSummary(focus: Focus, exprs: ConditionItem[]): string {
    const status = evaluateFocusBadgeState(focus, exprs, { enableAvailability: useConditionInFocus });
    const lines: string[] = [];

    if (status.showAvailability) {
        lines.push(status.isAvailable
            ? feLocalize('TODO', 'Available: yes')
            : feLocalize('TODO', 'Available: no'));
    }
    if (status.hasAllowBranch) {
        lines.push(feLocalize('TODO', 'Branch gated: yes'));
    }
    if (status.availableIfCapitulated) {
        lines.push(feLocalize('TODO', 'Available if capitulated: yes'));
    }
    if (status.prerequisiteFocusCount > 0) {
        lines.push(feLocalize('TODO', 'Prerequisites: {0} focus(es) across {1} group(s)', status.prerequisiteFocusCount, status.prerequisiteGroupCount));
    }
    if (status.exclusiveCount > 0) {
        lines.push(feLocalize('TODO', 'Mutually exclusive: {0} focus(es)', status.exclusiveCount));
    }
    if (status.hasAiWillDo) {
        lines.push(feLocalize('TODO', 'AI weight block: yes'));
    }
    if (status.hasCompletionReward) {
        lines.push(feLocalize('TODO', 'Completion reward: yes'));
    }
    const lintLine = getFocusLintSummaryLine(focus);
    if (lintLine) {
        lines.push(lintLine);
    }

    if (lines.length === 0) {
        return '';
    }

    return `<div class="focus-status-summary" aria-hidden="true">${escapeHtml(lines.join('\n'))}</div>`;
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

    for (const [groupIndex, prerequisites] of focus.prerequisite.entries()) {
        const groupedPrerequisite = prerequisites.length > 1;
        const style = groupedPrerequisite ? "1px dashed rgba(136, 170, 255, 0.5)" : "1px solid rgba(136, 170, 255, 0.5)";

        prerequisites.forEach(p => {
            const fp = focusTree.focuses[p];
            const classNames2 = fp?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
            connections.push({
                target: p,
                targetType: 'parent',
                style: style,
                classNames: classNames + ' ' + classNames2,
                relationKind: 'prerequisite',
                sourceFocusId: focus.id,
                targetFocusId: p,
                prerequisiteGroupIndex: groupIndex,
                isGroupedPrerequisite: groupedPrerequisite,
            });
        });
    }

    focus.exclusive.forEach(e => {
        const fe = focusTree.focuses[e];
        const classNames2 = fe?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid rgba(255, 96, 96, 0.48)",
            classNames: classNames + ' ' + classNames2,
            relationKind: 'exclusive',
            sourceFocusId: focus.id,
            targetFocusId: e,
        });
    });

    const position = getFocusPosition(focus, positionByFocusId, focusTree, exprs);

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
    if (!focusesElement) {
        selectedFocusTreeIndex = Math.min(focusTrees.length - 1, Math.max(0, selectedFocusTreeIndex));
        return;
    }

    focusesElement.innerHTML = focusTrees.map((focus, i) => `<option value="${i}">${focus.id}</option>`).join('');
    selectedFocusTreeIndex = Math.min(focusTrees.length - 1, Math.max(0, selectedFocusTreeIndex));
    focusesElement.value = selectedFocusTreeIndex.toString();
}

function applyFocusTreeContentUpdate(message: {
    focusTrees?: FocusTree[];
    renderedFocus?: Record<string, string>;
    renderedInlayWindows?: Record<string, string>;
    gridBox?: any;
    dynamicStyleCss?: string;
    xGridSize?: number;
    yGridSize?: number;
    documentVersion?: number;
}) {
    if (message.documentVersion !== undefined && message.documentVersion < focusPositionDocumentVersion) {
        return false;
    }

    if (message.focusTrees) {
        focusTrees = message.focusTrees;
        (window as any).focusTrees = message.focusTrees;
        refreshFocusTreeSelectorOptions();
    }
    if (message.renderedFocus) {
        (window as any).renderedFocus = message.renderedFocus;
    }
    if (message.renderedInlayWindows) {
        (window as any).renderedInlayWindows = message.renderedInlayWindows;
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
            if (!applyFocusTreeContentUpdate(message)) {
                return;
            }
            updateSelectedFocusTree(false);
            void buildContent().then(() => {
                retriggerSearch();
            });
            return;
        }

        if (message.command === 'focusConditionPresetNameResolved') {
            if (!pendingConditionPresetSaveRequest) {
                return;
            }

            pendingConditionPresetSaveRequest = false;
            if (message.name) {
                saveCurrentConditionPreset(message.name);
            }
            return;
        }

        if (message.command === 'focusConditionPresetTest') {
            void handleConditionPresetTestMessage(message as FocusConditionPresetTestMessage);
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
            );
        }
        if (message.command === 'focusExclusiveLinkEditApplied'
            && message.sourceFocusId !== undefined
            && message.targetFocusId !== undefined) {
            updateFocusExclusiveLinkAfterApply(message.sourceFocusId, message.targetFocusId);
        }

        void buildContent().then(() => {
            retriggerSearch();
        });
    });

    setupFocusPositionDragHandlers();
    setupFocusSelectionMarqueeHandler();
    setupFocusTemplateCreateHandler();
    setupBlankCanvasPanFallback();
    setupFocusMinimapHandlers();

    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    if (focusesElement) {
        focusesElement.value = selectedFocusTreeIndex.toString();
        focusesElement.addEventListener('change', async () => {
            selectedFocusTreeIndex = parseInt(focusesElement.value);
            setState({ selectedFocusTreeIndex });
            updateSelectedFocusTree(false);
            await buildContent();
            retriggerSearch();
        });
    }

    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLDivElement | null;
    if (inlayWindowsElement) {
        inlayWindows = new DivDropdown(inlayWindowsElement);
        let previousSelection = inlayWindows.selectedValues$.value[0];
        inlayWindows.selectedValues$.subscribe(async selection => {
            const focusTree = focusTrees[selectedFocusTreeIndex];
            const nextSelection = selection[0];
            if (previousSelection === nextSelection) {
                return;
            }

            previousSelection = nextSelection;
            setSelectedInlayWindowId(focusTree, nextSelection);
            await buildContent();
            retriggerSearch();
        });
    }

    if (useConditionInFocus) {
        const conditionPresetsElement = document.getElementById('condition-presets') as HTMLDivElement | null;
        if (conditionPresetsElement) {
            conditionPresets = new DivDropdown(conditionPresetsElement);
            conditionPresets.selectedValues$.subscribe(async selection => {
                if (suppressConditionPresetSelectionChange) {
                    return;
                }

                const focusTree = getCurrentFocusTree();
                const selectedPresetId = selection[0];
                if (!focusTree || !selectedPresetId || selectedPresetId === customConditionPresetId) {
                    updateConditionPresetUi(focusTree ?? focusTrees[selectedFocusTreeIndex]);
                    return;
                }

                try {
                    await applyConditionPresetById(focusTree, selectedPresetId);
                } catch {
                    return;
                }
                retriggerSearch();
            });
        }

        const saveConditionPresetButton = document.getElementById('save-condition-preset') as HTMLButtonElement | null;
        saveConditionPresetButton?.addEventListener('click', () => {
            requestSaveCurrentConditionPreset();
        });

        const deleteConditionPresetButton = document.getElementById('delete-condition-preset') as HTMLButtonElement | null;
        deleteConditionPresetButton?.addEventListener('click', async () => {
            deleteCurrentConditionPreset();
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
                setLastNavigatedFocusId(visibleSearchedFocus[currentNavigatedIndex].dataset.focusId ?? visibleSearchedFocus[currentNavigatedIndex].id.replace(/^focus_/, ''));
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
            conditions.selectedValues$.subscribe(async (selection) => {
                if (suppressConditionSelectionChange) {
                    return;
                }

                const focusTree = getCurrentFocusTree();
                if (!focusTree) {
                    return;
                }

                setSelectedExprsForFocusTree(focusTree, selection, {
                    persistSelection: true,
                    syncPreset: true,
                    updateDropdown: false,
                });

                await buildContent();
                retriggerSearch();
            });
        }

    }

    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
    enableZoom(contentElement, 0, focusToolbarHeight);
    setPreviewPanDisabled(focusPositionEditMode);

    const focusPositionEditButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    focusPositionEditButton?.addEventListener('click', async () => {
        setFocusPositionEditMode(!focusPositionEditMode);
        await buildContent();
        retriggerSearch();
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
    await buildContent();
    updateFocusMinimapUi();
    scrollToState();
    updateFocusMinimapUi();
    vscode.postMessage({ command: 'focusTreeWebviewReady' });
}));
