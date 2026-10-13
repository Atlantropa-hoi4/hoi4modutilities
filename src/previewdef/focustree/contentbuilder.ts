import * as vscode from 'vscode';
import { FocusTree, Focus } from './schema';
import type { FocusWarning } from './schema';
import { getSpriteByGfxNameFromResolvedFiles, Image, getImageByPath } from '../../util/image/imagecache';
import { localize, i18nTableAsScript } from '../../util/i18n';
import { GridBoxType, ButtonType, IconType } from '../../hoiformat/gui';
import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { html, htmlEscape } from '../../util/html';
import { htmlAttributeEscape } from '../../util/htmlescape';
import { FocusTreeLoader } from './loader';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { StyleTable, hashStyleContent, normalizeForStyle } from '../../util/styletable';
import { featureFlagsAsScript, isLocalisationIndexEnabled, isUseConditionInFocusEnabled } from '../../util/featureflags';
import { ParentInfo, calculateBBox } from '../../util/hoi4gui/common';
import { RenderChildTypeMap, renderContainerWindow } from '../../util/hoi4gui/containerwindow';
import { renderInstantTextBox } from '../../util/hoi4gui/instanttextbox';
import { fitFocusIconToBounds } from './focusiconlayout';
import { FocusConditionPresetsByTree } from './conditionpresets';
import { createEmptyFocusIconAssetResolution, FocusIconAssetResolution } from './focusicongfx';
import {
    ensureFocusTemplateStyles,
    focusDefaultPlaceholderSize,
    focusIconBottomGap,
    focusIconSidePadding,
    focusIconTopOffset,
    focusTextMarginTop,
    renderFocusCardTemplate,
    resolveFocusLocalizationTextByIdIfReady,
} from './focusrender';
import { sortFocusWarnings } from './focuslint';
import { createLocalisedTextQuickIfReadyResolver, isLocalisationIndexReady } from '../../util/localisationIndex';
import {
    focusTreeRenderCancellationBatchSize,
    throwIfFocusTreeRenderCancelled,
    yieldToFocusTreeRenderCancellation,
} from './rendercancellation';
import { FocusTreeView, toFocusTreeViews } from './viewmodel';
import { focusIconStateProperty, type FocusIconRenderState } from './webviewupdate';

import { FocusGuiRenderer, FocusPresentation, renderContinuousFocusGui } from './presentation';

const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';
const focusToolbarHeight = 68;
const focusTreeAssetRenderBatchSize = 32;

export interface FocusTreeAssetStyleBatch {
    batchIndex: number;
    /** Class rules of the batch's icons, keyed like the payload's dynamic style rules. */
    rules: Array<[key: string, content: string]>;
    assetNames: string[];
}

export type FocusTreeAssetStyleBatchHandler = (batch: FocusTreeAssetStyleBatch) => void | Promise<void>;

export interface FocusTreeRenderPayload {
    focusTrees: FocusTreeView[];
    /** Host-only source used to calculate patch signatures. Never sent to the webview. */
    sourceFocusTrees: FocusTree[];
    selectedTreeId?: string;
    /** Host-only asset scope; omitted by unscoped callers. */
    assetTreeIds?: string[];
    /**
     * Focuses of the asset trees rendered with real icon assets; the others use placeholders.
     * Undefined means every focus of the asset trees.
     */
    materializedFocusIds?: string[];
    continuousFocusHtml?: string;
    /** GUI card templates by content key; see `fillFocusCardTemplate`. */
    focusTemplates: Record<string, string>;
    /** Card template key per focus. Focuses without one use the webview's standard card. */
    focusTemplateKeyById: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    gfxFiles: string[];
    focusIconGfxFileByName: Record<string, string>;
    focusIconAssetResolution: FocusIconAssetResolution;
    focusIconStyleSignature: string;
    gridBox: HOIPartial<GridBoxType>;
    /** The whole dynamic stylesheet, for markup that embeds it. */
    dynamicStyleCss: string;
    /** Host-only class rules of `dynamicStyleCss`; the session posts them as style syncs. */
    dynamicStyleRules?: ReadonlyMap<string, string>;
    /** Host-only raw records of `dynamicStyleCss`, such as the continuous focus GUI's size. */
    dynamicStyleRawCss?: string;
    styleNonce: string;
    xGridSize: number;
    yGridSize: number;
    focusToolbarHeight: number;
    focusPositionDocumentVersion: number;
    focusPositionActiveFile: string;
    conditionPresetsByTree: FocusConditionPresetsByTree;
    hasFocusSelector: boolean;
    hasWarningsButton: boolean;
    deferredAssetLoad: boolean;
    localisationIndexReady: boolean;
}

export interface FocusTreeRenderBaseState {
    presentation?: FocusPresentation;
    focusTrees: FocusTree[];
    assetTreeIds?: string[];
    allFocuses: Focus[];
    allInlays: FocusTree["inlayWindows"][number][];
    focusById: Record<string, Focus>;
    focusDisplayNameById?: Record<string, string>;
    gfxFiles: string[];
    focusIconGfxFileByName: Record<string, string>;
    focusIconAssetResolution: FocusIconAssetResolution;
    focusIconStyleSignature: string;
    gridBox: HOIPartial<GridBoxType>;
    xGridSize: number;
    yGridSize: number;
    focusPositionDocumentVersion: number;
    focusPositionActiveFile: string;
    conditionPresetsByTree: FocusConditionPresetsByTree;
    hasFocusSelector: boolean;
    hasWarningsButton: boolean;
    loadDurationMs: number;
    deferredAssetLoad: boolean;
    localisationIndexReady: boolean;
}

export interface FocusTreeRenderPayloadBuildMetrics {
    loadDurationMs: number;
    focusIconStyleDurationMs: number;
    localisationResolveDurationMs: number;
    focusTemplateRenderDurationMs: number;
    focusRenderDurationMs: number;
    inlayStyleDurationMs: number;
    inlayRenderDurationMs: number;
    focusCount: number;
    inlayCount: number;
    deferredAssetLoad: boolean;
    renderedFocusCount?: number;
    renderedInlayCount?: number;
    /** Focuses whose icons were decoded; the rest of `renderedFocusCount` uses placeholders. */
    materializedFocusCount?: number;
}

export function renderFocusTreeShellHtml(
    uri: vscode.Uri,
    webview: vscode.Webview,
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree = {},
): string {
    const payload = createEmptyFocusTreeRenderPayload(documentVersion, conditionPresetsByTree);
    return renderFocusTreeHtmlFromPayload(uri, webview, payload);
}

export function renderFocusTreeHtmlFromPayload(
    uri: vscode.Uri,
    webview: vscode.Webview,
    payload: FocusTreeRenderPayload,
): string {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
    const scripts = buildFocusTreeBootstrapScripts(payload);
    scripts.push(i18nTableAsScript());
    scripts.push(featureFlagsAsScript());
    return html(
        webview,
        renderFocusTreeBody(payload),
        [
            setPreviewFileUriScript,
            ...scripts.map(c => ({ content: c })),
            'focustree.js',
        ],
        [
            'codicon.css',
            'common.css',
            { nonce: payload.styleNonce },
        ],
    );
}

const leftPaddingBase = 50;
const topPaddingBase = 50;
const defaultXGridSize = 96;
const defaultYGridSize = 130;

export function createFocusTreeStyleTable(): StyleTable {
    return new StyleTable({ contentAddressedOneTimeStyles: true });
}

export async function buildFocusTreeRenderBaseState(
    loader: FocusTreeLoader,
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree = {},
    isCancelled?: () => boolean,
): Promise<FocusTreeRenderBaseState> {
    const session = new LoaderSession(false, isCancelled);
    const loadStart = Date.now();
    const loadResult = await loader.load(session);
    session.throwIfCancelled();
    const loadDurationMs = Date.now() - loadStart;
    debug('Loader session focus tree', session.getLoadedLoaderNames());

    const focusTrees = loadResult.result.focusTrees;
    resolveSearchFilterLabels(focusTrees);
    const xGridSize = normalizeFocusSpacingValue(loadResult.result.focusSpacing?.x, defaultXGridSize);
    const yGridSize = normalizeFocusSpacingValue(loadResult.result.focusSpacing?.y, defaultYGridSize);
    const gridBox: HOIPartial<GridBoxType> = {
        position: { x: toNumberLike(leftPaddingBase), y: toNumberLike(topPaddingBase) },
        format: toStringAsSymbolIgnoreCase('up'),
        size: { width: toNumberLike(xGridSize), height: undefined },
        slotsize: { width: toNumberLike(xGridSize), height: toNumberLike(yGridSize) },
    } as HOIPartial<GridBoxType>;

    const allFocuses: Focus[] = [];
    const allInlays: FocusTree["inlayWindows"][number][] = [];
    const focusById: Record<string, Focus> = {};
    for (const tree of focusTrees) {
        const treeFocuses = Object.values(tree.focuses);
        treeFocuses.forEach(focus => {
            focusById[focus.id] = focus;
        });
        allFocuses.push(...treeFocuses);
        allInlays.push(...tree.inlayWindows);
    }

    return {
        focusTrees,
        assetTreeIds: loadResult.result.assetTreeIds,
        allFocuses,
        allInlays,
        focusById,
        gfxFiles: loadResult.result.gfxFiles,
        focusIconGfxFileByName: loadResult.result.focusIconGfxFileByName,
        focusIconAssetResolution: loadResult.result.focusIconAssetResolution,
        presentation: loadResult.result.presentation,
        focusIconStyleSignature: loadResult.result.focusIconAssetResolution.styleSignature + JSON.stringify(loadResult.result.presentation ?? null),
        gridBox,
        xGridSize,
        yGridSize,
        focusPositionDocumentVersion: documentVersion,
        focusPositionActiveFile: loader.file,
        conditionPresetsByTree,
        hasFocusSelector: focusTrees.length > 1,
        hasWarningsButton: !focusTrees.every(ft => ft.warnings.length === 0),
        loadDurationMs,
        deferredAssetLoad: !!loadResult.result.deferredAssetLoad,
        localisationIndexReady: isLocalisationIndexReady(),
    };
}

/**
 * Resolves data shared by full snapshots and patches: search filter labels, ready localisation,
 * and warnings derived from localisation. Repeated calls reuse resolved display names.
 */
export async function prepareFocusTreeBaseStateForRender(
    baseState: FocusTreeRenderBaseState,
    isCancelled?: () => boolean,
): Promise<Record<string, string>> {
    throwIfFocusTreeRenderCancelled(isCancelled);
    resolveSearchFilterLabels(baseState.focusTrees);
    const focusDisplayNameById = baseState.focusDisplayNameById
        ?? await resolveFocusLocalizationTextByIdIfReady(baseState.allFocuses, undefined, isCancelled);
    baseState.focusDisplayNameById = focusDisplayNameById;
    refreshUnsupportedLocalisationWarnings(baseState.focusTrees, focusDisplayNameById);
    baseState.hasWarningsButton = hasFocusTreeWarnings(baseState.focusTrees);
    throwIfFocusTreeRenderCancelled(isCancelled);
    return focusDisplayNameById;
}

/**
 * Builds a full payload. `materializedFocusIds` limits icon decoding to those focuses of the
 * asset trees, in the given order; every other focus keeps its template and gets a placeholder
 * icon style, so the scene stays complete while unseen icons are not decoded.
 *
 * `existingStyleRules` are the rules of loaded scenes this payload is merged into. Icon rules are
 * keyed by asset name, which focuses of different trees share, so placeholders are registered
 * only for names without a rule there and never replace an icon another scene materialized.
 */
export async function buildFocusTreeRenderPayloadFromBaseState(
    baseState: FocusTreeRenderBaseState,
    isCancelled?: () => boolean,
    onAssetStyleBatch?: FocusTreeAssetStyleBatchHandler,
    preparedViews?: FocusTreeView[],
    materializedFocusIds?: readonly string[],
    existingStyleRules?: ReadonlyMap<string, string>,
): Promise<{ payload: FocusTreeRenderPayload; metrics: FocusTreeRenderPayloadBuildMetrics }> {
    const localisationResolveStart = Date.now();
    const focusLocalizationTextById = await prepareFocusTreeBaseStateForRender(baseState, isCancelled);
    const localisationResolveDurationMs = Date.now() - localisationResolveStart;
    const assetTreeIds = baseState.assetTreeIds && new Set(baseState.assetTreeIds);
    const assetTrees = assetTreeIds ? baseState.focusTrees.filter(tree => assetTreeIds.has(tree.id)) : baseState.focusTrees;
    const assetFocuses = assetTreeIds ? assetTrees.flatMap(tree => Object.values(tree.focuses)) : baseState.allFocuses;
    const assetInlays = assetTreeIds ? assetTrees.flatMap(tree => tree.inlayWindows) : baseState.allInlays;
    const focusIconAssetResolution = baseState.focusIconAssetResolution ?? createEmptyFocusIconAssetResolution();
    const focusIconStyleSignature = baseState.focusIconStyleSignature ?? focusIconAssetResolution.styleSignature;
    const styleTable = createFocusTreeStyleTable();
    const maxFocusIconWidth = Math.max(baseState.xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    ensureFocusTemplateStyles(styleTable, maxFocusIconWidth, maxFocusIconHeight);
    const focusRenderStart = Date.now();
    const focusIconStyleStart = Date.now();
    const materialization = baseState.deferredAssetLoad
        ? { real: [] as Focus[], placeholders: assetFocuses, focusIds: [] as string[] | undefined }
        : selectMaterializedFocuses(assetFocuses, materializedFocusIds);
    const hasExistingStyleKey = existingStyleRules && ((key: string) => existingStyleRules.has(key));
    if (baseState.deferredAssetLoad) {
        await prepareDeferredFocusIconStyles(
            assetFocuses,
            styleTable,
            baseState.xGridSize,
            baseState.yGridSize,
            isCancelled,
            hasExistingStyleKey,
        );
    } else {
        // Search filter icons label toolbar options of the whole tree, so they are always real.
        const treeSearchFilterIcons = materialization.focusIds
            ? Array.from(new Set(assetTrees.flatMap(tree => tree.searchFilters ?? []))).map(filter => `GFX_${filter}`)
            : [];
        await prepareFocusIconStyles(
            materialization.real,
            styleTable,
            focusIconAssetResolution,
            baseState.xGridSize,
            baseState.yGridSize,
            isCancelled,
            !!baseState.presentation?.item,
            onAssetStyleBatch,
            treeSearchFilterIcons,
        );
        if (materialization.placeholders.length > 0) {
            // Real rules were registered first; placeholders only fill icon names without one,
            // in this payload or in the scenes it is merged into.
            await prepareDeferredFocusIconStyles(
                materialization.placeholders,
                styleTable,
                baseState.xGridSize,
                baseState.yGridSize,
                isCancelled,
                hasExistingStyleKey,
            );
        }
    }
    throwIfFocusTreeRenderCancelled(isCancelled);
    const focusIconStyleDurationMs = Date.now() - focusIconStyleStart;
    const focusTemplateRenderStart = Date.now();
    const focusCardTemplates = baseState.deferredAssetLoad
        ? { templates: {}, keyById: {} }
        : await renderFocusCardTemplates(baseState, assetFocuses, styleTable, isCancelled);
    const focusTemplateRenderDurationMs = Date.now() - focusTemplateRenderStart;
    const focusRenderDurationMs = Date.now() - focusRenderStart;

    const inlayRenderStart = Date.now();
    let inlayStyleDurationMs = 0;
    const renderedInlayWindows: Record<string, string> = {};
    if (!baseState.deferredAssetLoad) {
        const inlayStyleStart = Date.now();
        await prepareInlayGfxStyles(assetTrees, styleTable, isCancelled);
        throwIfFocusTreeRenderCancelled(isCancelled);
        inlayStyleDurationMs = Date.now() - inlayStyleStart;
        for (let start = 0; start < assetInlays.length; start += focusTreeAssetRenderBatchSize) {
            const inlays = assetInlays.slice(start, start + focusTreeAssetRenderBatchSize);
            await Promise.all(inlays.map(async inlay => {
                renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, baseState.gfxFiles)).replace(/\s\s+/g, ' ');
            }));
            if (start + focusTreeAssetRenderBatchSize < assetInlays.length) {
                await yieldToFocusTreeRenderCancellation(isCancelled);
            } else {
                throwIfFocusTreeRenderCancelled(isCancelled);
            }
        }
    }
    const continuousFocusHtml = await renderContinuousFocusGui(baseState.presentation, styleTable, baseState.gfxFiles);
    const inlayRenderDurationMs = Date.now() - inlayRenderStart;
    throwIfFocusTreeRenderCancelled(isCancelled);
    const classRules = new Map(styleTable.rules());

    return {
        payload: {
            focusTrees: preparedViews ?? toFocusTreeViews(baseState.focusTrees, focusLocalizationTextById),
            sourceFocusTrees: baseState.focusTrees,
            selectedTreeId: baseState.assetTreeIds?.[0] ?? baseState.focusTrees[0]?.id,
            assetTreeIds: baseState.assetTreeIds,
            materializedFocusIds: materialization.focusIds,
            focusTemplates: focusCardTemplates.templates,
            focusTemplateKeyById: focusCardTemplates.keyById,
            continuousFocusHtml,
            renderedInlayWindows,
            gfxFiles: baseState.gfxFiles,
            focusIconGfxFileByName: baseState.focusIconGfxFileByName,
            focusIconAssetResolution,
            focusIconStyleSignature,
            gridBox: baseState.gridBox,
            dynamicStyleCss: styleTable.toStyleContent(),
            dynamicStyleRules: classRules,
            // Every class record matches `classRules`, so only the raw records remain.
            dynamicStyleRawCss: styleTable.toStyleContent(classRules).trim(),
            styleNonce: Math.random().toString(36).slice(2),
            xGridSize: baseState.xGridSize,
            yGridSize: baseState.yGridSize,
            focusToolbarHeight,
            focusPositionDocumentVersion: baseState.focusPositionDocumentVersion,
            focusPositionActiveFile: baseState.focusPositionActiveFile,
            conditionPresetsByTree: baseState.conditionPresetsByTree,
            hasFocusSelector: baseState.hasFocusSelector,
            hasWarningsButton: baseState.hasWarningsButton,
            deferredAssetLoad: baseState.deferredAssetLoad,
            localisationIndexReady: baseState.localisationIndexReady,
        },
        metrics: {
            loadDurationMs: baseState.loadDurationMs,
            focusIconStyleDurationMs,
            localisationResolveDurationMs,
            focusTemplateRenderDurationMs,
            focusRenderDurationMs,
            inlayStyleDurationMs,
            inlayRenderDurationMs,
            focusCount: baseState.allFocuses.length,
            inlayCount: baseState.allInlays.length,
            renderedFocusCount: assetFocuses.length,
            renderedInlayCount: assetInlays.length,
            materializedFocusCount: materialization.real.length,
            deferredAssetLoad: baseState.deferredAssetLoad,
        },
    };
}

/**
 * Splits asset focuses into those decoded for real, in the requested order, and placeholders.
 * Without a requested set every focus is real, which keeps unscoped callers unchanged.
 */
function selectMaterializedFocuses(
    assetFocuses: readonly Focus[],
    materializedFocusIds: readonly string[] | undefined,
): { real: Focus[]; placeholders: Focus[]; focusIds: string[] | undefined } {
    if (!materializedFocusIds) {
        return { real: [...assetFocuses], placeholders: [], focusIds: undefined };
    }
    const assetFocusById = new Map<string, Focus>();
    assetFocuses.forEach(focus => {
        if (!assetFocusById.has(focus.id)) {
            assetFocusById.set(focus.id, focus);
        }
    });
    const focusIds = Array.from(new Set(materializedFocusIds)).filter(focusId => assetFocusById.has(focusId));
    const realIds = new Set(focusIds);
    return {
        real: focusIds.map(focusId => assetFocusById.get(focusId)!),
        placeholders: assetFocuses.filter(focus => !realIds.has(focus.id)),
        focusIds,
    };
}

/** Class key of a focus icon rule as stored in style rule maps. */
export function getFocusIconStyleKey(iconName: string): string {
    return `st-focus-icon-${normalizeForStyle(iconName)}`;
}

/** Class key of a focus overlay rule as stored in style rule maps. */
export function getFocusOverlayStyleKey(overlayName: string): string {
    return `st-focus-overlay-${normalizeForStyle(overlayName)}`;
}

/** Rule keys that a focus's icon, overlay, and search filter assets occupy. */
export function getFocusAssetStyleKeys(focus: Pick<Focus, 'icon' | 'overlay' | 'searchFilters'>): string[] {
    return [
        ...focus.icon.map(option => option.icon).filter((iconName): iconName is string => !!iconName).map(getFocusIconStyleKey),
        ...(focus.searchFilters ?? []).map(filter => getFocusIconStyleKey(`GFX_${filter}`)),
        ...(focus.overlay ? [getFocusOverlayStyleKey(focus.overlay)] : []),
    ];
}

export interface FocusTreeAssetStylePatchOptions {
    focusIconAssetResolution: FocusIconAssetResolution;
    xGridSize: number;
    yGridSize: number;
    useNativeSize: boolean;
    /** Rules the webview already has; identical rules are not sent again. */
    existingStyleRules: ReadonlyMap<string, string>;
    /** Focuses the webview asked for again although they were sent; their rules are always included. */
    resendFocusIds?: ReadonlySet<string>;
    isCancelled?: () => boolean;
}

export interface FocusTreeAssetStylePatch {
    rules: Array<[key: string, content: string]>;
}

/**
 * Decodes the icons and overlays of the given focuses and returns only the rules the webview
 * still needs. Real rules replace placeholders by appearing later in the cascade.
 */
export async function renderFocusAssetStylePatch(
    focuses: readonly Focus[],
    options: FocusTreeAssetStylePatchOptions,
): Promise<FocusTreeAssetStylePatch> {
    const styleTable = new StyleTable();
    if (focuses.length > 0) {
        await prepareFocusIconStyles(
            focuses,
            styleTable,
            options.focusIconAssetResolution,
            options.xGridSize,
            options.yGridSize,
            options.isCancelled,
            options.useNativeSize,
        );
    }
    throwIfFocusTreeRenderCancelled(options.isCancelled);
    const resendKeys = new Set(focuses
        .filter(focus => options.resendFocusIds?.has(focus.id))
        .flatMap(getFocusAssetStyleKeys));
    return {
        rules: styleTable.rules()
            .filter(([key, content]) => resendKeys.has(key) || options.existingStyleRules.get(key) !== content),
    };
}

export interface FocusCardTemplates {
    templates: Record<string, string>;
    keyById: Record<string, string>;
}

/**
 * Renders one GUI card template per focus variant and maps focuses to it. Without a focus GUI
 * the webview builds standard cards itself, so no templates are produced.
 */
export async function renderFocusCardTemplates(
    baseState: FocusTreeRenderBaseState,
    focuses: readonly Focus[],
    styleTable: StyleTable,
    isCancelled?: () => boolean,
): Promise<FocusCardTemplates> {
    const result: FocusCardTemplates = { templates: {}, keyById: {} };
    if (!baseState.presentation?.item) {
        return result;
    }

    const guiRenderer = new FocusGuiRenderer(
        baseState.presentation,
        styleTable,
        baseState.gfxFiles,
        baseState.xGridSize,
        baseState.yGridSize,
    );
    const keyByGuiTemplate = new Map<string, string>();
    for (let index = 0; index < focuses.length; index += 1) {
        if (index > 0 && index % focusTreeRenderCancellationBatchSize === 0) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        }

        const focus = focuses[index];
        const guiTemplate = await guiRenderer.renderTemplate(focus);
        if (guiTemplate === undefined) {
            continue;
        }
        let key = keyByGuiTemplate.get(guiTemplate);
        if (key === undefined) {
            const cardTemplate = renderFocusCardTemplate(styleTable, baseState.xGridSize, guiTemplate);
            key = hashStyleContent(cardTemplate);
            keyByGuiTemplate.set(guiTemplate, key);
            result.templates[key] = cardTemplate;
        }
        result.keyById[focus.id] = key;
    }
    throwIfFocusTreeRenderCancelled(isCancelled);
    return result;
}

function resolveSearchFilterLabels(focusTrees: FocusTree[]): void {
    const resolveText = createLocalisedTextQuickIfReadyResolver();
    for (const focusTree of focusTrees) {
        const searchFilters = focusTree.searchFilters ?? [];
        if (searchFilters.length === 0) {
            delete focusTree.searchFilterLabels;
            continue;
        }
        focusTree.searchFilterLabels = Object.fromEntries(
            searchFilters.map(filter => [filter, resolveText?.(filter) ?? filter]),
        );
    }
}

const unsupportedLocalisationWarningCode = 'focus-localisation-dynamic-token';
const unsupportedLocalisationTokenPattern = /\$[^$\r\n]+\$|\[[^\]\r\n]+\]/;

function refreshUnsupportedLocalisationWarnings(
    focusTrees: FocusTree[],
    focusLocalizationTextById: Record<string, string | undefined>,
): void {
    for (const focusTree of focusTrees) {
        const warnings: FocusWarning[] = focusTree.warnings
            .filter(warning => warning.code !== unsupportedLocalisationWarningCode);

        for (const focus of Object.values(focusTree.focuses)) {
            const localisationText = focusLocalizationTextById[focus.id];
            if (!localisationText || !unsupportedLocalisationTokenPattern.test(localisationText)) {
                continue;
            }

            warnings.push({
                code: unsupportedLocalisationWarningCode,
                kind: 'parse',
                severity: 'info',
                source: focus.id,
                relatedFocusIds: [focus.id],
                navigations: focus.token ? [{
                    file: focus.file,
                    start: focus.token.start,
                    end: focus.token.end,
                }] : undefined,
                text: localize(
                    'focustree.warnings.localisationDynamicToken',
                    'Focus {0} resolves to localisation text containing dynamic or scripted tokens that the preview may not evaluate: {1}',
                    focus.id,
                    localisationText,
                ),
            });
        }

        focusTree.warnings = sortFocusWarnings(warnings);
    }
}

function hasFocusTreeWarnings(focusTrees: FocusTree[]): boolean {
    return focusTrees.some(focusTree => focusTree.warnings.length > 0);
}

function buildFocusTreeBootstrapScripts(payload: FocusTreeRenderPayload): string[] {
    return [
        'window.focusTrees = ' + JSON.stringify(payload.focusTrees),
        'window.bootstrapSelectedFocusTreeId = ' + JSON.stringify(payload.selectedTreeId),
        'window.focusTreeTraceEnabled = ' + JSON.stringify(process.env.HOI4MU_FOCUSTREE_TRACE === '1'),
        'window.focusTemplates = ' + JSON.stringify(payload.focusTemplates).replace(/</g, '\\u003c'),
        'window.focusTemplateKeyById = ' + JSON.stringify(payload.focusTemplateKeyById),
        'window.renderedInlayWindows = ' + JSON.stringify(payload.renderedInlayWindows),
        'window.continuousFocusHtml = ' + JSON.stringify(payload.continuousFocusHtml ?? '').replace(/</g, '\\u003c'),
        'window.gridBox = ' + JSON.stringify(payload.gridBox),
        'window.styleNonce = ' + JSON.stringify(payload.styleNonce),
        'window.useConditionInFocus = ' + isUseConditionInFocusEnabled(),
        'window.xGridSize = ' + payload.xGridSize,
        'window.yGridSize = ' + payload.yGridSize,
        'window.focusToolbarHeight = ' + payload.focusToolbarHeight,
        'window.focusPositionDocumentVersion = ' + JSON.stringify(payload.focusPositionDocumentVersion),
        'window.focusPositionActiveFile = ' + JSON.stringify(payload.focusPositionActiveFile),
        'window.persistedConditionPresetsByTree = ' + JSON.stringify(payload.conditionPresetsByTree),
    ];
}

function createEmptyFocusTreeRenderPayload(
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree,
): FocusTreeRenderPayload {
    const emptyIconAssetResolution = createEmptyFocusIconAssetResolution();
    return {
        focusTrees: [],
        sourceFocusTrees: [],
        selectedTreeId: undefined,
        focusTemplates: {},
        focusTemplateKeyById: {},
        renderedInlayWindows: {},
        gfxFiles: [],
        focusIconGfxFileByName: {},
        focusIconAssetResolution: emptyIconAssetResolution,
        focusIconStyleSignature: emptyIconAssetResolution.styleSignature,
        gridBox: {
            position: { x: toNumberLike(leftPaddingBase), y: toNumberLike(topPaddingBase) },
            format: toStringAsSymbolIgnoreCase('up'),
            size: { width: toNumberLike(defaultXGridSize), height: undefined },
            slotsize: { width: toNumberLike(defaultXGridSize), height: toNumberLike(defaultYGridSize) },
        } as HOIPartial<GridBoxType>,
        dynamicStyleCss: '',
        styleNonce: Math.random().toString(36).slice(2),
        xGridSize: defaultXGridSize,
        yGridSize: defaultYGridSize,
        focusToolbarHeight,
        focusPositionDocumentVersion: documentVersion,
        focusPositionActiveFile: '',
        conditionPresetsByTree,
        hasFocusSelector: false,
        hasWarningsButton: false,
        deferredAssetLoad: false,
        localisationIndexReady: isLocalisationIndexReady(),
    };
}

function renderFocusTreeBody(payload: FocusTreeRenderPayload): string {
    const styleTable = new StyleTable();
    const continuousFocusContent =
        `<div id="continuousFocuses" class="${styleTable.oneTimeStyle('continuousFocuses', () => `
            position: absolute;
            width: 770px;
            height: 380px;
            margin: 20px;
            background: rgba(128, 128, 128, 0.2);
            text-align: center;
            display: none;
            pointer-events: none;
            z-index: 4;
        `)}">${payload.continuousFocusHtml || htmlEscape(localize('focustree.continuousFocuses', 'Continuous focuses'))}</div>`;

    styleTable.raw('#focustreeplaceholder', 'pointer-events: none;');
    styleTable.raw('body[data-focus-frames="false"] .focus-frame-gfx', 'display:none;');
    styleTable.raw('body[data-focus-decorations="false"] .focus-decoration-gfx', 'display:none;');
    styleTable.raw('#focus-gfx-controls', 'flex-shrink:0;gap:4px;');
    styleTable.raw('#focus-gfx-controls button', 'width:auto;min-width:max-content;flex-shrink:0;white-space:nowrap;padding:0 8px;box-sizing:border-box;border:1px solid var(--vscode-panel-border);');
    styleTable.raw('#focus-gfx-controls button[aria-pressed="true"]', 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);');
    styleTable.raw('#focus-gfx-controls button:focus-visible', 'outline:1px solid var(--vscode-focusBorder);outline-offset:1px;');
    styleTable.raw('#focus-gfx-controls button:active', 'transform:none;');
    styleTable.raw('#focustreeplaceholder [data-focus-id], #focustreeplaceholder [data-focus-id] *, #focustreeplaceholder .navigator, #focustreeplaceholder .navigator *', 'pointer-events: auto;');
    styleTable.raw('.preview-label-name-text', 'display:none;');
    styleTable.raw('body[data-preview-label-mode="name"] .preview-label-id-text', 'display:none;');
    styleTable.raw('body[data-preview-label-mode="name"] .preview-label-name-text', 'display:inline;');
    styleTable.raw('#inlaywindowplaceholder', 'pointer-events: none;');
    styleTable.raw('#inlaywindowplaceholder .navigator, #inlaywindowplaceholder .navigator *, #inlaywindowplaceholder button, #inlaywindowplaceholder button *', 'pointer-events: auto;');
    // Scene nodes and interaction states. The webview toggles classes and body attributes, so
    // hovering, selecting, or entering edit mode only restyles the affected focuses.
    styleTable.raw('#focus-gridbox > .focus-node-layer > .focus', 'position: absolute; left: 0; top: 0; width: var(--focus-slot-width); height: var(--focus-slot-height);');
    styleTable.raw('#focustreeplaceholder [data-focus-id]', 'cursor: pointer;');
    styleTable.raw(':where(body[data-focus-edit-mode="true"]) #focustreeplaceholder [data-focus-id][data-focus-editable="true"]', 'cursor: grab; box-shadow: 0 0 0 1px rgba(32, 124, 229, 0.85) inset;');
    styleTable.raw('#focustreeplaceholder [data-focus-id].focus-selected', 'box-shadow: 0 0 0 2px rgba(96, 196, 255, 0.95) inset;');
    styleTable.raw('#focustreeplaceholder [data-focus-id].focus-link-parent', 'box-shadow: 0 0 0 2px rgba(255, 196, 64, 0.95) inset;');
    styleTable.raw(':where(body[data-focus-link-type="exclusive"]) #focustreeplaceholder [data-focus-id].focus-link-parent', 'box-shadow: 0 0 0 2px rgba(255, 96, 96, 0.95) inset;');
    styleTable.raw('#focustreeplaceholder [data-focus-id].focus-filter-miss', 'opacity: 0.2;');
    styleTable.raw(':where(body[data-focus-hover="true"]) #focustreeplaceholder [data-focus-id]:not(.focus-related)', 'opacity: 0.32; filter: saturate(0.45);');
    styleTable.raw(':where(body[data-focus-hover="true"]) #focustreeplaceholder [data-focus-id].focus-related', 'opacity: 1;');
    styleTable.raw(':where(body[data-focus-hover="true"]) #focustreeplaceholder .focus-connection-layer path', 'opacity: 0.14; filter: saturate(0.35);');
    styleTable.raw(':where(body[data-focus-hover="true"]) #focustreeplaceholder .focus-connection-layer path.focus-related-edge', 'opacity: 1; filter: saturate(1.1);');
    styleTable.raw('#focustreeplaceholder .focus.focus-search-match', 'outline: 1px solid #E33; background: rgba(255, 0, 0, 0.5);');
    styleTable.raw('#focustreeplaceholder .focus.focus-search-match.focus-search-current', 'outline-width: 3px;');
    styleTable.raw('#focustreeplaceholder .focus-branch-hidden', 'display: none !important;');
    // Icons still rendering structural placeholders pulse gently; nothing moves or resizes.
    const pendingIconSelector = '#focustreeplaceholder [data-focus-id].focus-asset-pending .st-focus-icon-image, '
        + '#focustreeplaceholder [data-focus-id].focus-asset-pending .focus-gui-symbol';
    styleTable.raw(pendingIconSelector, 'animation: focus-asset-pending-pulse 1.4s ease-in-out infinite;');
    styleTable.raw('@keyframes focus-asset-pending-pulse', '0%, 100% { opacity: 0.45; } 50% { opacity: 0.8; }');
    styleTable.raw('#focus-asset-status', 'position:fixed;left:18px;bottom:18px;z-index:1000;display:flex;align-items:center;gap:6px;'
        + 'max-width:min(60vw, 420px);padding:4px 8px;box-sizing:border-box;font-size:12px;'
        + 'background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border);');
    styleTable.raw('#focus-asset-status[hidden], #focus-asset-status [hidden]', 'display:none !important;');
    styleTable.raw('#focus-asset-status[data-state="failed"]', 'border-color:var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));');
    styleTable.raw('#focus-asset-status button', 'width:auto;height:20px;padding:0 6px;flex-shrink:0;');
    styleTable.raw('#focus-asset-status button:focus-visible', 'outline:1px solid var(--vscode-focusBorder);outline-offset:1px;');
    styleTable.raw('@media (prefers-reduced-motion: reduce)',
        `${pendingIconSelector} { animation: none; opacity: 0.6; } #focus-asset-status .codicon { animation: none; }`);

    const shellMarkup =
        `<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` +
        `<div id="focustreecontent" class="${styleTable.oneTimeStyle('focustreecontent', () => `top:${payload.focusToolbarHeight}px;left:-20px;position:relative`)}">
            <div id="focustreeplaceholder" class="${styleTable.oneTimeStyle('focustreeplaceholder', () => `position: relative; z-index: 2;`)}"></div>
            <div id="inlaywindowplaceholder" class="${styleTable.oneTimeStyle('inlaywindowplaceholder', () => `position: relative; z-index: 3;`)}"></div>
            ${continuousFocusContent}
        </div>` +
        renderWarningContainer(styleTable) +
        renderAssetLoadingStatus() +
        renderToolBar(payload, styleTable);
    const shellCss = styleTable.toStyleContent();

    return (
        `<style id="focus-tree-shell-style" nonce="${payload.styleNonce}">${shellCss}</style>` +
        `<style id="focus-tree-dynamic-style" nonce="${payload.styleNonce}">${payload.dynamicStyleCss}</style>` +
        shellMarkup
    );
}

/** Polite live region the webview fills while on-screen focus icons are still loading. */
function renderAssetLoadingStatus(): string {
    return `<div id="focus-asset-status" role="status" aria-live="polite" aria-atomic="true" hidden>`
        + `<i class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></i>`
        + `<span id="focus-asset-status-text"></span>`
        + `<button type="button" id="focus-asset-retry" hidden>${htmlEscape(localize('focustree.assets.retry', 'Retry'))}</button>`
        + `</div>`;
}

function normalizeFocusSpacingValue(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function renderWarningContainer(styleTable: StyleTable) {
    styleTable.style('warnings', () => 'outline: none;', ':focus');
    const warningEntryClass = styleTable.style('warnings-entry', () => `
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        width: 100%;
        height: auto;
        min-height: 56px;
        padding: 10px 12px;
        border: 1px solid var(--vscode-panel-border);
        box-sizing: border-box;
        background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background));
        color: var(--vscode-editor-foreground);
        text-align: left;
        font: inherit;
        line-height: 1.35;
        cursor: pointer;
    `);
    styleTable.style('warnings-entry', () => `
        transform: none;
        transition: none;
    `, ':active');
    const warningEntryMutedClass = styleTable.style('warnings-entry-muted', () => `
        cursor: default;
        opacity: 0.92;
    `);
    const warningMetaClass = styleTable.style('warnings-entry-meta', () => `
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.25;
    `);
    const warningTextClass = styleTable.style('warnings-entry-text', () => `
        white-space: pre-wrap;
        line-height: 1.35;
    `);
    const warningSeverityWarningClass = styleTable.style('warnings-entry-warning', () => `
        border-left: 3px solid rgba(210, 140, 38, 0.96);
    `);
    const warningSeverityInfoClass = styleTable.style('warnings-entry-info', () => `
        border-left: 3px solid rgba(92, 138, 184, 0.96);
    `);
    return `
    <div id="warnings-container" role="region" aria-label="${htmlAttributeEscape(localize('focustree.warnings.panel', 'Warnings'))}" class="${styleTable.style('warnings-container', () => `
        height: 100vh;
        width: 100vw;
        position: fixed;
        top: 0;
        left: 0;
        padding-top: ${focusToolbarHeight}px;
        background: var(--vscode-editor-background);
        box-sizing: border-box;
        display: none;
    `)}">
        <div id="warnings" tabindex="-1" class="${styleTable.style('warnings', () => `
            height: 100%;
            width: 100%;
            font-family: 'Consolas', monospace;
            background: var(--vscode-editor-background);
            padding: 10px;
            border-top: none;
            border-left: none;
            border-bottom: none;
            box-sizing: border-box;
            overflow: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
        `)}"></div>
        <div id="warnings-entry-template" style="display:none"
            data-warning-entry-class="${warningEntryClass}"
            data-warning-entry-muted-class="${warningEntryMutedClass}"
            data-warning-meta-class="${warningMetaClass}"
            data-warning-text-class="${warningTextClass}"
            data-warning-warning-class="${warningSeverityWarningClass}"
            data-warning-info-class="${warningSeverityInfoClass}"></div>
    </div>`;
}

function renderToolBar(payload: FocusTreeRenderPayload, styleTable: StyleTable): string {
    const focusTrees = payload.focusTrees;
    const toolbarGroupStyle = (marginRight: string = '10px') => styleTable.style('toolbarGroup', () => `display:flex; align-items:center; margin-right:${marginRight}; min-height:24px;`);
    const toolbarLabelStyle = (extra: string = '') => styleTable.style('toolbarLabel', () => `margin-right:5px; display:flex; align-items:center;${extra}`);

    const focuses = `
        <div id="focus-tree-selector-container" class="${toolbarGroupStyle()}" style="${payload.hasFocusSelector ? 'display:flex;' : 'display:none;'}">
            <label for="focuses" class="${toolbarLabelStyle()}">${localize('focustree.focustree', 'Focus tree: ')}</label>
            <div class="select-container">
                <select id="focuses" class="select multiple-select" tabindex="0" role="combobox">
                    ${focusTrees.map((focus, i) => `<option value="${i}">${focus.id}</option>`).join('')}
                </select>
            </div>
        </div>`;

    const searchbox = `
        <div class="${toolbarGroupStyle()}">
            <label for="searchbox" class="${toolbarLabelStyle()}">${localize('focustree.search', 'Search: ')}</label>
            <input
                class="${styleTable.style('searchbox', () => `height:22px; box-sizing:border-box;`)}"
                id="searchbox"
                type="text"
                title="${htmlAttributeEscape(localize('focustree.search.keys', 'Enter: next match. Shift+Enter: previous match. Alt+Enter: open the current match in the editor.'))}"
                aria-describedby="focus-search-count"
            />
            <span id="focus-search-count" aria-live="polite" class="${styleTable.style('focusSearchCount', () => `margin-left:6px; min-width:4em; font-size:11px; white-space:nowrap; color:var(--vscode-descriptionForeground);`)}"></span>
        </div>`;

    const searchFilters = `
        <div id="search-filters-container" class="${toolbarGroupStyle()}">
            <label for="search-filters" class="${toolbarLabelStyle()}">${localize('focustree.searchfilters', 'Filters: ')}</label>
            <div class="select-container">
                <div id="search-filters" class="select multiple-select ${styleTable.style('searchFilters', () => `min-width:120px; max-width:260px;`)}" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const previewLabelMode = isLocalisationIndexEnabled() ? `
        <div class="preview-label-mode ${toolbarGroupStyle()}">
            <span class="${toolbarLabelStyle()}">${localize('preview.labelmode', 'Label: ')}</span>
            <button type="button" data-preview-label-mode-value="id" aria-pressed="true">${localize('preview.labelmode.id', 'ID')}</button>
            <button type="button" data-preview-label-mode-value="name" aria-pressed="false">${localize('preview.labelmode.name', 'Name')}</button>
        </div>` : '';

    const editToggle = `
        <div class="${styleTable.style('toolbarIconGroup', () => `display:flex; align-items:center;`) }">
            <button
                id="focus-position-edit"
                title="${localize('TODO', 'Toggle focus position editing')}"
                class="${styleTable.style('focusPositionEditButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0;`)}"
            ><i class="codicon codicon-edit"></i></button>
        </div>`;

    const inlayWindows = `
        <div id="inlay-window-container" class="${toolbarGroupStyle()}" style="display:none;">
            <label for="inlay-windows" class="${toolbarLabelStyle()}">${localize('TODO', 'Inlay window: ')}</label>
            <div class="select-container">
                <div id="inlay-windows" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const allowbranch = `
        <div id="allowbranch-container" class="${toolbarGroupStyle()}">
            <label for="allowbranch" class="${toolbarLabelStyle()}">${localize('focustree.allowbranch', 'Allow branch: ')}</label>
            <div class="select-container">
                <div id="allowbranch" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const conditions = `
        <div id="condition-container" class="${toolbarGroupStyle()}">
            <label for="conditions" class="${toolbarLabelStyle()}">${localize('focustree.conditions', 'Conditions: ')}</label>
            <div class="select-container">
                <div id="conditions" class="select multiple-select ${styleTable.style('conditionsLabel', () => `max-width:400px`)}" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const conditionPresets = `
        <div id="condition-preset-container" class="${toolbarGroupStyle()}">
            <label for="condition-presets" class="${toolbarLabelStyle()}">${localize('TODO', 'Preset: ')}</label>
            <div class="select-container">
                <div id="condition-presets" class="select multiple-select ${styleTable.style('conditionsLabel', () => `max-width:240px`)}" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
            <button
                id="save-condition-preset"
                title="${localize('TODO', 'Save current preset')}"
                class="${styleTable.style('toolbarSmallIconButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0; margin-left:4px;`)}"
            ><i class="codicon codicon-add"></i></button>
            <button
                id="delete-condition-preset"
                title="${localize('TODO', 'Delete selected preset')}"
                class="${styleTable.style('toolbarSmallIconButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0; margin-left:4px;`)}"
            ><i class="codicon codicon-trash"></i></button>
        </div>`;

    const warningsButton = `
        <button id="show-warnings" type="button" title="${localize('focustree.warnings', 'Toggle warnings')}" aria-controls="warnings-container" aria-expanded="false" style="${payload.hasWarningsButton ? '' : 'display:none;'}">
            <i class="codicon codicon-warning" aria-hidden="true"></i>
        </button>`;

    const refreshButton = `
        <button id="refresh" title="${localize('common.topbar.refresh.title', 'Refresh')}">
            <i class="codicon codicon-refresh"></i>
        </button>`;

    return `<div class="toolbar-outer ${styleTable.style('toolbar-height', () => `box-sizing: border-box; min-height:${focusToolbarHeight}px; padding: 4px 6px; z-index:10;`)}">
        <div class="toolbar ${styleTable.style('toolbarAlign', () => `display:flex; flex-direction:column; align-items:stretch; gap:4px;`) }">
            <div class="${styleTable.style('toolbarRow', () => `display:flex; align-items:center; gap:10px;`) }">
                ${focuses}
                ${previewLabelMode}
                ${searchbox}
                ${searchFilters}
                ${editToggle}
            </div>
            <div class="${styleTable.style('toolbarRow', () => `display:flex; align-items:center; flex-wrap:wrap; gap:10px;`) }">
                ${isUseConditionInFocusEnabled() ? conditionPresets + conditions : allowbranch}
                ${inlayWindows}
                <div id="focus-gfx-controls" class="${toolbarGroupStyle()}">
                    <button type="button" id="focus-frame-gfx" aria-pressed="true">${localize('focustree.framegfx', 'Focus frame GFX')}</button>
                    <button type="button" id="focus-decoration-gfx" aria-pressed="true">${localize('focustree.decorationgfx', 'Focus decoration GFX')}</button>
                </div>
                ${warningsButton}
                ${refreshButton}
            </div>
        </div>
    </div>`;
}

function getInlayGfxStyleKey(gfxName: string | undefined, gfxFile: string | undefined) {
    return 'inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}

async function prepareInlayGfxStyles(
    focusTrees: FocusTree[],
    styleTable: StyleTable,
    isCancelled?: () => boolean,
): Promise<void> {
    const processed = new Set<string>();
    const options: Array<{ key: string; gfxName: string; gfxFile: string | undefined }> = [];
    for (const focusTree of focusTrees) {
        for (const inlay of focusTree.inlayWindows) {
            for (const slot of inlay.scriptedImages) {
                for (const option of slot.gfxOptions) {
                    const key = getInlayGfxStyleKey(option.gfxName, option.gfxFile);
                    if (processed.has(key)) {
                        continue;
                    }
                    processed.add(key);
                    options.push({ key, gfxName: option.gfxName, gfxFile: option.gfxFile });
                }
            }
        }
    }

    throwIfFocusTreeRenderCancelled(isCancelled);
    const applyMissingStyle = (key: string) => {
        styleTable.style(key, () => `
            width: 96px;
            height: 96px;
            background: rgba(127, 127, 127, 0.35);
            border: 1px dashed var(--vscode-panel-border);
        `);
    };

    for (let start = 0; start < options.length; start += focusTreeAssetRenderBatchSize) {
        const optionBatch = options.slice(start, start + focusTreeAssetRenderBatchSize);
        await Promise.all(optionBatch.map(async option => {
            if (!option.gfxFile) {
                applyMissingStyle(option.key);
                return;
            }

            const sprite = await getSpriteByGfxNameFromResolvedFiles(option.gfxName, [option.gfxFile]);
            const frame = sprite?.getFrame(0);
            if (!frame) {
                applyMissingStyle(option.key);
                return;
            }

            styleTable.style(option.key, () => `
                width: ${Math.min(frame.width, 144)}px;
                height: ${Math.min(frame.height, 144)}px;
                background-image: url(${frame.uri});
                background-repeat: no-repeat;
                background-position: center;
                background-size: contain;
            `);
        }));

        if (start + focusTreeAssetRenderBatchSize < options.length) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        } else {
            throwIfFocusTreeRenderCancelled(isCancelled);
        }
    }
}

async function renderInlayWindow(inlay: FocusTree["inlayWindows"][number], styleTable: StyleTable, gfxFiles: string[]): Promise<string> {
    if (!inlay.guiWindow) {
        return '';
    }

    const parentInfo: ParentInfo = {
        size: {
            width: 1920,
            height: 1080,
        },
        orientation: 'upper_left',
    };

    const content = await renderContainerWindow(
        {
            ...inlay.guiWindow,
            position: { x: toNumberLike(0), y: toNumberLike(0) },
        },
        parentInfo,
        {
            styleTable,
            enableNavigator: true,
            classNames: 'focus-inlay-window navigator',
            getSprite: (sprite) => getSpriteByGfxNameFromResolvedFiles(sprite, gfxFiles),
            onRenderChild: async (type, child, parent) => renderInlayOverrideChild(type, child, parent, inlay, styleTable),
        }
    );

    return `<div class="${styleTable.style('focus-inlay-window-root', () => `
        position: absolute;
        left: ${inlay.position.x}px;
        top: ${inlay.position.y}px;
        z-index: 5;
    `)}"
        start="${inlay.token?.start}"
        end="${inlay.token?.end}"
        file="${inlay.file}">${content}</div>`;
}

async function renderInlayOverrideChild<T extends keyof RenderChildTypeMap>(
    type: T,
    child: RenderChildTypeMap[T],
    parentInfo: ParentInfo,
    inlay: FocusTree["inlayWindows"][number],
    styleTable: StyleTable,
): Promise<string | undefined> {
    if ((type !== 'icon' && type !== 'button') || !child.name) {
        return undefined;
    }

    const slot = inlay.scriptedImages.find(scriptedImage => scriptedImage.id === child.name);
    if (!slot) {
        return undefined;
    }

    const iconLikeChild = child as HOIPartial<IconType & ButtonType>;
    const spriteOption = slot.gfxOptions[0];
    if (!spriteOption) {
        return undefined;
    }

    let [x, y] = calculateBBox(iconLikeChild, parentInfo);
    const scale = iconLikeChild.scale ?? 1;
    if (iconLikeChild.centerposition) {
        x -= 48;
        y -= 48;
    }

    const gfxClassPlaceholder = `{{inlay_slot_class:${slot.id}}}`;
    const spriteHtml = `<div class="navigator ${styleTable.style('positionAbsolute', () => `position: absolute;`)} ${styleTable.oneTimeStyle('inlay-slot-base', () => `
            left: 0;
            top: 0;
            width: 96px;
            height: 96px;
        `)} ${gfxClassPlaceholder}"></div>`;
    const textHtml = type === 'button' ? await renderInstantTextBox({
        ...iconLikeChild,
        position: { x: toNumberLike(0), y: toNumberLike(0) },
        bordersize: { x: toNumberLike(0), y: toNumberLike(0) },
        maxheight: toNumberLike(96 * scale),
        maxwidth: toNumberLike(96 * scale),
        font: iconLikeChild.buttonfont,
        text: iconLikeChild.buttontext ?? iconLikeChild.text,
        format: toStringAsSymbolIgnoreCase('center'),
        vertical_alignment: 'center',
        orientation: toStringAsSymbolIgnoreCase('upper_left')
    }, parentInfo, { styleTable }) : '';

    return `<div
        start="${child._token?.start}"
        end="${child._token?.end}"
        class="navigator ${styleTable.style('positionAbsolute', () => `position: absolute;`)} ${styleTable.oneTimeStyle('inlay-gui-slot', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${96 * scale}px;
            height: ${96 * scale}px;
        `)}">
            ${spriteHtml}
            ${textHtml}
        </div>`;
}

export async function prepareFocusIconStyles(
    focuses: readonly Focus[],
    styleTable: StyleTable,
    focusIconAssetResolution: FocusIconAssetResolution,
    xGridSize: number,
    yGridSize: number,
    isCancelled?: () => boolean,
    useNativeSize = false,
    onAssetStyleBatch?: FocusTreeAssetStyleBatchHandler,
    additionalIconNames: readonly string[] = [],
): Promise<void> {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set([
        ...focuses.flatMap(focus => [
            ...focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName),
            ...(focus.searchFilters ?? []).map(filter => `GFX_${filter}`),
        ]),
        ...additionalIconNames,
    ]));
    const unresolvedIconNames = new Set(focusIconAssetResolution.unresolvedIconNames);
    const iconDiagnostics = {
        resolvedFromResolvedFilesCount: 0,
        defaultFallbackCount: 0,
        unresolvedGfxNames: [] as string[],
    };

    let batchIndex = 0;
    for (let start = 0; start < uniqueIconNames.length; start += focusTreeAssetRenderBatchSize) {
        const iconNames = uniqueIconNames.slice(start, start + focusTreeAssetRenderBatchSize);
        const batchStyleTable = new StyleTable();
        await Promise.all(iconNames.map(async iconName => {
            const iconResolution = await resolveFocusIcon(
                iconName,
                focusIconAssetResolution.gfxFileByIconName[iconName],
                unresolvedIconNames.has(iconName),
            );
            if (iconResolution.kind === 'resolved-files') {
                iconDiagnostics.resolvedFromResolvedFilesCount += 1;
            } else {
                iconDiagnostics.defaultFallbackCount += 1;
                iconDiagnostics.unresolvedGfxNames.push(iconName);
            }

            const displaySize = iconResolution.image
                ? useNativeSize ? { width: iconResolution.image.width, height: iconResolution.image.height }
                    : fitFocusIconToBounds(iconResolution.image.width, iconResolution.image.height, maxFocusIconWidth, maxFocusIconHeight)
                : { width: focusPlaceholderSize, height: focusPlaceholderSize };

            const styleName = 'focus-icon-' + normalizeForStyle(iconName);
            const iconState: FocusIconRenderState = iconResolution.image ? 'loaded' : 'unavailable';
            const styleContent = `
                width: ${displaySize.width}px;
                height: ${displaySize.height}px;
                background-repeat: no-repeat;
                background-size: contain;
                ${iconResolution.image ? `background-image: url(${iconResolution.image.uri});` : 'background: grey;'}
                ${focusIconStateProperty}: ${iconState};
            `;
            styleTable.style(styleName, () => styleContent);
            batchStyleTable.style(styleName, () => styleContent);
        }));
        if (onAssetStyleBatch && iconNames.length > 0) {
            await onAssetStyleBatch({
                batchIndex: batchIndex++,
                rules: batchStyleTable.rules(),
                assetNames: iconNames,
            });
        }
        if (start + focusTreeAssetRenderBatchSize < uniqueIconNames.length) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        } else {
            throwIfFocusTreeRenderCancelled(isCancelled);
        }
    }

    const uniqueOverlayNames = Array.from(new Set(
        focuses.map(focus => focus.overlay).filter((overlayName): overlayName is string => !!overlayName),
    ));
    for (let start = 0; start < uniqueOverlayNames.length; start += focusTreeAssetRenderBatchSize) {
        const overlayNames = uniqueOverlayNames.slice(start, start + focusTreeAssetRenderBatchSize);
        const batchStyleTable = new StyleTable();
        await Promise.all(overlayNames.map(async overlayName => {
            const gfxFile = focusIconAssetResolution.gfxFileByIconName[overlayName];
            const overlaySprite = gfxFile
                ? await getSpriteByGfxNameFromResolvedFiles(overlayName, [gfxFile])
                : undefined;
            const styleName = 'focus-overlay-' + normalizeForStyle(overlayName);
            const styleContent = overlaySprite ? `background-image: url(${overlaySprite.image.uri});` : '';
            styleTable.style(styleName, () => styleContent);
            batchStyleTable.style(styleName, () => styleContent);
        }));
        if (onAssetStyleBatch && overlayNames.length > 0) {
            await onAssetStyleBatch({
                batchIndex: batchIndex++,
                rules: batchStyleTable.rules(),
                assetNames: overlayNames,
            });
        }
        if (start + focusTreeAssetRenderBatchSize < uniqueOverlayNames.length) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        } else {
            throwIfFocusTreeRenderCancelled(isCancelled);
        }
    }

    debug('Focus tree icon diagnostics', {
        resolvedFromResolvedFilesCount: iconDiagnostics.resolvedFromResolvedFilesCount,
        defaultFallbackCount: iconDiagnostics.defaultFallbackCount,
        unresolvedGfxNames: iconDiagnostics.unresolvedGfxNames.slice(0, 20),
    });

    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => `
        width: ${focusPlaceholderSize}px;
        height: ${focusPlaceholderSize}px;
        background: grey;
    `);
}

/**
 * Registers placeholder icon and overlay styles without decoding any image. `hasStyleKey`
 * skips names that already have a rule, so a placeholder never replaces a real icon.
 */
export async function prepareDeferredFocusIconStyles(
    focuses: readonly Focus[],
    styleTable: StyleTable,
    xGridSize: number,
    yGridSize: number,
    isCancelled?: () => boolean,
    hasStyleKey?: (key: string) => boolean,
): Promise<void> {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set(
        focuses.flatMap(focus => focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName)),
    )).filter(iconName => !hasStyleKey?.(getFocusIconStyleKey(iconName)));

    for (let start = 0; start < uniqueIconNames.length; start += focusTreeRenderCancellationBatchSize) {
        uniqueIconNames
            .slice(start, start + focusTreeRenderCancellationBatchSize)
            .forEach(iconName => {
                styleTable.style('focus-icon-' + normalizeForStyle(iconName), () => `
                    width: ${focusPlaceholderSize}px;
                    height: ${focusPlaceholderSize}px;
                    background: grey;
                    ${focusIconStateProperty}: placeholder;
                `);
            });
        if (start + focusTreeRenderCancellationBatchSize < uniqueIconNames.length) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        } else {
            throwIfFocusTreeRenderCancelled(isCancelled);
        }
    }

    const uniqueOverlayNames = Array.from(new Set(
        focuses.map(focus => focus.overlay).filter((overlayName): overlayName is string => !!overlayName),
    )).filter(overlayName => !hasStyleKey?.(getFocusOverlayStyleKey(overlayName)));
    for (let start = 0; start < uniqueOverlayNames.length; start += focusTreeRenderCancellationBatchSize) {
        uniqueOverlayNames
            .slice(start, start + focusTreeRenderCancellationBatchSize)
            .forEach(overlayName => {
                styleTable.style('focus-overlay-' + normalizeForStyle(overlayName), () => '');
            });
        if (start + focusTreeRenderCancellationBatchSize < uniqueOverlayNames.length) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        } else {
            throwIfFocusTreeRenderCancelled(isCancelled);
        }
    }

    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => `
        width: ${focusPlaceholderSize}px;
        height: ${focusPlaceholderSize}px;
        background: grey;
    `);
}

type FocusIconResolution =
    | { kind: 'resolved-files'; image: Image }
    | { kind: 'default'; image: Image | undefined };

async function resolveFocusIcon(name: string, mappedGfxFile?: string, isUnresolved: boolean = false): Promise<FocusIconResolution> {
    if (mappedGfxFile && !isUnresolved) {
        const resolvedFileSprite = await getSpriteByGfxNameFromResolvedFiles(name, [mappedGfxFile]);
        if (resolvedFileSprite !== undefined) {
            return {
                kind: 'resolved-files',
                image: resolvedFileSprite.image,
            };
        }
    }

    return {
        kind: 'default',
        image: await getImageByPath(defaultFocusIcon),
    };
}
