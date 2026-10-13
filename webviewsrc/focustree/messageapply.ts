import { FocusTreeView, FocusTreeViewPatch } from '../../src/previewdef/focustree/viewmodel';
import { FocusTreeAssetMaterialization, FocusTreeContentUpdateMessage } from "../../src/previewdef/focustree/webviewupdate";

export interface FocusTreeMessageApplyContext {
    getSnapshotVersion: () => number;
    setSnapshotVersion: (snapshotVersion: number) => void;
    getDocumentVersion: () => number;
    setDocumentVersion: (documentVersion: number) => void;
    setFocusPositionActiveFile: (focusPositionActiveFile: string) => void;
    getCurrentSelectionTreeId: () => string | undefined;
    /**
     * The tree the user selected last, rendered or still being requested. It wins over the
     * rendered tree, so a scene arriving for an earlier request cannot revert a newer selection.
     */
    getRequestedSelectionTreeId?: () => string | undefined;
    setSelectedFocusTreeById: (treeId: string | undefined) => void;
    setFocusTrees: (focusTrees: FocusTreeView[]) => void;
    applyFocusTreePatches: (focusTreePatches: FocusTreeViewPatch[] | undefined, baseSnapshotVersion?: number) => void;
    setContinuousFocusHtml?: (html: string) => void;
    setFocusTemplates: (templates: Record<string, string>, keyById: Record<string, string>) => void;
    patchFocusTemplates: (
        templates: Record<string, string> | undefined,
        keyById: Record<string, string> | undefined,
        removedFocusIds: string[] | undefined,
    ) => void;
    setRenderedInlayWindows: (renderedInlayWindows: Record<string, string>) => void;
    patchRenderedInlayWindows: (changedEntries: Record<string, string> | undefined, removedKeys: string[] | undefined) => void;
    refreshFocusTreeSelectorOptions: () => void;
    refreshWarningsButtonVisibility: () => void;
    setGridBox: (gridBox: unknown) => void;
    setGridSizeX: (xGridSize: number) => void;
    setGridSizeY: (yGridSize: number) => void;
    /** Replaces the materialized focus set; called before the scene is rebuilt. */
    setAssetMaterialization?: (materialization: FocusTreeAssetMaterialization) => void;
}

/**
 * Applies the content of a host update. Its dynamic style sync is applied separately, before any
 * staleness check, because the stylesheet follows every message the host posted.
 */
export function applyFocusTreeContentUpdate(
    message: FocusTreeContentUpdateMessage,
    context: FocusTreeMessageApplyContext,
): boolean {
    if (message.snapshotVersion < context.getSnapshotVersion()) {
        return false;
    }
    if (message.documentVersion !== undefined && message.documentVersion < context.getDocumentVersion()) {
        return false;
    }

    if (message.focusPositionActiveFile !== undefined) {
        context.setFocusPositionActiveFile(message.focusPositionActiveFile);
    }

    const changedSlots = new Set(message.changedSlots ?? []);
    const previousSelectedTreeId = context.getRequestedSelectionTreeId?.() ?? context.getCurrentSelectionTreeId();
    if (changedSlots.has('treeDefinitions')) {
        if (message.focusTrees) {
            context.setFocusTrees(message.focusTrees);
        } else if (message.focusTreePatches) {
            context.applyFocusTreePatches(message.focusTreePatches, message.baseSnapshotVersion);
        }
        // A selected tree whose scene is still requested stays selected while other scenes
        // arrive; only a tree that left the catalog falls back to the host's choice.
        const previousSelectionStillExists = !!previousSelectedTreeId
            && (!message.focusTrees
                || message.focusTrees.some(focusTree => focusTree.id === previousSelectedTreeId)
                || !!message.catalog?.some(entry => entry.id === previousSelectedTreeId));
        context.setSelectedFocusTreeById(
            previousSelectionStillExists
                ? previousSelectedTreeId
                : (message.selectedTreeId ?? previousSelectedTreeId),
        );
    }
    if (message.continuousFocusHtml !== undefined) { context.setContinuousFocusHtml?.(message.continuousFocusHtml); }
    if (changedSlots.has('treeBody') && message.focusTemplateKeyById) {
        context.setFocusTemplates(message.focusTemplates ?? {}, message.focusTemplateKeyById);
    } else if (changedSlots.has('treeBody')) {
        context.patchFocusTemplates(message.focusTemplatePatch, message.focusTemplateKeyPatch, message.removedFocusTemplateKeyIds);
    }
    if (changedSlots.has('inlays') && message.renderedInlayWindows) {
        context.setRenderedInlayWindows(message.renderedInlayWindows);
    } else if (changedSlots.has('inlays')) {
        context.patchRenderedInlayWindows(message.renderedInlayWindowPatch, message.removedRenderedInlayWindowIds);
    }
    if (changedSlots.has('selector')) {
        context.refreshFocusTreeSelectorOptions();
    }
    if (changedSlots.has('warnings')) {
        context.refreshWarningsButtonVisibility();
    }
    if (changedSlots.has('layout') && message.gridBox) {
        context.setGridBox(message.gridBox);
    }
    if (changedSlots.has('layout') && message.xGridSize !== undefined) {
        context.setGridSizeX(message.xGridSize);
    }
    if (changedSlots.has('layout') && message.yGridSize !== undefined) {
        context.setGridSizeY(message.yGridSize);
    }
    if (message.assetMaterialization) {
        context.setAssetMaterialization?.(message.assetMaterialization);
    }

    context.setSnapshotVersion(message.snapshotVersion);
    context.setDocumentVersion(message.documentVersion ?? context.getDocumentVersion());
    return true;
}
