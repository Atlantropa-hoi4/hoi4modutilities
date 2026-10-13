import { HOIPartial } from "../../hoiformat/schema";
import { GridBoxType } from "../../hoiformat/gui";
import { isPerfTraceEnabled, recordPerf } from "../../util/perf";
import {
    createFocusTreeStyleTable,
    prepareDeferredFocusIconStyles,
    prepareFocusIconStyles,
    prepareFocusTreeBaseStateForRender,
    renderFocusCardTemplates,
    type FocusCardTemplates,
    type FocusTreeRenderBaseState,
    type FocusTreeRenderPayload,
} from "./contentbuilder";
import { Focus, FocusTree, FocusTreeInlay, FocusWarning } from "./schema";
import {
    focusTreeRenderCancellationBatchSize,
    throwIfFocusTreeRenderCancelled,
    yieldToFocusTreeRenderCancellation,
} from "./rendercancellation";
import { FocusTreeAssetMaterialization, FocusTreeContentSlot, FocusTreeContentUpdateMessage } from "./webviewupdate";
import {
    FocusRangeView,
    FocusTreeView,
    FocusTreeViewDelta,
    FocusTreeViewPatch,
    FocusView,
    toFocusTreeHeaderView,
    toFocusTreeViews,
} from './viewmodel';
import { createEmptyFocusIconAssetResolution } from './focusicongfx';

/**
 * Signatures used to plan incremental updates. Source ranges are excluded everywhere except the
 * ranges carried by tree deltas, so text inserted above a focus does not re-render it.
 */
export interface FocusTreeRenderMetadata {
    /** Tree-level view fields except warnings. */
    treeHeaderSignatures: Record<string, string>;
    /** Warnings without navigation offsets. */
    treeWarningSignatures: Record<string, string>;
    treeStructureSignatures: Record<string, string>;
    /** Per tree: focus view signatures without source ranges. */
    focusViewSignatures: Record<string, Record<string, string>>;
    focusRenderSignatures: Record<string, string>;
    inlayRenderSignatures: Record<string, string>;
    styleDependencySignature: string;
}

export interface FocusTreeRenderCache extends FocusTreeRenderMetadata {
    snapshotVersion: number;
    selectedTreeId?: string;
    assetTreeIds?: string[];
    /**
     * Focuses of the asset trees whose icon styles are real; the others use placeholders.
     * Undefined means every focus of the asset trees.
     */
    materializedFocusIds?: string[];
    focusTrees: FocusTreeView[];
    continuousFocusHtml?: string;
    focusTemplates: Record<string, string>;
    focusTemplateKeyById: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    focusIconGfxFileByName: Record<string, string>;
    focusIconStyleSignature: string;
    gridBox: HOIPartial<GridBoxType>;
    /**
     * Dynamic class rules of the loaded scenes. The session replaces them with its style ledger's
     * rules whenever it commits or posts, so they always state what the webview's stylesheet holds.
     */
    dynamicStyleRules: ReadonlyMap<string, string>;
    xGridSize: number;
    yGridSize: number;
    focusPositionDocumentVersion: number;
    focusPositionActiveFile: string;
    hasFocusSelector: boolean;
    hasWarningsButton: boolean;
    deferredAssetLoad: boolean;
    localisationIndexReady: boolean;
}

/** Views and signatures computed while planning, reused by a following full snapshot build. */
export interface FocusTreeRenderPreparation {
    views: FocusTreeView[];
    metadata: FocusTreeRenderMetadata;
}

export type FocusTreeRenderUpdatePlan =
    | { kind: 'full'; prepared: FocusTreeRenderPreparation }
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

interface RenderMetadataInputs {
    xGridSize: number;
    yGridSize: number;
    gfxFiles?: readonly string[];
    focusIconGfxFileByName?: Readonly<Record<string, string>>;
    focusIconStyleSignature?: string;
    assetTreeIds?: readonly string[];
}

export function createFocusTreeRenderCache(
    payload: FocusTreeRenderPayload,
    previousVersion: number = 0,
    metadata?: FocusTreeRenderMetadata,
): FocusTreeRenderCache {
    return {
        snapshotVersion: previousVersion + 1,
        selectedTreeId: payload.selectedTreeId ?? payload.focusTrees[0]?.id,
        assetTreeIds: payload.assetTreeIds,
        materializedFocusIds: payload.materializedFocusIds,
        focusTrees: payload.focusTrees,
        continuousFocusHtml: payload.continuousFocusHtml,
        focusTemplates: payload.focusTemplates ?? {},
        focusTemplateKeyById: payload.focusTemplateKeyById ?? {},
        renderedInlayWindows: payload.renderedInlayWindows,
        focusIconGfxFileByName: payload.focusIconGfxFileByName,
        focusIconStyleSignature: payload.focusIconStyleSignature ?? '',
        gridBox: payload.gridBox,
        dynamicStyleRules: payload.dynamicStyleRules ?? new Map(),
        xGridSize: payload.xGridSize,
        yGridSize: payload.yGridSize,
        focusPositionDocumentVersion: payload.focusPositionDocumentVersion,
        focusPositionActiveFile: payload.focusPositionActiveFile,
        hasFocusSelector: payload.hasFocusSelector,
        hasWarningsButton: payload.hasWarningsButton,
        deferredAssetLoad: payload.deferredAssetLoad,
        localisationIndexReady: payload.localisationIndexReady,
        ...(metadata ?? deriveRenderStateMetadata(
            payload.sourceFocusTrees ?? payload.focusTrees as unknown as FocusTree[],
            getPayloadSignatureViews(payload),
            payload,
        )),
    };
}

export function createFullFocusTreeRenderUpdate(
    payload: FocusTreeRenderPayload,
    previousCache?: FocusTreeRenderCache,
): { update: FocusTreeContentUpdateMessage; cache: FocusTreeRenderCache } {
    return createFullFocusTreeRenderUpdateWithMetadata(payload, previousCache);
}

export async function createFullFocusTreeRenderUpdateWithCancellation(
    payload: FocusTreeRenderPayload,
    previousCache: FocusTreeRenderCache | undefined,
    isCancelled?: () => boolean,
    preparedMetadata?: FocusTreeRenderMetadata,
): Promise<{ update: FocusTreeContentUpdateMessage; cache: FocusTreeRenderCache }> {
    throwIfFocusTreeRenderCancelled(isCancelled);
    const metadata = preparedMetadata ?? await deriveRenderStateMetadataWithCancellation(
        payload.sourceFocusTrees ?? payload.focusTrees as unknown as FocusTree[],
        getPayloadSignatureViews(payload),
        payload,
        isCancelled,
    );
    throwIfFocusTreeRenderCancelled(isCancelled);
    return createFullFocusTreeRenderUpdateWithMetadata(payload, previousCache, metadata);
}

function createFullFocusTreeRenderUpdateWithMetadata(
    payload: FocusTreeRenderPayload,
    previousCache?: FocusTreeRenderCache,
    metadata?: FocusTreeRenderMetadata,
): { update: FocusTreeContentUpdateMessage; cache: FocusTreeRenderCache } {
    const cache = createFocusTreeRenderCache(payload, previousCache?.snapshotVersion, metadata);
    const isInPlacePresentationUpdate = !!previousCache
        && hasSameTreeStructure(previousCache, cache)
        && hasSameLayout(previousCache, cache);
    const changedFocusIds = payload.focusTrees.flatMap(tree => Object.keys(tree.focuses));
    recordFocusTreePayloadSize('full', payload.deferredAssetLoad, {
        focusTrees: payload.focusTrees,
        continuousFocusHtml: payload.continuousFocusHtml,
        focusTemplates: [payload.focusTemplates, payload.focusTemplateKeyById],
        renderedInlayWindows: payload.renderedInlayWindows,
        styleRules: payload.dynamicStyleRules ?? [],
        focusCount: Object.keys(payload.focusTemplateKeyById).length,
        inlayCount: Object.keys(payload.renderedInlayWindows).length,
    });
    if (previousCache && isInPlacePresentationUpdate) {
        // The webview keeps its scene; only changed tree data and presentation are sent. The
        // session posts the payload's style rules as a delta on the webview's stylesheet.
        const focusTreePatches = createFocusTreeViewPatches(previousCache, cache);
        return {
            cache,
            update: {
                updateType: 'assets',
                snapshotVersion: cache.snapshotVersion,
                baseSnapshotVersion: previousCache.snapshotVersion,
                documentVersion: payload.focusPositionDocumentVersion,
                focusPositionActiveFile: payload.focusPositionActiveFile,
                selectedTreeId: cache.selectedTreeId,
                changedSlots: ['treeDefinitions', 'warnings', 'treeBody', 'inlays', 'styleDeps'],
                changedTreeIds: focusTreePatches.map(patch => patch.treeId),
                changedFocusIds,
                changedInlayWindowIds: Object.keys(payload.renderedInlayWindows),
                focusTreePatches,
                continuousFocusHtml: payload.continuousFocusHtml,
                focusTemplates: payload.focusTemplates,
                focusTemplateKeyById: payload.focusTemplateKeyById,
                renderedInlayWindows: payload.renderedInlayWindows,
                assetMaterialization: getFocusTreeAssetMaterialization(cache),
            },
        };
    }

    return {
        cache,
        update: {
            updateType: 'structure',
            snapshotVersion: cache.snapshotVersion,
            documentVersion: payload.focusPositionDocumentVersion,
            focusPositionActiveFile: payload.focusPositionActiveFile,
            selectedTreeId: cache.selectedTreeId,
            changedSlots: fullRenderChangedSlots,
            changedTreeIds: payload.focusTrees.map(tree => tree.id),
            structurallyChangedTreeIds: payload.focusTrees.map(tree => tree.id),
            changedFocusIds,
            changedInlayWindowIds: Object.keys(payload.renderedInlayWindows),
            focusTrees: payload.focusTrees,
            continuousFocusHtml: payload.continuousFocusHtml,
            focusTemplates: payload.focusTemplates,
            focusTemplateKeyById: payload.focusTemplateKeyById,
            renderedInlayWindows: payload.renderedInlayWindows,
            gridBox: payload.gridBox,
            xGridSize: payload.xGridSize,
            yGridSize: payload.yGridSize,
            assetMaterialization: getFocusTreeAssetMaterialization(cache),
        },
    };
}

/** The materialized focus set a webview receives with a scene or full asset update. */
export function getFocusTreeAssetMaterialization(
    cache: Pick<FocusTreeRenderCache, 'deferredAssetLoad' | 'materializedFocusIds'>,
): FocusTreeAssetMaterialization {
    return cache.deferredAssetLoad
        ? { deferred: true, focusIds: [] }
        : { deferred: false, focusIds: cache.materializedFocusIds && [...cache.materializedFocusIds] };
}

export async function createFocusTreeRenderUpdate(
    previous: FocusTreeRenderCache | undefined,
    nextBaseState: FocusTreeRenderBaseState,
    isCancelled?: () => boolean,
): Promise<FocusTreeRenderUpdatePlan> {
    const focusDisplayNameById = await prepareFocusTreeBaseStateForRender(nextBaseState, isCancelled);
    const nextViews = toFocusTreeViews(nextBaseState.focusTrees, focusDisplayNameById);
    const nextMetadata = await deriveRenderStateMetadataWithCancellation(
        nextBaseState.focusTrees,
        nextViews,
        nextBaseState,
        isCancelled,
    );

    if (!previous || shouldUseFullRender(previous, nextBaseState)) {
        throwIfFocusTreeRenderCancelled(isCancelled);
        return { kind: 'full', prepared: { views: nextViews, metadata: nextMetadata } };
    }

    const focusSignatureDiff = diffSignatureMap(previous.focusRenderSignatures, nextMetadata.focusRenderSignatures);
    const inlaySignatureDiff = diffSignatureMap(previous.inlayRenderSignatures, nextMetadata.inlayRenderSignatures);
    throwIfFocusTreeRenderCancelled(isCancelled);
    if (inlaySignatureDiff.changedKeys.length > 0 || inlaySignatureDiff.removedKeys.length > 0) {
        return { kind: 'full', prepared: { views: nextViews, metadata: nextMetadata } };
    }

    const styleDependencyChanged = previous.styleDependencySignature !== nextMetadata.styleDependencySignature;
    if (styleDependencyChanged && focusSignatureDiff.changedKeys.length === 0) {
        return { kind: 'full', prepared: { views: nextViews, metadata: nextMetadata } };
    }

    const nextFocusTrees = nextViews;
    const focusTreePatches = createFocusTreeViewPatches(previous, { focusTrees: nextFocusTrees, ...nextMetadata });
    const changedTreeIds = focusTreePatches.map(patch => patch.treeId);
    const structurallyChangedTreeIds = changedTreeIds
        .filter(treeId => previous.treeStructureSignatures[treeId] !== nextMetadata.treeStructureSignatures[treeId]);
    const materializedFocusIds = previous.deferredAssetLoad
        ? new Set<string>()
        : previous.materializedFocusIds && new Set(previous.materializedFocusIds);
    const presentationPatch = await renderChangedFocusPresentation(
        nextBaseState,
        focusSignatureDiff.changedKeys,
        styleDependencyChanged,
        previous.dynamicStyleRules,
        isCancelled,
        materializedFocusIds,
    );
    const focusTemplatePatch = Object.fromEntries(Object.entries(presentationPatch.templates)
        .filter(([key]) => !(key in previous.focusTemplates)));
    const focusTemplateKeyPatch = presentationPatch.keyById;

    const changedSlots = new Set<FocusTreeContentSlot>();
    if (changedTreeIds.length > 0) {
        changedSlots.add('treeDefinitions');
        changedSlots.add('selector');
        changedSlots.add('warnings');
    }
    if (focusSignatureDiff.changedKeys.length > 0 || focusSignatureDiff.removedKeys.length > 0) {
        changedSlots.add('treeBody');
    }
    if (presentationPatch.newStyleRules.length > 0) {
        changedSlots.add('styleDeps');
    }
    const cache: FocusTreeRenderCache = {
        snapshotVersion: previous.snapshotVersion + 1,
        selectedTreeId: nextBaseState.assetTreeIds?.[0] ?? nextBaseState.focusTrees[0]?.id,
        assetTreeIds: nextBaseState.assetTreeIds,
        materializedFocusIds: previous.materializedFocusIds?.filter(focusId => !!nextBaseState.focusById[focusId]),
        focusTrees: nextFocusTrees,
        focusTemplates: { ...previous.focusTemplates, ...focusTemplatePatch },
        focusTemplateKeyById: mergeStringMap(previous.focusTemplateKeyById, focusTemplateKeyPatch, focusSignatureDiff.removedKeys),
        continuousFocusHtml: previous.continuousFocusHtml,
        renderedInlayWindows: previous.renderedInlayWindows,
        focusIconGfxFileByName: nextBaseState.focusIconGfxFileByName,
        focusIconStyleSignature: nextBaseState.focusIconStyleSignature ?? '',
        gridBox: nextBaseState.gridBox,
        dynamicStyleRules: presentationPatch.dynamicStyleRules,
        xGridSize: nextBaseState.xGridSize,
        yGridSize: nextBaseState.yGridSize,
        focusPositionDocumentVersion: nextBaseState.focusPositionDocumentVersion,
        focusPositionActiveFile: nextBaseState.focusPositionActiveFile,
        hasFocusSelector: nextBaseState.hasFocusSelector,
        hasWarningsButton: nextBaseState.hasWarningsButton,
        deferredAssetLoad: nextBaseState.deferredAssetLoad,
        localisationIndexReady: nextBaseState.localisationIndexReady,
        ...nextMetadata,
    };
    recordFocusTreePayloadSize('partial', nextBaseState.deferredAssetLoad, {
        focusTrees: focusTreePatches,
        focusTemplates: [focusTemplatePatch, focusTemplateKeyPatch],
        renderedInlayWindows: {},
        styleRules: presentationPatch.newStyleRules,
        focusCount: focusSignatureDiff.changedKeys.length,
        inlayCount: 0,
    });
    throwIfFocusTreeRenderCancelled(isCancelled);

    return {
        kind: 'partial',
        update: {
            updateType: 'patch',
            snapshotVersion: cache.snapshotVersion,
            baseSnapshotVersion: previous.snapshotVersion,
            documentVersion: nextBaseState.focusPositionDocumentVersion,
            focusPositionActiveFile: nextBaseState.focusPositionActiveFile,
            selectedTreeId: cache.selectedTreeId,
            changedSlots: Array.from(changedSlots),
            changedTreeIds: changedTreeIds.length > 0 ? changedTreeIds : undefined,
            structurallyChangedTreeIds: structurallyChangedTreeIds.length > 0 ? structurallyChangedTreeIds : undefined,
            changedFocusIds: focusSignatureDiff.changedKeys.length > 0 ? focusSignatureDiff.changedKeys : undefined,
            focusTreePatches: focusTreePatches.length > 0 ? focusTreePatches : undefined,
            focusTemplatePatch: Object.keys(focusTemplatePatch).length > 0 ? focusTemplatePatch : undefined,
            focusTemplateKeyPatch: Object.keys(focusTemplateKeyPatch).length > 0 ? focusTemplateKeyPatch : undefined,
            removedFocusTemplateKeyIds: focusSignatureDiff.removedKeys.length > 0 ? focusSignatureDiff.removedKeys : undefined,
        },
        cache,
        changedTreeCount: changedTreeIds.length,
        changedFocusCount: focusSignatureDiff.changedKeys.length + focusSignatureDiff.removedKeys.length,
        changedInlayCount: 0,
    };
}

/**
 * Describes how each tree view changed. Trees with the same focus ids in the same order receive
 * deltas; added, removed, or reordered focuses replace the whole tree view.
 */
type FocusTreeViewPatchSource = Pick<FocusTreeRenderCache,
    'focusTrees' | 'treeHeaderSignatures' | 'treeWarningSignatures' | 'focusViewSignatures'>;

function createFocusTreeViewPatches(
    previous: FocusTreeViewPatchSource,
    next: FocusTreeViewPatchSource,
): FocusTreeViewPatch[] {
    const previousTreeById = new Map(previous.focusTrees.map(tree => [tree.id, tree]));
    const patches: FocusTreeViewPatch[] = [];
    for (const nextTree of next.focusTrees) {
        const previousTree = previousTreeById.get(nextTree.id);
        const previousFocusSignatures = previous.focusViewSignatures[nextTree.id];
        const nextFocusSignatures = next.focusViewSignatures[nextTree.id];
        if (!previousTree || !previousFocusSignatures || !nextFocusSignatures
            || !haveSameKeyOrder(previousTree.focuses, nextTree.focuses)) {
            patches.push({ treeId: nextTree.id, tree: nextTree });
            continue;
        }

        const delta: FocusTreeViewDelta = {};
        if (previous.treeHeaderSignatures[nextTree.id] !== next.treeHeaderSignatures[nextTree.id]) {
            const { warnings: _warnings, ...header } = toFocusTreeHeaderView(nextTree);
            delta.header = header;
        }
        if (previous.treeWarningSignatures[nextTree.id] !== next.treeWarningSignatures[nextTree.id]) {
            delta.warnings = nextTree.warnings;
        } else if (haveWarningRangesChanged(previousTree.warnings, nextTree.warnings)) {
            delta.warningRanges = nextTree.warnings.map(warning =>
                (warning.navigations ?? []).map(navigation => [navigation.start, navigation.end] as [number, number]));
        }
        for (const [focusId, focus] of Object.entries(nextTree.focuses)) {
            if (previousFocusSignatures[focusId] !== nextFocusSignatures[focusId]) {
                (delta.focuses ??= {})[focusId] = focus;
                continue;
            }
            const previousFocus = previousTree.focuses[focusId];
            if (previousFocus.start !== focus.start || previousFocus.end !== focus.end) {
                (delta.ranges ??= {})[focusId] = toFocusRangeView(focus);
            }
        }
        if (delta.header || delta.warnings || delta.warningRanges || delta.focuses || delta.ranges) {
            patches.push({ treeId: nextTree.id, delta });
        }
    }
    return patches;
}

function haveWarningRangesChanged(previous: readonly FocusWarning[], next: readonly FocusWarning[]): boolean {
    if (previous.length !== next.length) {
        return true;
    }
    for (let index = 0; index < next.length; index++) {
        const previousNavigations = previous[index].navigations ?? [];
        const nextNavigations = next[index].navigations ?? [];
        if (previousNavigations.length !== nextNavigations.length) {
            return true;
        }
        for (let navigationIndex = 0; navigationIndex < nextNavigations.length; navigationIndex++) {
            if (previousNavigations[navigationIndex].start !== nextNavigations[navigationIndex].start
                || previousNavigations[navigationIndex].end !== nextNavigations[navigationIndex].end) {
                return true;
            }
        }
    }
    return false;
}

function toFocusRangeView(focus: FocusView): FocusRangeView {
    return [focus.start ?? null, focus.end ?? null];
}

function haveSameKeyOrder(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (let index = 0; index < leftKeys.length; index++) {
        if (leftKeys[index] !== rightKeys[index]) {
            return false;
        }
    }
    return true;
}

function hasSameTreeStructure(previous: FocusTreeRenderCache, next: FocusTreeRenderCache): boolean {
    if (previous.focusTrees.length !== next.focusTrees.length) {
        return false;
    }

    return next.focusTrees.every((tree, index) =>
        previous.focusTrees[index]?.id === tree.id
        && previous.treeStructureSignatures[tree.id] === next.treeStructureSignatures[tree.id]);
}

function hasSameLayout(previous: FocusTreeRenderCache, next: FocusTreeRenderCache): boolean {
    return previous.xGridSize === next.xGridSize
        && previous.yGridSize === next.yGridSize
        && JSON.stringify(previous.gridBox) === JSON.stringify(next.gridBox);
}

function recordFocusTreePayloadSize(
    kind: 'full' | 'partial',
    deferredAssetLoad: boolean,
    payload: {
        focusTrees: unknown;
        focusTemplates: unknown;
        continuousFocusHtml?: string;
        renderedInlayWindows: unknown;
        styleRules: Iterable<readonly [key: string, content: string]>;
        focusCount: number;
        inlayCount: number;
    },
): void {
    if (!isPerfTraceEnabled()) {
        return;
    }
    let dynamicStyleChars = 0;
    for (const [key, content] of payload.styleRules) {
        dynamicStyleChars += key.length + content.length;
    }
    recordPerf('focustree.payloadSize', 0, {
        kind,
        deferredAssetLoad,
        focusTreeBytes: approximateJsonByteLength(payload.focusTrees),
        focusTemplateBytes: approximateJsonByteLength(payload.focusTemplates),
        renderedInlayBytes: approximateJsonByteLength(payload.renderedInlayWindows),
        dynamicStyleChars,
        focusCount: payload.focusCount,
        inlayCount: payload.inlayCount,
    });
}

function approximateJsonByteLength(value: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
        return 0;
    }
}

function shouldUseFullRender(
    previous: FocusTreeRenderCache,
    nextBaseState: FocusTreeRenderBaseState,
): boolean {
    if (previous.focusTrees.length !== nextBaseState.focusTrees.length
        || previous.hasFocusSelector !== nextBaseState.hasFocusSelector
        || previous.hasWarningsButton !== nextBaseState.hasWarningsButton
        || previous.deferredAssetLoad !== nextBaseState.deferredAssetLoad
        || previous.localisationIndexReady !== nextBaseState.localisationIndexReady
        || JSON.stringify(previous.assetTreeIds) !== JSON.stringify(nextBaseState.assetTreeIds)
        || previous.focusIconStyleSignature !== (nextBaseState.focusIconStyleSignature ?? '')
        || previous.xGridSize !== nextBaseState.xGridSize
        || previous.yGridSize !== nextBaseState.yGridSize
        || previous.focusPositionActiveFile !== nextBaseState.focusPositionActiveFile
        || JSON.stringify(previous.gridBox) !== JSON.stringify(nextBaseState.gridBox)) {
        return true;
    }

    for (let index = 0; index < nextBaseState.focusTrees.length; index += 1) {
        if (previous.focusTrees[index]?.id !== nextBaseState.focusTrees[index]?.id) {
            return true;
        }
    }

    return false;
}

/** Payload views; payloads built without source trees carry source-shaped trees instead. */
function getPayloadSignatureViews(payload: FocusTreeRenderPayload): FocusTreeView[] {
    return payload.sourceFocusTrees
        ? payload.focusTrees
        : toFocusTreeViews(payload.focusTrees as unknown as FocusTree[]);
}

/** Accumulates every signature in one pass over trees, focuses, and inlays. */
class RenderMetadataBuilder {
    public readonly metadata: FocusTreeRenderMetadata = {
        treeHeaderSignatures: {},
        treeWarningSignatures: {},
        treeStructureSignatures: {},
        focusViewSignatures: {},
        focusRenderSignatures: {},
        inlayRenderSignatures: {},
        styleDependencySignature: '',
    };
    private readonly styleDependencyParts: string[];
    private structureParts: string[] = [];

    private renderTree = true;
    constructor(private readonly inputs: RenderMetadataInputs) {
        this.styleDependencyParts = [JSON.stringify([
            inputs.xGridSize,
            inputs.yGridSize,
            [...inputs.gfxFiles ?? []].sort(),
            Object.entries(inputs.focusIconGfxFileByName ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
            inputs.focusIconStyleSignature ?? '',
        ])];
    }

    public beginTree(tree: FocusTree, view: FocusTreeView | undefined): void {
        this.renderTree = !this.inputs.assetTreeIds || this.inputs.assetTreeIds.includes(tree.id);
        const header = view ?? toFocusTreeViews([tree])[0];
        const { warnings, ...headerWithoutWarnings } = toFocusTreeHeaderView(header);
        this.metadata.treeHeaderSignatures[tree.id] = JSON.stringify(headerWithoutWarnings);
        this.metadata.treeWarningSignatures[tree.id] = JSON.stringify(warnings.map(warning => ({
            ...warning,
            navigations: warning.navigations?.map(navigation => navigation.file),
        })));
        this.metadata.focusViewSignatures[tree.id] = {};
        this.structureParts = [JSON.stringify([
            header.id,
            header.kind,
            header.allowBranchOptions,
            header.conditionExprs,
            header.isSharedFocues,
            header.continuousFocusPositionX,
            header.continuousFocusPositionY,
            header.createTemplate,
            header.continuousLayout,
        ])];
    }

    public addFocus(treeId: string, focus: Focus, view: FocusView | undefined): void {
        if (this.renderTree) {
            const iconSignature = JSON.stringify([focus.icon, focus.overlay]);
            this.styleDependencyParts.push(`${focus.id}\u0002${iconSignature}`);
            this.metadata.focusRenderSignatures[focus.id] = `${iconSignature}\u0001${JSON.stringify([
                focus.file,
                focus.isInCurrentFile,
                focus.text,
                focus.textIcon,
                focus.layout?.editable,
                focus.layout?.sourceFile,
                view?.displayName,
            ])}`;
        }
        this.structureParts.push(JSON.stringify([
            focus.id,
            focus.x,
            focus.y,
            focus.prerequisite,
            focus.exclusive,
            focus.inAllowBranch,
            focus.allowBranch,
            focus.relativePositionId,
            focus.offset,
        ]));
        this.metadata.focusViewSignatures[treeId][focus.id] = view ? getFocusViewSignature(view) : '';
    }

    public endTree(treeId: string): void {
        this.metadata.treeStructureSignatures[treeId] = this.structureParts.join('\u0001');
        this.structureParts = [];
    }

    public addInlay(inlay: FocusTreeInlay): void {
        if (!this.renderTree) { return; }
        this.metadata.inlayRenderSignatures[inlay.id] = JSON.stringify(toInlayRenderComparable(inlay));
        this.styleDependencyParts.push(`${inlay.id}\u0003${JSON.stringify(
            inlay.scriptedImages.map(slot => slot.gfxOptions.map(option => [option.gfxFile, option.gfxName, option.condition])),
        )}`);
    }

    public finish(): FocusTreeRenderMetadata {
        this.metadata.styleDependencySignature = this.styleDependencyParts.join('\u0001');
        return this.metadata;
    }
}

function deriveRenderStateMetadata(
    focusTrees: readonly FocusTree[],
    views: readonly FocusTreeView[],
    inputs: RenderMetadataInputs,
): FocusTreeRenderMetadata {
    const builder = new RenderMetadataBuilder(inputs);
    focusTrees.forEach((tree, treeIndex) => {
        const view = views[treeIndex];
        builder.beginTree(tree, view);
        for (const focus of Object.values(tree.focuses)) {
            builder.addFocus(tree.id, focus, view?.focuses[focus.id]);
        }
        builder.endTree(tree.id);
        tree.inlayWindows.forEach(inlay => builder.addInlay(inlay));
    });
    return builder.finish();
}

async function deriveRenderStateMetadataWithCancellation(
    focusTrees: readonly FocusTree[],
    views: readonly FocusTreeView[],
    inputs: RenderMetadataInputs,
    isCancelled?: () => boolean,
): Promise<FocusTreeRenderMetadata> {
    throwIfFocusTreeRenderCancelled(isCancelled);
    const builder = new RenderMetadataBuilder(inputs);
    let processedItemCount = 0;
    const checkpoint = async () => {
        if (processedItemCount > 0 && processedItemCount % focusTreeRenderCancellationBatchSize === 0) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        }
        processedItemCount += 1;
    };
    for (let treeIndex = 0; treeIndex < focusTrees.length; treeIndex++) {
        const tree = focusTrees[treeIndex];
        const view = views[treeIndex];
        builder.beginTree(tree, view);
        for (const focus of Object.values(tree.focuses)) {
            await checkpoint();
            builder.addFocus(tree.id, focus, view?.focuses[focus.id]);
        }
        builder.endTree(tree.id);
        for (const inlay of tree.inlayWindows) {
            await checkpoint();
            builder.addInlay(inlay);
        }
    }
    throwIfFocusTreeRenderCancelled(isCancelled);
    return builder.finish();
}

function getFocusViewSignature(view: FocusView): string {
    const { start: _start, end: _end, ...rest } = view;
    return JSON.stringify(rest);
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

/**
 * Renders templates and, when icon dependencies changed, icon styles of the changed focuses.
 * Only materialized focuses decode real icons; the others receive placeholders for icon names
 * without any rule yet, so a placeholder never overrides a real icon the webview already has.
 */
async function renderChangedFocusPresentation(
    baseState: FocusTreeRenderBaseState,
    focusIds: readonly string[],
    includeAssetStyles: boolean,
    existingStyleRules: ReadonlyMap<string, string>,
    isCancelled?: () => boolean,
    materializedFocusIds?: ReadonlySet<string>,
): Promise<FocusCardTemplates & {
    /** Rules the existing ones lack or define differently. */
    newStyleRules: Array<[key: string, content: string]>;
    dynamicStyleRules: ReadonlyMap<string, string>;
}> {
    const styleTable = createFocusTreeStyleTable();
    const focuses = focusIds
        .map(focusId => baseState.focusById[focusId])
        .filter((focus): focus is Focus => !!focus);
    if (includeAssetStyles && focuses.length > 0) {
        const realFocuses = materializedFocusIds ? focuses.filter(focus => materializedFocusIds.has(focus.id)) : focuses;
        const placeholderFocuses = materializedFocusIds ? focuses.filter(focus => !materializedFocusIds.has(focus.id)) : [];
        if (realFocuses.length > 0) {
            await prepareFocusIconStyles(
                realFocuses,
                styleTable,
                baseState.focusIconAssetResolution ?? createEmptyFocusIconAssetResolution(),
                baseState.xGridSize,
                baseState.yGridSize,
                isCancelled,
                !!baseState.presentation?.item,
            );
        }
        if (placeholderFocuses.length > 0) {
            await prepareDeferredFocusIconStyles(
                placeholderFocuses,
                styleTable,
                baseState.xGridSize,
                baseState.yGridSize,
                isCancelled,
                key => existingStyleRules.has(key),
            );
        }
    }
    const cardTemplates = await renderFocusCardTemplates(baseState, focuses, styleTable, isCancelled);

    throwIfFocusTreeRenderCancelled(isCancelled);
    // Content-addressed class names let patches reuse rules the webview already has.
    const newStyleRules = styleTable.rules().filter(([key, content]) => existingStyleRules.get(key) !== content);
    if (newStyleRules.length === 0) {
        return { ...cardTemplates, newStyleRules, dynamicStyleRules: existingStyleRules };
    }
    const dynamicStyleRules = new Map(existingStyleRules);
    newStyleRules.forEach(([key, content]) => dynamicStyleRules.set(key, content));
    return { ...cardTemplates, newStyleRules, dynamicStyleRules };
}
