import { focusTreeProtocolVersion, FocusTreeView } from './viewmodel';

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
    updateType?: 'structure' | 'assets' | 'patch';
    snapshotVersion: number;
    documentVersion: number;
    focusPositionActiveFile?: string;
    selectedTreeId?: string;
    changedSlots: FocusTreeContentSlot[];
    changedTreeIds?: string[];
    structurallyChangedTreeIds?: string[];
    changedFocusIds?: string[];
    changedInlayWindowIds?: string[];
    focusTrees?: FocusTreeView[];
    focusTreePatches?: Array<{ treeId: string; tree: FocusTreeView }>;
    continuousFocusHtml?: string;
    renderedFocus?: Record<string, string>;
    renderedFocusPatch?: Record<string, string>;
    removedRenderedFocusIds?: string[];
    renderedInlayWindows?: Record<string, string>;
    renderedInlayWindowPatch?: Record<string, string>;
    removedRenderedInlayWindowIds?: string[];
    gridBox?: unknown;
    dynamicStyleCss?: string;
    dynamicStyleCssPatch?: string;
    xGridSize?: number;
    yGridSize?: number;
    perf?: FocusTreeContentUpdatePerf;
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
        message.changedFocusIds ?? Object.keys(message.renderedFocusPatch ?? {}),
        message.removedRenderedFocusIds,
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
