import { HOIPartial } from "../../hoiformat/schema";
import { GridBoxType } from "../../hoiformat/gui";
import { StyleTable } from "../../util/styletable";
import type { FocusTreeRenderBaseState, FocusTreeRenderPayload } from "./contentbuilder";
import { Focus, FocusTree, FocusTreeInlay } from "./schema";
import { renderFocusHtmlTemplate } from "./focusrender";
import { FocusTreeContentSlot, FocusTreeContentUpdateMessage } from "./webviewupdate";

export interface FocusTreeRenderCache {
    snapshotVersion: number;
    selectedTreeId?: string;
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
    deferredAssetLoad: boolean;
    treePatchSignatures: Record<string, string>;
    treeStructureSignatures: Record<string, string>;
    focusRenderSignatures: Record<string, string>;
    inlayRenderSignatures: Record<string, string>;
    styleDependencySignature: string;
}

export type FocusTreeRenderUpdatePlan =
    | { kind: 'full' }
    | {
        kind: 'partial';
        update: FocusTreeContentUpdateMessage;
        cache: FocusTreeRenderCache;
        changedTreeCount: number;
        changedFocusCount: number;
        changedInlayCount: number;
    };

const fullRenderChangedSlots: FocusTreeContentSlot[] = [
    'treeDefinitions',
    'selector',
    'warnings',
    'treeBody',
    'inlays',
    'layout',
    'styleDeps',
];

export function createFocusTreeRenderCache(
    payload: FocusTreeRenderPayload,
    previousVersion: number = 0,
): FocusTreeRenderCache {
    const metadata = deriveRenderStateMetadata(payload.focusTrees, payload.xGridSize, payload.yGridSize);
    return {
        snapshotVersion: previousVersion + 1,
        selectedTreeId: payload.focusTrees[0]?.id,
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
        deferredAssetLoad: payload.deferredAssetLoad,
        ...metadata,
    };
}

export function createFullFocusTreeRenderUpdate(
    payload: FocusTreeRenderPayload,
    previousCache?: FocusTreeRenderCache,
): { update: FocusTreeContentUpdateMessage; cache: FocusTreeRenderCache } {
    const cache = createFocusTreeRenderCache(payload, previousCache?.snapshotVersion);
    return {
        cache,
        update: {
            snapshotVersion: cache.snapshotVersion,
            documentVersion: payload.focusPositionDocumentVersion,
            selectedTreeId: cache.selectedTreeId,
            changedSlots: fullRenderChangedSlots,
            changedTreeIds: payload.focusTrees.map(tree => tree.id),
            structurallyChangedTreeIds: payload.focusTrees.map(tree => tree.id),
            changedFocusIds: Object.keys(payload.renderedFocus),
            changedInlayWindowIds: Object.keys(payload.renderedInlayWindows),
            focusTrees: payload.focusTrees,
            renderedFocus: payload.renderedFocus,
            renderedInlayWindows: payload.renderedInlayWindows,
            gridBox: payload.gridBox,
            dynamicStyleCss: payload.dynamicStyleCss,
            xGridSize: payload.xGridSize,
            yGridSize: payload.yGridSize,
        },
    };
}

export async function createFocusTreeRenderUpdate(
    previous: FocusTreeRenderCache | undefined,
    nextBaseState: FocusTreeRenderBaseState,
): Promise<FocusTreeRenderUpdatePlan> {
    const nextMetadata = deriveRenderStateMetadata(
        nextBaseState.focusTrees,
        nextBaseState.xGridSize,
        nextBaseState.yGridSize,
    );

    if (!previous || shouldUseFullRender(previous, nextBaseState, nextMetadata)) {
        return { kind: 'full' };
    }

    const focusTreePatches = nextBaseState.focusTrees
        .filter(tree => previous.treePatchSignatures[tree.id] !== nextMetadata.treePatchSignatures[tree.id])
        .map(tree => ({ treeId: tree.id, tree }));
    const changedTreeIds = focusTreePatches.map(patch => patch.treeId);
    const structurallyChangedTreeIds = changedTreeIds
        .filter(treeId => previous.treeStructureSignatures[treeId] !== nextMetadata.treeStructureSignatures[treeId]);

    const focusSignatureDiff = diffSignatureMap(previous.focusRenderSignatures, nextMetadata.focusRenderSignatures);
    const inlaySignatureDiff = diffSignatureMap(previous.inlayRenderSignatures, nextMetadata.inlayRenderSignatures);
    if (inlaySignatureDiff.changedKeys.length > 0 || inlaySignatureDiff.removedKeys.length > 0) {
        return { kind: 'full' };
    }

    const renderedFocusPatch = renderChangedFocusHtmlMap(nextBaseState, focusSignatureDiff.changedKeys);

    const changedSlots = new Set<FocusTreeContentSlot>();
    if (changedTreeIds.length > 0) {
        changedSlots.add('treeDefinitions');
        changedSlots.add('selector');
        changedSlots.add('warnings');
    }
    if (focusSignatureDiff.changedKeys.length > 0 || focusSignatureDiff.removedKeys.length > 0) {
        changedSlots.add('treeBody');
    }
    const cache: FocusTreeRenderCache = {
        snapshotVersion: previous.snapshotVersion + 1,
        selectedTreeId: nextBaseState.focusTrees[0]?.id,
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
        deferredAssetLoad: nextBaseState.deferredAssetLoad,
        ...nextMetadata,
    };

    return {
        kind: 'partial',
        update: {
            snapshotVersion: cache.snapshotVersion,
            documentVersion: nextBaseState.focusPositionDocumentVersion,
            selectedTreeId: cache.selectedTreeId,
            changedSlots: Array.from(changedSlots),
            changedTreeIds: changedTreeIds.length > 0 ? changedTreeIds : undefined,
            structurallyChangedTreeIds: structurallyChangedTreeIds.length > 0 ? structurallyChangedTreeIds : undefined,
            changedFocusIds: focusSignatureDiff.changedKeys.length > 0 ? focusSignatureDiff.changedKeys : undefined,
        focusTreePatches: focusTreePatches.length > 0 ? focusTreePatches : undefined,
        renderedFocusPatch: Object.keys(renderedFocusPatch).length > 0 ? renderedFocusPatch : undefined,
        removedRenderedFocusIds: focusSignatureDiff.removedKeys.length > 0 ? focusSignatureDiff.removedKeys : undefined,
        },
        cache,
        changedTreeCount: changedTreeIds.length,
        changedFocusCount: focusSignatureDiff.changedKeys.length + focusSignatureDiff.removedKeys.length,
        changedInlayCount: 0,
    };
}

function shouldUseFullRender(
    previous: FocusTreeRenderCache,
    nextBaseState: FocusTreeRenderBaseState,
    nextMetadata: DerivedRenderStateMetadata,
): boolean {
    if (previous.focusTrees.length !== nextBaseState.focusTrees.length
        || previous.hasFocusSelector !== nextBaseState.hasFocusSelector
        || previous.hasWarningsButton !== nextBaseState.hasWarningsButton
        || previous.deferredAssetLoad !== nextBaseState.deferredAssetLoad
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

    return false;
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
                'focus',
                focus.id,
                focus.icon.map(icon => [icon.icon, icon.condition]),
            ]);
        }

        for (const inlay of tree.inlayWindows) {
            inlayRenderSignatures[inlay.id] = JSON.stringify(toInlayRenderComparable(inlay));
            styleDependencyInput.push([
                'inlay',
                inlay.id,
                inlay.scriptedImages.map(slot => slot.gfxOptions.map(option => [option.gfxFile, option.gfxName, option.condition])),
            ]);
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
