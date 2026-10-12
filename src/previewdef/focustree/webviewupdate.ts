import { focusTreeProtocolVersion, FocusTreeCatalogView, FocusTreeView, FocusTreeViewPatch } from './viewmodel';

export type FocusTreeContentSlot =
    | 'treeDefinitions'
    | 'selector'
    | 'warnings'
    | 'treeBody'
    | 'inlays'
    | 'layout'
    | 'styleDeps';

export interface FocusTreeContentUpdateMessage {
    protocolVersion?: typeof focusTreeProtocolVersion;
    requestId?: number;
    sceneRevision?: number;
    treeId?: string;
    sceneMode?: 'replace' | 'merge';
    updateType?: 'structure' | 'assets' | 'patch';
    snapshotVersion: number;
    /** Snapshot that tree deltas were computed against. */
    baseSnapshotVersion?: number;
    documentVersion: number;
    focusPositionActiveFile?: string;
    selectedTreeId?: string;
    changedSlots: FocusTreeContentSlot[];
    changedTreeIds?: string[];
    structurallyChangedTreeIds?: string[];
    changedFocusIds?: string[];
    changedInlayWindowIds?: string[];
    focusTrees?: FocusTreeView[];
    catalog?: FocusTreeCatalogView[];
    focusTreePatches?: FocusTreeViewPatch[];
    continuousFocusHtml?: string;
    /** Complete GUI card templates and per-focus template keys. */
    focusTemplates?: Record<string, string>;
    focusTemplateKeyById?: Record<string, string>;
    /** Templates the webview does not have yet, and changed or removed focus template keys. */
    focusTemplatePatch?: Record<string, string>;
    focusTemplateKeyPatch?: Record<string, string>;
    removedFocusTemplateKeyIds?: string[];
    renderedInlayWindows?: Record<string, string>;
    renderedInlayWindowPatch?: Record<string, string>;
    removedRenderedInlayWindowIds?: string[];
    gridBox?: unknown;
    dynamicStyleCss?: string;
    dynamicStyleCssPatch?: string;
    xGridSize?: number;
    yGridSize?: number;
    /** Replaces the webview's materialized focus set; patches omit it and keep the current set. */
    assetMaterialization?: FocusTreeAssetMaterialization;
    perf?: FocusTreeContentUpdatePerf;
}

/**
 * Which focus icon assets a scene renders for real. Other focuses of the loaded scenes render
 * structural placeholder styles until the webview requests them.
 */
export interface FocusTreeAssetMaterialization {
    /** True while every icon is a structural placeholder (deferred first paint). */
    deferred: boolean;
    /** Materialized focus ids; omitted when every focus of the loaded scenes is materialized. */
    focusIds?: string[];
}

/**
 * Custom property every focus icon rule sets, so the webview can tell from an on-screen icon
 * element what it actually renders: a decoded image (`loaded`, including the game's default
 * unknown-focus icon for unresolved names), the grey box drawn when not even that could be
 * decoded (`unavailable`), or a structural placeholder (`placeholder`).
 */
export const focusIconStateProperty = '--focus-icon-state';
export type FocusIconRenderState = 'loaded' | 'unavailable' | 'placeholder';

/** Upper bounds of one asset request, so request and response transport stays bounded. */
export const focusTreeAssetRequestLimits = {
    visible: 256,
    nearby: 128,
    /** Focuses rendered per asset response chunk. */
    chunk: 32,
} as const;

/** Webview → host: focuses on or near the screen whose icon assets are still placeholders. */
export interface FocusTreeAssetRequestMessage {
    command: 'focusTreeAssetRequest';
    protocolVersion: typeof focusTreeProtocolVersion;
    /** Webview-local, monotonically increasing request number. */
    assetRequestId: number;
    treeId: string;
    snapshotVersion: number;
    documentVersion: number;
    /** On screen, condition-visible, and not in a hidden branch; closest to the center first. */
    visibleFocusIds: string[];
    /** Within the prefetch margin around the screen; closest first. */
    nearbyFocusIds: string[];
}

export type FocusTreeSceneAssetsStatus = 'applied' | 'empty' | 'stale' | 'failed';

/** Host → webview: additive icon asset styles for newly materialized focuses. */
export interface FocusTreeSceneAssetsMessage {
    command: 'focusTreeSceneAssets';
    protocolVersion: typeof focusTreeProtocolVersion;
    /** Host refresh generation the patch was computed in; asset work never starts a new one. */
    requestId: number;
    /** Echo of the webview request, 0 for host-initiated patches. */
    assetRequestId: number;
    treeId: string;
    documentVersion: number;
    baseSnapshotVersion: number;
    /** `baseSnapshotVersion + 1` for applied patches, otherwise `baseSnapshotVersion`. */
    snapshotVersion: number;
    status: FocusTreeSceneAssetsStatus;
    tier?: 'visible' | 'nearby';
    /** Last response for `assetRequestId`. */
    final: boolean;
    /** Focuses whose assets this patch adds. */
    materializedFocusIds?: string[];
    /** Style rules the webview does not have yet, plus rules it asked for again. */
    dynamicStyleCssPatch?: string;
}

export interface FocusTreeCatalogMessage extends FocusTreeContentUpdateMessage {
    command: 'focusTreeCatalog';
    catalog: FocusTreeCatalogView[];
}

export interface FocusTreeSceneMessage extends FocusTreeContentUpdateMessage {
    command: 'focusTreeScene';
    updateType: 'structure';
}

export interface FocusTreeScenePatchMessage extends FocusTreeContentUpdateMessage {
    command: 'focusTreeScenePatch';
    updateType: 'patch';
}

export interface FocusTreeAssetBatchMessage extends FocusTreeContentUpdateMessage {
    command: 'focusTreeAssetBatch';
    updateType: 'assets';
    batchKind?: 'content';
}

export type FocusTreeHostMessage =
    | FocusTreeCatalogMessage
    | FocusTreeSceneMessage
    | FocusTreeScenePatchMessage
    | FocusTreeAssetBatchMessage;

export function getFocusTreeHostCommand(
    updateType: FocusTreeContentUpdateMessage['updateType'],
): Exclude<FocusTreeHostMessage['command'], 'focusTreeCatalog'> {
    return updateType === 'assets'
        ? 'focusTreeAssetBatch'
        : updateType === 'patch'
            ? 'focusTreeScenePatch'
            : 'focusTreeScene';
}

export interface FocusTreeContentUpdatePerf {
    source: string;
    assetLoadMode: 'full' | 'deferred';
    updateKind: 'full' | 'partial';
    changedSlotCount: number;
    payloadBytes: number;
    patchPlanDurationMs: number;
    snapshotBuildDurationMs: number;
    focusCount?: number;
    inlayCount?: number;
    renderedFocusCount?: number;
    renderedInlayCount?: number;
    /** Focuses whose icons this update decoded; the remaining rendered focuses use placeholders. */
    materializedFocusCount?: number;
    deferredAssetLoad?: boolean;
}

export interface FocusTreeContentUpdateDecision {
    shouldRefreshSelectedTreeUi: boolean;
    shouldRebuildContent: boolean;
    shouldApplyIncrementalUpdate: boolean;
    changedCurrentTreeFocusIds: string[];
    shouldRefreshCurrentTreeInlay: boolean;
}

export function getFocusTreeContentUpdateDecision(
    previousCurrentTree: FocusTreeView | undefined,
    nextCurrentTree: FocusTreeView | undefined,
    message: FocusTreeContentUpdateMessage,
): FocusTreeContentUpdateDecision {
    const changedSlots = new Set(message.changedSlots);
    if (!previousCurrentTree || !nextCurrentTree || changedSlots.has('layout')) {
        return {
            shouldRefreshSelectedTreeUi: !!nextCurrentTree,
            shouldRebuildContent: true,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        };
    }

    const currentTreeId = nextCurrentTree.id;
    const selectedTreePatched = previousCurrentTree.id !== nextCurrentTree.id
        || !!message.changedTreeIds?.includes(currentTreeId)
        || !!message.focusTreePatches?.some(patch => patch.treeId === currentTreeId);
    const selectedTreeStructureChanged = !!message.structurallyChangedTreeIds?.includes(currentTreeId);
    if (selectedTreeStructureChanged) {
        return {
            shouldRefreshSelectedTreeUi: true,
            shouldRebuildContent: true,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        };
    }

    const changedCurrentTreeFocusIds = getIntersectingIds(
        Object.keys(nextCurrentTree.focuses),
        message.changedFocusIds ?? Object.keys(message.focusTemplateKeyPatch ?? {}),
        message.removedFocusTemplateKeyIds,
    );
    const changedCurrentTreeInlayIds = getIntersectingIds(
        nextCurrentTree.inlayWindows.map(inlay => inlay.id),
        message.changedInlayWindowIds ?? Object.keys(message.renderedInlayWindowPatch ?? {}),
        message.removedRenderedInlayWindowIds,
    );

    const shouldRefreshCurrentTreeInlay = changedSlots.has('inlays') && changedCurrentTreeInlayIds.length > 0;
    const shouldApplyIncrementalUpdate = selectedTreePatched
        || (changedSlots.has('treeBody') && changedCurrentTreeFocusIds.length > 0)
        || shouldRefreshCurrentTreeInlay;

    return {
        shouldRefreshSelectedTreeUi: selectedTreePatched,
        shouldRebuildContent: false,
        shouldApplyIncrementalUpdate,
        changedCurrentTreeFocusIds,
        shouldRefreshCurrentTreeInlay,
    };
}

function getIntersectingIds(
    ownedIds: string[],
    changedIds: string[] | undefined,
    removedIds: string[] | undefined,
): string[] {
    if ((!changedIds || changedIds.length === 0) && (!removedIds || removedIds.length === 0)) {
        return [];
    }

    const ownedIdSet = new Set(ownedIds);
    const result = new Set<string>();
    changedIds?.forEach(id => {
        if (ownedIdSet.has(id)) {
            result.add(id);
        }
    });
    removedIds?.forEach(id => {
        if (ownedIdSet.has(id)) {
            result.add(id);
        }
    });
    return Array.from(result);
}
