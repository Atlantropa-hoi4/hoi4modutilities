import { isEqual } from "lodash";
import { HOIPartial } from "../../hoiformat/schema";
import { GridBoxType } from "../../hoiformat/gui";
import { FocusTree } from "./schema";

export interface FocusTreeRenderStateSnapshot {
    focusTrees: FocusTree[];
    renderedFocus: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    gridBox: HOIPartial<GridBoxType>;
    dynamicStyleCss: string;
    xGridSize: number;
    yGridSize: number;
    focusPositionDocumentVersion: number;
    hasFocusSelector: boolean;
    hasWarningsButton: boolean;
}

export interface FocusTreeRenderPatch {
    mode: 'full' | 'patch';
    focusTrees?: FocusTree[];
    focusTreePatches?: Array<{ treeId: string; tree: FocusTree }>;
    renderedFocus?: Record<string, string>;
    renderedFocusPatch?: Record<string, string>;
    removedRenderedFocusIds?: string[];
    renderedInlayWindows?: Record<string, string>;
    renderedInlayWindowPatch?: Record<string, string>;
    removedRenderedInlayWindowIds?: string[];
    gridBox: HOIPartial<GridBoxType>;
    dynamicStyleCss: string;
    xGridSize: number;
    yGridSize: number;
    documentVersion: number;
}

export function createFocusTreeRenderPatch(
    previous: FocusTreeRenderStateSnapshot | undefined,
    next: FocusTreeRenderStateSnapshot,
): FocusTreeRenderPatch {
    if (!previous || shouldUseFullPayload(previous, next)) {
        return {
            mode: 'full',
            focusTrees: next.focusTrees,
            renderedFocus: next.renderedFocus,
            renderedInlayWindows: next.renderedInlayWindows,
            gridBox: next.gridBox,
            dynamicStyleCss: next.dynamicStyleCss,
            xGridSize: next.xGridSize,
            yGridSize: next.yGridSize,
            documentVersion: next.focusPositionDocumentVersion,
        };
    }

    const previousTreesById = new Map(previous.focusTrees.map(tree => [tree.id, tree]));
    const focusTreePatches = next.focusTrees
        .filter(tree => !isEqual(previousTreesById.get(tree.id), tree))
        .map(tree => ({ treeId: tree.id, tree }));

    const renderedFocusPatch: Record<string, string> = {};
    const removedRenderedFocusIds: string[] = [];
    diffStringMap(previous.renderedFocus, next.renderedFocus, renderedFocusPatch, removedRenderedFocusIds);

    const renderedInlayWindowPatch: Record<string, string> = {};
    const removedRenderedInlayWindowIds: string[] = [];
    diffStringMap(previous.renderedInlayWindows, next.renderedInlayWindows, renderedInlayWindowPatch, removedRenderedInlayWindowIds);

    return {
        mode: 'patch',
        focusTreePatches: focusTreePatches.length > 0 ? focusTreePatches : undefined,
        renderedFocusPatch: Object.keys(renderedFocusPatch).length > 0 ? renderedFocusPatch : undefined,
        removedRenderedFocusIds: removedRenderedFocusIds.length > 0 ? removedRenderedFocusIds : undefined,
        renderedInlayWindowPatch: Object.keys(renderedInlayWindowPatch).length > 0 ? renderedInlayWindowPatch : undefined,
        removedRenderedInlayWindowIds: removedRenderedInlayWindowIds.length > 0 ? removedRenderedInlayWindowIds : undefined,
        gridBox: next.gridBox,
        dynamicStyleCss: next.dynamicStyleCss,
        xGridSize: next.xGridSize,
        yGridSize: next.yGridSize,
        documentVersion: next.focusPositionDocumentVersion,
    };
}

function shouldUseFullPayload(
    previous: FocusTreeRenderStateSnapshot,
    next: FocusTreeRenderStateSnapshot,
): boolean {
    if (previous.focusTrees.length !== next.focusTrees.length
        || previous.hasFocusSelector !== next.hasFocusSelector
        || previous.hasWarningsButton !== next.hasWarningsButton
        || previous.xGridSize !== next.xGridSize
        || previous.yGridSize !== next.yGridSize
        || !isEqual(previous.gridBox, next.gridBox)) {
        return true;
    }

    for (let index = 0; index < next.focusTrees.length; index += 1) {
        if (previous.focusTrees[index]?.id !== next.focusTrees[index]?.id) {
            return true;
        }
    }

    return false;
}

function diffStringMap(
    previous: Record<string, string>,
    next: Record<string, string>,
    changed: Record<string, string>,
    removed: string[],
) {
    for (const [key, value] of Object.entries(next)) {
        if (previous[key] !== value) {
            changed[key] = value;
        }
    }

    for (const key of Object.keys(previous)) {
        if (!(key in next)) {
            removed.push(key);
        }
    }
}
