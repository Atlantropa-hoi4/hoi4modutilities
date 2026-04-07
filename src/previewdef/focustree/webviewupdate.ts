import { FocusTree } from "./schema";

export interface FocusTreeContentUpdateMessage {
    mode?: 'full' | 'patch';
    focusTrees?: FocusTree[];
    focusTreePatches?: Array<{ treeId: string; tree: FocusTree }>;
    structurallyChangedTreeIds?: string[];
    renderedFocus?: Record<string, string>;
    renderedFocusPatch?: Record<string, string>;
    removedRenderedFocusIds?: string[];
    renderedInlayWindows?: Record<string, string>;
    renderedInlayWindowPatch?: Record<string, string>;
    removedRenderedInlayWindowIds?: string[];
    gridBox?: unknown;
    xGridSize?: number;
    yGridSize?: number;
}

export interface FocusTreeContentUpdateDecision {
    shouldRefreshSelectedTreeUi: boolean;
    shouldRebuildContent: boolean;
    shouldApplyIncrementalUpdate: boolean;
    changedCurrentTreeFocusIds: string[];
    shouldRefreshCurrentTreeInlay: boolean;
}

export function getFocusTreeContentUpdateDecision(
    previousCurrentTree: FocusTree | undefined,
    nextCurrentTree: FocusTree | undefined,
    message: FocusTreeContentUpdateMessage,
): FocusTreeContentUpdateDecision {
    const requiresFullRebuild = message.mode === 'full'
        || !!message.focusTrees
        || message.gridBox !== undefined
        || message.xGridSize !== undefined
        || message.yGridSize !== undefined;
    if (requiresFullRebuild || !previousCurrentTree || !nextCurrentTree) {
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
        || !!message.focusTreePatches?.some(patch => patch.treeId === currentTreeId);
    const selectedTreeStructureChanged = !!message.structurallyChangedTreeIds?.includes(currentTreeId);
    const changedCurrentTreeFocusIds = getIntersectingIds(
        Object.keys(previousCurrentTree.focuses),
        Object.keys(message.renderedFocusPatch ?? {}),
        message.removedRenderedFocusIds,
    );
    const changedCurrentTreeInlayIds = getIntersectingIds(
        previousCurrentTree.inlayWindows.map(inlay => inlay.id),
        Object.keys(message.renderedInlayWindowPatch ?? {}),
        message.removedRenderedInlayWindowIds,
    );

    if (selectedTreeStructureChanged) {
        return {
            shouldRefreshSelectedTreeUi: true,
            shouldRebuildContent: true,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        };
    }

    const shouldRefreshCurrentTreeInlay = changedCurrentTreeInlayIds.length > 0;
    const shouldApplyIncrementalUpdate = selectedTreePatched
        || changedCurrentTreeFocusIds.length > 0
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
