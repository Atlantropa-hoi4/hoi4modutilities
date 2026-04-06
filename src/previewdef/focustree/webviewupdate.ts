import { isEqual } from "lodash";
import { FocusTree } from "./schema";

export interface FocusTreeContentUpdateMessage {
    mode?: 'full' | 'patch';
    focusTrees?: FocusTree[];
    focusTreePatches?: Array<{ treeId: string; tree: FocusTree }>;
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

    if (selectedTreePatched && !isEqual(
        toIncrementalGridRenderModel(previousCurrentTree),
        toIncrementalGridRenderModel(nextCurrentTree),
    )) {
        return {
            shouldRefreshSelectedTreeUi: true,
            shouldRebuildContent: true,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        };
    }

    const shouldRefreshCurrentTreeInlay = changedCurrentTreeInlayIds.length > 0
        || (selectedTreePatched && !isEqual(
            toIncrementalInlayModel(previousCurrentTree),
            toIncrementalInlayModel(nextCurrentTree),
        ));
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

function toIncrementalGridRenderModel(focusTree: FocusTree) {
    return {
        id: focusTree.id,
        allowBranchOptions: focusTree.allowBranchOptions,
        conditionExprs: focusTree.conditionExprs,
        isSharedFocues: focusTree.isSharedFocues,
        focuses: Object.fromEntries(
            Object.entries(focusTree.focuses).map(([focusId, focus]) => [focusId, {
                id: focus.id,
                x: focus.x,
                y: focus.y,
                icon: focus.icon,
                prerequisite: focus.prerequisite,
                exclusive: focus.exclusive,
                inAllowBranch: focus.inAllowBranch,
                allowBranch: focus.allowBranch,
                relativePositionId: focus.relativePositionId,
                offset: focus.offset,
            }]),
        ),
    };
}

function toIncrementalInlayModel(focusTree: FocusTree) {
    return focusTree.inlayWindows.map(inlay => ({
        id: inlay.id,
        visible: inlay.visible,
        scriptedImages: inlay.scriptedImages.map(slot => ({
            id: slot.id,
            gfxOptions: slot.gfxOptions.map(option => ({
                gfxName: option.gfxName,
                condition: option.condition,
                gfxFile: option.gfxFile,
            })),
        })),
    }));
}
