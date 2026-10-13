import type { GridBoxType } from '../../src/hoiformat/gui';
import { invalidateCachedFocusTreeLayoutPlan } from '../../src/previewdef/focustree/layoutplan';
import {
    applyFocusTreeViewDelta,
    focusTreeProtocolVersion,
    FocusTreeView,
    FocusTreeViewPatch,
} from '../../src/previewdef/focustree/viewmodel';
import { FocusTreeStyleReceiver } from '../../src/previewdef/focustree/stylesync';
import type { FocusTreeAssetRequestMessage } from '../../src/previewdef/focustree/webviewupdate';
import {
    FocusTreeContentUpdateMessage,
    FocusTreeSceneAssetsMessage,
    getFocusTreeContentUpdateDecision,
} from '../../src/previewdef/focustree/webviewupdate';
import { feLocalize } from '../util/i18n';
import { vscode } from '../util/vscode';
import { applyFocusTreeSceneAssets } from './assetdemand';
import {
    claimVisibleAssetsApplied,
    onFocusAssetsMaterialized,
    onFocusTreeContentApplied,
    recordFocusAssetResponse,
    replaceFocusAssetMaterialization,
    scheduleFocusAssetDemandCheck,
} from './assetloading';
import { rebuildContentSafely } from './content';
import { FocusEditResultMessage, handleFocusEditResult } from './editing';
import { applyFocusTreeContentUpdate as applyFocusTreeContentUpdateMessage } from './messageapply';
import {
    clearMissingPendingPlaceholderFocusIds,
    clearPendingPlaceholderFocusIdsForTemplateKeys,
    runtime,
} from './runtime';
import { getCurrentFocusTree, getCurrentSelectionTreeId, setSelectedFocusTreeById } from './selection';
import { applyStringMapPatchInPlace } from './stringmappatch';
import { createFocusTreeStyleSheetTarget } from './stylesheet';
import { createFocusTreeContentTiming, postFocusTreeContentApplied, postFocusTreeWebviewTiming } from './telemetry';
import {
    handleConditionPresetNameResolved,
    refreshFocusTreeSelectorOptions,
    refreshWarningsButtonVisibility,
    requestCurrentFocusTreeScene,
    requestSelectedFocusTreeSceneIfMissing,
    updateSelectedFocusTree,
} from './toolbar';

type HostMessage = FocusTreeContentUpdateMessage & FocusEditResultMessage & {
    command?: string;
    name?: string;
    batchKind?: 'style' | 'content';
};

/**
 * Dynamic styles follow the host's ledger: every sync is applied in arrival order, even when the
 * content beside it is stale, so the stylesheet always matches what the host recorded. A delta
 * that does not fit asks the host for a whole stylesheet.
 */
const styleReceiver = new FocusTreeStyleReceiver(createFocusTreeStyleSheetTarget(), requestFocusTreeStyleResync);

/** The webview reports a stylesheet that missed a delta through its asset request channel. */
function requestFocusTreeStyleResync(): void {
    const message: FocusTreeAssetRequestMessage = {
        command: 'focusTreeAssetRequest',
        protocolVersion: focusTreeProtocolVersion,
        assetRequestId: 0,
        treeId: runtime.renderedFocusTree?.id ?? runtime.selectedFocusTreeId ?? '',
        snapshotVersion: runtime.snapshotVersion,
        documentVersion: runtime.focusPositionDocumentVersion,
        visibleFocusIds: [],
        nearbyFocusIds: [],
        styleResync: true,
    };
    vscode.postMessage(message);
}

function applyFocusTreeAssetStyleBatch(message: HostMessage): void {
    if (message.protocolVersion !== focusTreeProtocolVersion) {
        return;
    }
    if (typeof message.requestId === 'number') {
        runtime.latestRequestId = Math.max(runtime.latestRequestId, message.requestId);
    }
    styleReceiver.apply(message.style);
}

function setFocusTrees(nextFocusTrees: FocusTreeView[], sceneMode: FocusTreeContentUpdateMessage['sceneMode']): void {
    runtime.focusTrees.forEach(invalidateCachedFocusTreeLayoutPlan);
    if (sceneMode === 'merge') {
        const nextById = new Map(runtime.focusTrees.map(tree => [tree.id, tree]));
        nextFocusTrees.forEach(tree => nextById.set(tree.id, tree));
        runtime.focusTrees = Array.from(nextById.values());
    } else {
        runtime.focusTrees = nextFocusTrees;
    }
    window.focusTrees = runtime.focusTrees;
    clearMissingPendingPlaceholderFocusIds();
}

/**
 * Applies tree replacements and deltas. Deltas require the snapshot they were computed from;
 * otherwise the current tree is re-requested instead of patching a diverged view.
 */
function applyFocusTreePatches(patches: FocusTreeViewPatch[] | undefined, baseSnapshotVersion: number | undefined): void {
    if (!patches || patches.length === 0) {
        return;
    }

    const patchByTreeId = new Map(patches.map(patch => [patch.treeId, patch]));
    const canApplyDeltas = baseSnapshotVersion === undefined || baseSnapshotVersion === runtime.snapshotVersion;
    let divergedTreeIds = false;
    runtime.focusTrees = runtime.focusTrees.map(focusTree => {
        const patch = patchByTreeId.get(focusTree.id);
        if (!patch) {
            return focusTree;
        }
        if (patch.tree) {
            invalidateCachedFocusTreeLayoutPlan(focusTree);
            return patch.tree;
        }
        if (patch.delta) {
            if (!canApplyDeltas) {
                divergedTreeIds = true;
                return focusTree;
            }
            invalidateCachedFocusTreeLayoutPlan(focusTree);
            return applyFocusTreeViewDelta(focusTree, patch.delta);
        }
        return focusTree;
    });
    window.focusTrees = runtime.focusTrees;
    clearMissingPendingPlaceholderFocusIds();
    if (divergedTreeIds) {
        requestCurrentFocusTreeScene();
    }
}

function applyStringMapPatch(
    targetWindowKey: 'renderedInlayWindows',
    changedEntries: Record<string, string> | undefined,
    removedKeys: string[] | undefined,
): void {
    if ((!changedEntries || Object.keys(changedEntries).length === 0) && (!removedKeys || removedKeys.length === 0)) {
        return;
    }
    window[targetWindowKey] = applyStringMapPatchInPlace(window[targetWindowKey] ?? {}, changedEntries, removedKeys);
}

function applyFocusTreeContentUpdate(message: FocusTreeContentUpdateMessage): boolean {
    runtime.cancelActiveFocusPositionDrag?.();
    return applyFocusTreeContentUpdateMessage(message, {
        getSnapshotVersion: () => runtime.snapshotVersion,
        setSnapshotVersion: snapshotVersion => {
            runtime.snapshotVersion = snapshotVersion;
        },
        getDocumentVersion: () => runtime.focusPositionDocumentVersion,
        setDocumentVersion: documentVersion => {
            runtime.focusPositionDocumentVersion = documentVersion;
            window.focusPositionDocumentVersion = documentVersion;
        },
        setFocusPositionActiveFile: activeFile => {
            runtime.focusPositionActiveFile = activeFile;
            window.focusPositionActiveFile = activeFile;
        },
        getCurrentSelectionTreeId,
        getRequestedSelectionTreeId: () => runtime.selectedFocusTreeId,
        setSelectedFocusTreeById,
        setFocusTrees: nextFocusTrees => setFocusTrees(nextFocusTrees, message.sceneMode),
        applyFocusTreePatches,
        setContinuousFocusHtml: html => {
            const element = document.getElementById('continuousFocuses');
            if (element) {
                element.innerHTML = html || feLocalize('focustree.continuousFocuses', 'Continuous focuses');
            }
        },
        setFocusTemplates: (templates, keyById) => {
            if (message.sceneMode === 'merge') {
                runtime.focusTemplates = { ...runtime.focusTemplates, ...templates };
                runtime.focusTemplateKeyById = { ...runtime.focusTemplateKeyById, ...keyById };
            } else {
                runtime.focusTemplates = templates;
                runtime.focusTemplateKeyById = keyById;
            }
            clearPendingPlaceholderFocusIdsForTemplateKeys(keyById);
        },
        patchFocusTemplates: (templates, keyById, removedFocusIds) => {
            if (templates) {
                runtime.focusTemplates = { ...runtime.focusTemplates, ...templates };
            }
            if (keyById || removedFocusIds) {
                runtime.focusTemplateKeyById = applyStringMapPatchInPlace({ ...runtime.focusTemplateKeyById }, keyById, removedFocusIds);
            }
            clearPendingPlaceholderFocusIdsForTemplateKeys(keyById);
        },
        setRenderedInlayWindows: renderedInlayWindows => {
            window.renderedInlayWindows = message.sceneMode === 'merge'
                ? { ...(window.renderedInlayWindows ?? {}), ...renderedInlayWindows }
                : renderedInlayWindows;
        },
        patchRenderedInlayWindows: (changedEntries, removedKeys) => {
            applyStringMapPatch('renderedInlayWindows', changedEntries, removedKeys);
        },
        refreshFocusTreeSelectorOptions,
        refreshWarningsButtonVisibility,
        setGridBox: gridBox => {
            window.gridBox = gridBox as GridBoxType;
        },
        setGridSizeX: xGridSize => {
            runtime.xGridSize = xGridSize;
            window.xGridSize = xGridSize;
        },
        setGridSizeY: yGridSize => {
            runtime.yGridSize = yGridSize;
            window.yGridSize = yGridSize;
        },
        setAssetMaterialization: replaceFocusAssetMaterialization,
    });
}

/** Adds icon rules of focuses the webview asked for, then looks for further demand. */
function handleSceneAssets(message: FocusTreeSceneAssetsMessage): void {
    if (message.protocolVersion !== focusTreeProtocolVersion) {
        return;
    }
    styleReceiver.apply(message.style);
    recordFocusAssetResponse(message);
    const appliedAt = performance.now();
    const applied = applyFocusTreeSceneAssets(message, {
        getDocumentVersion: () => runtime.focusPositionDocumentVersion,
        getSnapshotVersion: () => runtime.snapshotVersion,
        setSnapshotVersion: snapshotVersion => {
            runtime.snapshotVersion = snapshotVersion;
        },
        getLatestRequestId: () => runtime.latestRequestId,
        addMaterializedFocusIds: focusIds => runtime.assetMaterialization.add(focusIds),
    });
    if (applied) {
        onFocusAssetsMaterialized(message, performance.now() - appliedAt);
    }
    scheduleFocusAssetDemandCheck(true);
}

function handleContentUpdate(message: FocusTreeContentUpdateMessage): void {
    if (message.protocolVersion !== focusTreeProtocolVersion) {
        return;
    }
    styleReceiver.apply(message.style);
    if ((message.requestId ?? 0) < runtime.latestRequestId
        || (message.sceneRevision ?? 0) < runtime.sceneRevision) {
        return;
    }
    if (message.catalog) {
        runtime.focusTreeCatalog = message.catalog;
    }
    postFocusTreeWebviewTiming(createFocusTreeContentTiming('contentUpdateReceived', message, {
        applyMs: 0,
        rebuildMs: 0,
        rebindMs: 0,
    }));

    const updateStartedAt = performance.now();
    const previousCurrentTree = getCurrentFocusTree();
    const previousDocumentVersion = runtime.focusPositionDocumentVersion;
    if (!applyFocusTreeContentUpdate(message)) {
        return;
    }
    runtime.latestRequestId = Math.max(runtime.latestRequestId, message.requestId ?? 0);
    runtime.sceneRevision = Math.max(runtime.sceneRevision, message.sceneRevision ?? 0);
    onFocusTreeContentApplied(previousDocumentVersion !== runtime.focusPositionDocumentVersion);
    requestSelectedFocusTreeSceneIfMissing();
    const applyMs = performance.now() - updateStartedAt;
    // Only updates that carry real assets may complete the visible asset set.
    const appliedOptions = message.assetMaterialization && !message.assetMaterialization.deferred
        ? { claimVisibleAssetsApplied }
        : {};

    const nextCurrentTree = getCurrentFocusTree();
    const decision = getFocusTreeContentUpdateDecision(previousCurrentTree, nextCurrentTree, message);
    if (decision.shouldRefreshSelectedTreeUi && !hasSameToolbarData(previousCurrentTree, nextCurrentTree)) {
        updateSelectedFocusTree(false);
    }
    if (!decision.shouldRebuildContent && !decision.shouldApplyIncrementalUpdate) {
        postFocusTreeContentApplied(message, { applyMs, rebuildMs: 0, rebindMs: 0 }, appliedOptions);
        return;
    }

    // The scene reconciles by focus id, so structural and incremental updates share one path.
    const rebuildStartedAt = performance.now();
    void Promise.resolve(rebuildContentSafely()).finally(() => {
        postFocusTreeContentApplied(message, {
            applyMs,
            rebuildMs: performance.now() - rebuildStartedAt,
            rebindMs: 0,
        }, appliedOptions);
    });
}

/** Deltas keep unchanged tree fields by reference, so toolbar controls can skip rebuilding. */
function hasSameToolbarData(previous: FocusTreeView | undefined, next: FocusTreeView | undefined): boolean {
    return !!previous && !!next
        && previous.id === next.id
        && previous.warnings === next.warnings
        && previous.conditionExprs === next.conditionExprs
        && previous.allowBranchOptions === next.allowBranchOptions
        && previous.searchFilters === next.searchFilters
        && previous.searchFilterLabels === next.searchFilterLabels
        && previous.inlayWindows === next.inlayWindows
        && previous.continuousFocusPositionX === next.continuousFocusPositionX
        && previous.continuousFocusPositionY === next.continuousFocusPositionY;
}

export function handleHostMessage(event: MessageEvent): void {
    const message = event.data as HostMessage;
    switch (message?.command) {
        case 'focusTreeAssetBatch':
            if (message.batchKind === 'style') {
                applyFocusTreeAssetStyleBatch(message);
                return;
            }
            handleContentUpdate(message);
            return;
        case 'focusTreeScene':
        case 'focusTreeScenePatch':
            handleContentUpdate(message);
            return;
        case 'focusTreeSceneAssets':
            handleSceneAssets(event.data as FocusTreeSceneAssetsMessage);
            return;
        case 'focusTreeStyleSync':
            if (message.protocolVersion === focusTreeProtocolVersion) {
                styleReceiver.apply(message.style);
            }
            return;
        case 'focusConditionPresetNameResolved':
            handleConditionPresetNameResolved(message.name);
            return;
        default:
            handleFocusEditResult(message);
    }
}
