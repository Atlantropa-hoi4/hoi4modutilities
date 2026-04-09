import { FocusTree } from "../../src/previewdef/focustree/schema";
import { FocusTreeContentUpdateMessage } from "../../src/previewdef/focustree/webviewupdate";

export interface FocusTreeMessageApplyContext {
    getSnapshotVersion: () => number;
    setSnapshotVersion: (snapshotVersion: number) => void;
    getDocumentVersion: () => number;
    setDocumentVersion: (documentVersion: number) => void;
    getCurrentSelectionTreeId: () => string | undefined;
    setSelectedFocusTreeById: (treeId: string | undefined) => void;
    setFocusTrees: (focusTrees: FocusTree[]) => void;
    applyFocusTreePatches: (focusTreePatches: Array<{ treeId: string; tree: FocusTree }> | undefined) => void;
    setRenderedFocus: (renderedFocus: Record<string, string>) => void;
    patchRenderedFocus: (changedEntries: Record<string, string> | undefined, removedKeys: string[] | undefined) => void;
    setRenderedInlayWindows: (renderedInlayWindows: Record<string, string>) => void;
    patchRenderedInlayWindows: (changedEntries: Record<string, string> | undefined, removedKeys: string[] | undefined) => void;
    refreshFocusTreeSelectorOptions: () => void;
    refreshWarningsButtonVisibility: () => void;
    setGridBox: (gridBox: unknown) => void;
    setGridSizeX: (xGridSize: number) => void;
    setGridSizeY: (yGridSize: number) => void;
    replaceDynamicStyleCss: (dynamicStyleCss: string | undefined) => void;
}

export function applyFocusTreeContentUpdate(
    message: FocusTreeContentUpdateMessage & {
        dynamicStyleCss?: string;
        documentVersion?: number;
    },
    context: FocusTreeMessageApplyContext,
): boolean {
    if (message.snapshotVersion < context.getSnapshotVersion()) {
        return false;
    }
    if (message.documentVersion !== undefined && message.documentVersion < context.getDocumentVersion()) {
        return false;
    }

    const changedSlots = new Set(message.changedSlots ?? []);
    const previousSelectedTreeId = context.getCurrentSelectionTreeId();
    if (changedSlots.has('treeDefinitions')) {
        if (message.focusTrees) {
            context.setFocusTrees(message.focusTrees);
        } else if (message.focusTreePatches) {
            context.applyFocusTreePatches(message.focusTreePatches);
        }
        context.setSelectedFocusTreeById(previousSelectedTreeId ?? message.selectedTreeId);
    }
    if (changedSlots.has('treeBody') && message.renderedFocus) {
        context.setRenderedFocus(message.renderedFocus);
    } else if (changedSlots.has('treeBody')) {
        context.patchRenderedFocus(message.renderedFocusPatch, message.removedRenderedFocusIds);
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
    if (changedSlots.has('styleDeps')) {
        context.replaceDynamicStyleCss(message.dynamicStyleCss);
    }

    context.setSnapshotVersion(message.snapshotVersion);
    context.setDocumentVersion(message.documentVersion ?? context.getDocumentVersion());
    return true;
}
