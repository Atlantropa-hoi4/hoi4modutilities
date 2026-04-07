import { HOIPartial } from "../../hoiformat/schema";
import { GridBoxType } from "../../hoiformat/gui";
import { StyleTable } from "../../util/styletable";
import type { FocusTreeRenderBaseState, FocusTreeRenderPayload } from "./contentbuilder";
import { renderFocusHtmlTemplate } from "./focusrender";
import { Focus, FocusTree, FocusTreeInlay } from "./schema";

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
    treePatchSignatures: Record<string, string>;
    treeStructureSignatures: Record<string, string>;
    focusRenderSignatures: Record<string, string>;
    inlayRenderSignatures: Record<string, string>;
    styleDependencySignature: string;
}

export interface FocusTreeRenderPatch {
    mode: 'full' | 'patch';
    focusTrees?: FocusTree[];
    focusTreePatches?: Array<{ treeId: string; tree: FocusTree }>;
    structurallyChangedTreeIds?: string[];
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

export type FocusTreeRenderPatchPlan =
    | { mode: 'full' }
    | {
        mode: 'patch';
        patch: FocusTreeRenderPatch;
        snapshot: FocusTreeRenderStateSnapshot;
        changedTreeCount: number;
        changedFocusCount: number;
    };

export function createFocusTreeRenderStateSnapshot(
    payload: FocusTreeRenderPayload,
): FocusTreeRenderStateSnapshot {
    const metadata = deriveRenderStateMetadata(payload.focusTrees, payload.xGridSize, payload.yGridSize);
    return {
        focusTrees: payload.focusTrees,
        renderedFocus: payload.renderedFocus,
        renderedInlayWindows: payload.renderedInlayWindows,
        gridBox: payload.gridBox,
        dynamicStyleCss: payload.dynamicStyleCss,
        xGridSize: payload.xGridSize,
        yGridSize: payload.yGridSize,
        focusPositionDocumentVersion: payload.focusPositionDocumentVersion,
        hasFocusSelector: payload.hasFocusSelector,
        hasWarningsButton: payload.hasWarningsButton,
        ...metadata,
    };
}

export function createFocusTreeRenderPatch(
    previous: FocusTreeRenderStateSnapshot | undefined,
    nextBaseState: FocusTreeRenderBaseState,
): FocusTreeRenderPatchPlan {
    const nextMetadata = deriveRenderStateMetadata(
        nextBaseState.focusTrees,
        nextBaseState.xGridSize,
        nextBaseState.yGridSize,
    );

    if (!previous || shouldUseFullPayload(previous, nextBaseState, nextMetadata)) {
        return { mode: 'full' };
    }

    const focusTreePatches = nextBaseState.focusTrees
        .filter(tree => previous.treePatchSignatures[tree.id] !== nextMetadata.treePatchSignatures[tree.id])
        .map(tree => ({ treeId: tree.id, tree }));
    const structurallyChangedTreeIds = focusTreePatches
        .map(patch => patch.treeId)
        .filter(treeId => previous.treeStructureSignatures[treeId] !== nextMetadata.treeStructureSignatures[treeId]);

    const focusSignatureDiff = diffSignatureMap(previous.focusRenderSignatures, nextMetadata.focusRenderSignatures);
    const renderedFocusPatch = renderChangedFocusHtmlMap(nextBaseState, focusSignatureDiff.changedKeys);

    const snapshot: FocusTreeRenderStateSnapshot = {
        focusTrees: nextBaseState.focusTrees,
        renderedFocus: mergeStringMap(previous.renderedFocus, renderedFocusPatch, focusSignatureDiff.removedKeys),
        renderedInlayWindows: previous.renderedInlayWindows,
        gridBox: nextBaseState.gridBox,
        dynamicStyleCss: previous.dynamicStyleCss,
        xGridSize: nextBaseState.xGridSize,
        yGridSize: nextBaseState.yGridSize,
        focusPositionDocumentVersion: nextBaseState.focusPositionDocumentVersion,
        hasFocusSelector: nextBaseState.hasFocusSelector,
        hasWarningsButton: nextBaseState.hasWarningsButton,
        ...nextMetadata,
    };

    return {
        mode: 'patch',
        patch: {
            mode: 'patch',
            focusTreePatches: focusTreePatches.length > 0 ? focusTreePatches : undefined,
            structurallyChangedTreeIds: structurallyChangedTreeIds.length > 0 ? structurallyChangedTreeIds : undefined,
            renderedFocusPatch: Object.keys(renderedFocusPatch).length > 0 ? renderedFocusPatch : undefined,
            removedRenderedFocusIds: focusSignatureDiff.removedKeys.length > 0 ? focusSignatureDiff.removedKeys : undefined,
            gridBox: nextBaseState.gridBox,
            dynamicStyleCss: previous.dynamicStyleCss,
            xGridSize: nextBaseState.xGridSize,
            yGridSize: nextBaseState.yGridSize,
            documentVersion: nextBaseState.focusPositionDocumentVersion,
        },
        snapshot,
        changedTreeCount: focusTreePatches.length,
        changedFocusCount: focusSignatureDiff.changedKeys.length + focusSignatureDiff.removedKeys.length,
    };
}

function shouldUseFullPayload(
    previous: FocusTreeRenderStateSnapshot,
    nextBaseState: FocusTreeRenderBaseState,
    nextMetadata: DerivedRenderStateMetadata,
): boolean {
    if (previous.focusTrees.length !== nextBaseState.focusTrees.length
        || previous.hasFocusSelector !== nextBaseState.hasFocusSelector
        || previous.hasWarningsButton !== nextBaseState.hasWarningsButton
        || previous.xGridSize !== nextBaseState.xGridSize
        || previous.yGridSize !== nextBaseState.yGridSize
        || JSON.stringify(previous.gridBox) !== JSON.stringify(nextBaseState.gridBox)
        || previous.styleDependencySignature !== nextMetadata.styleDependencySignature) {
        return true;
    }

    for (let index = 0; index < nextBaseState.focusTrees.length; index += 1) {
        if (previous.focusTrees[index]?.id !== nextBaseState.focusTrees[index]?.id) {
            return true;
        }
    }

    const inlaySignatureDiff = diffSignatureMap(previous.inlayRenderSignatures, nextMetadata.inlayRenderSignatures);
    return inlaySignatureDiff.changedKeys.length > 0 || inlaySignatureDiff.removedKeys.length > 0;
}

interface DerivedRenderStateMetadata {
    treePatchSignatures: Record<string, string>;
    treeStructureSignatures: Record<string, string>;
    focusRenderSignatures: Record<string, string>;
    inlayRenderSignatures: Record<string, string>;
    styleDependencySignature: string;
}

function deriveRenderStateMetadata(
    focusTrees: FocusTree[],
    xGridSize: number,
    yGridSize: number,
): DerivedRenderStateMetadata {
    const treePatchSignatures: Record<string, string> = {};
    const treeStructureSignatures: Record<string, string> = {};
    const focusRenderSignatures: Record<string, string> = {};
    const inlayRenderSignatures: Record<string, string> = {};
    const styleDependencyInput: unknown[] = [xGridSize, yGridSize];

    for (const tree of focusTrees) {
        treePatchSignatures[tree.id] = JSON.stringify(toTreePatchComparable(tree));
        treeStructureSignatures[tree.id] = JSON.stringify(toTreeStructureComparable(tree));

        const sortedFocuses = Object.values(tree.focuses).sort((left, right) => left.id.localeCompare(right.id));
        for (const focus of sortedFocuses) {
            focusRenderSignatures[focus.id] = JSON.stringify(toFocusRenderComparable(focus));
            styleDependencyInput.push([
                focus.id,
                focus.icon.map(icon => [icon.icon, icon.condition]),
            ]);
        }

        for (const inlay of tree.inlayWindows) {
            inlayRenderSignatures[inlay.id] = JSON.stringify(toInlayRenderComparable(inlay));
        }
    }

    return {
        treePatchSignatures,
        treeStructureSignatures,
        focusRenderSignatures,
        inlayRenderSignatures,
        styleDependencySignature: JSON.stringify(styleDependencyInput),
    };
}

function toTreePatchComparable(focusTree: FocusTree) {
    const focusEntries = Object.values(focusTree.focuses)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(focus => [
            focus.id,
            focus.layoutEditKey,
            focus.x,
            focus.y,
            focus.icon,
            focus.available,
            focus.availableIfCapitulated,
            focus.hasAiWillDo,
            focus.hasCompletionReward,
            focus.prerequisite,
            focus.prerequisiteGroupCount,
            focus.prerequisiteFocusCount,
            focus.exclusive,
            focus.exclusiveCount,
            focus.hasAllowBranch,
            focus.inAllowBranch,
            focus.allowBranch,
            focus.relativePositionId,
            focus.offset,
            focus.token?.start,
            focus.token?.end,
            focus.file,
            focus.isInCurrentFile,
            focus.text,
            focus.layout?.editable,
            focus.layout?.sourceFile,
            focus.layout?.basePosition,
            focus.layout?.relativePositionId,
            focus.layout?.offsets,
            focus.lintWarningCount,
            focus.lintInfoCount,
            focus.lintMessages,
        ]);

    const inlayEntries = focusTree.inlayWindows.map(inlay => ({
        id: inlay.id,
        file: inlay.file,
        tokenStart: inlay.token?.start,
        tokenEnd: inlay.token?.end,
        windowName: inlay.windowName,
        guiFile: inlay.guiFile,
        guiWindow: inlay.guiWindow,
        internal: inlay.internal,
        visible: inlay.visible,
        position: inlay.position,
        conditionExprs: inlay.conditionExprs,
        scriptedImages: inlay.scriptedImages.map(slot => ({
            id: slot.id,
            file: slot.file,
            tokenStart: slot.token?.start,
            tokenEnd: slot.token?.end,
            gfxOptions: slot.gfxOptions.map(option => ({
                gfxName: option.gfxName,
                condition: option.condition,
                file: option.file,
                tokenStart: option.token?.start,
                tokenEnd: option.token?.end,
                gfxFile: option.gfxFile,
            })),
        })),
        scriptedButtons: inlay.scriptedButtons,
    }));

    return {
        id: focusTree.id,
        kind: focusTree.kind,
        allowBranchOptions: focusTree.allowBranchOptions,
        conditionExprs: focusTree.conditionExprs,
        isSharedFocues: focusTree.isSharedFocues,
        continuousFocusPositionX: focusTree.continuousFocusPositionX,
        continuousFocusPositionY: focusTree.continuousFocusPositionY,
        createTemplate: focusTree.createTemplate,
        continuousLayout: focusTree.continuousLayout,
        inlayWindowRefs: focusTree.inlayWindowRefs,
        inlayWindows: inlayEntries,
        warnings: focusTree.warnings,
        focuses: focusEntries,
    };
}

function toTreeStructureComparable(focusTree: FocusTree) {
    return {
        id: focusTree.id,
        kind: focusTree.kind,
        allowBranchOptions: focusTree.allowBranchOptions,
        conditionExprs: focusTree.conditionExprs,
        isSharedFocues: focusTree.isSharedFocues,
        continuousFocusPositionX: focusTree.continuousFocusPositionX,
        continuousFocusPositionY: focusTree.continuousFocusPositionY,
        createTemplate: focusTree.createTemplate,
        continuousLayout: focusTree.continuousLayout,
        focuses: Object.values(focusTree.focuses)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(focus => ({
                id: focus.id,
                x: focus.x,
                y: focus.y,
                prerequisite: focus.prerequisite,
                exclusive: focus.exclusive,
                inAllowBranch: focus.inAllowBranch,
                allowBranch: focus.allowBranch,
                relativePositionId: focus.relativePositionId,
                offset: focus.offset,
            })),
    };
}

function toFocusRenderComparable(focus: Focus) {
    return {
        id: focus.id,
        tokenStart: focus.token?.start,
        tokenEnd: focus.token?.end,
        file: focus.file,
        isInCurrentFile: focus.isInCurrentFile,
        text: focus.text,
        layoutEditable: focus.layout?.editable,
        layoutSourceFile: focus.layout?.sourceFile,
    };
}

function toInlayRenderComparable(inlay: FocusTreeInlay) {
    return {
        id: inlay.id,
        file: inlay.file,
        tokenStart: inlay.token?.start,
        tokenEnd: inlay.token?.end,
        windowName: inlay.windowName,
        guiFile: inlay.guiFile,
        guiWindow: inlay.guiWindow,
        internal: inlay.internal,
        position: inlay.position,
        scriptedImages: inlay.scriptedImages.map(slot => ({
            id: slot.id,
            file: slot.file,
            tokenStart: slot.token?.start,
            tokenEnd: slot.token?.end,
            gfxOptions: slot.gfxOptions.map(option => ({
                gfxName: option.gfxName,
                condition: option.condition,
                file: option.file,
                tokenStart: option.token?.start,
                tokenEnd: option.token?.end,
                gfxFile: option.gfxFile,
            })),
        })),
        scriptedButtons: inlay.scriptedButtons,
    };
}

function diffSignatureMap(
    previous: Record<string, string>,
    next: Record<string, string>,
): { changedKeys: string[]; removedKeys: string[] } {
    const changedKeys: string[] = [];
    const removedKeys: string[] = [];

    for (const [key, value] of Object.entries(next)) {
        if (previous[key] !== value) {
            changedKeys.push(key);
        }
    }

    for (const key of Object.keys(previous)) {
        if (!(key in next)) {
            removedKeys.push(key);
        }
    }

    return { changedKeys, removedKeys };
}

function mergeStringMap(
    previous: Record<string, string>,
    changed: Record<string, string>,
    removed: readonly string[],
): Record<string, string> {
    const result: Record<string, string> = { ...previous, ...changed };
    removed.forEach(key => {
        delete result[key];
    });
    return result;
}

function renderChangedFocusHtmlMap(
    baseState: FocusTreeRenderBaseState,
    focusIds: readonly string[],
): Record<string, string> {
    const styleTable = new StyleTable();
    const renderedFocus: Record<string, string> = {};
    for (const focusId of focusIds) {
        const focus = baseState.focusById[focusId];
        if (!focus) {
            continue;
        }

        renderedFocus[focus.id] = renderFocusHtmlTemplate(
            focus,
            styleTable,
            baseState.focusPositionActiveFile,
            baseState.xGridSize,
            baseState.yGridSize,
        ).replace(/\s\s+/g, ' ');
    }

    return renderedFocus;
}
