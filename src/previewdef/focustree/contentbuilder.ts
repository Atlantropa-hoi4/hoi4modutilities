import * as vscode from 'vscode';
import { FocusTree, Focus } from './schema';
import type { FocusWarning } from './schema';
import { getSpriteByGfxName, getSpriteByGfxNameFromResolvedFiles, Image, getImageByPath } from '../../util/image/imagecache';
import { localize, i18nTableAsScript } from '../../util/i18n';
import { forceError, NumberPosition } from '../../util/common';
import { GridBoxType, ButtonType, IconType } from '../../hoiformat/gui';
import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { html, htmlEscape } from '../../util/html';
import { FocusTreeLoader } from './loader';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { featureFlagsAsScript, isLocalisationIndexEnabled, isUseConditionInFocusEnabled } from '../../util/featureflags';
import { ParentInfo, calculateBBox } from '../../util/hoi4gui/common';
import { RenderChildTypeMap, RenderContainerWindowOptions, renderContainerWindow } from '../../util/hoi4gui/containerwindow';
import { renderSprite } from '../../util/hoi4gui/nodecommon';
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
    renderFocusHtmlTemplate,
    resolveFocusLocalizationTextByIdIfReady,
} from './focusrender';
import { sortFocusWarnings } from './focuslint';
import { createLocalisedTextQuickIfReadyResolver, isLocalisationIndexReady } from '../../util/localisationIndex';
import {
    focusTreeRenderCancellationBatchSize,
    throwIfFocusTreeRenderCancelled,
    yieldToFocusTreeRenderCancellation,
} from './rendercancellation';

const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';
const focusToolbarHeight = 68;
const focusTreeAssetRenderBatchSize = 32;

export interface FocusTreeRenderPayload {
    focusTrees: FocusTree[];
    selectedTreeId?: string;
    renderedFocus: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    gfxFiles: string[];
    focusIconGfxFileByName: Record<string, string>;
    focusIconAssetResolution: FocusIconAssetResolution;
    focusIconStyleSignature: string;
    gridBox: HOIPartial<GridBoxType>;
    dynamicStyleCss: string;
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
    focusTrees: FocusTree[];
    allFocuses: Focus[];
    allInlays: FocusTree["inlayWindows"][number][];
    focusById: Record<string, Focus>;
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
}

export async function renderFocusTreeFile(
    loader: FocusTreeLoader,
    uri: vscode.Uri,
    webview: vscode.Webview,
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree = {},
): Promise<string> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const renderState = await buildFocusTreeRenderState(loader, documentVersion, conditionPresetsByTree);
        if (renderState.payload.focusTrees.length === 0) {
            const baseContent = localize('focustree.nofocustree', 'No focus tree.');
            return html(webview, baseContent, [setPreviewFileUriScript], []);
        }

        return renderFocusTreeHtmlFromPayload(uri, webview, renderState.payload);

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return html(webview, baseContent, [setPreviewFileUriScript], []);
    }
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

export async function buildFocusTreeRenderPayload(
    loader: FocusTreeLoader,
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree = {},
): Promise<FocusTreeRenderPayload> {
    const baseState = await buildFocusTreeRenderBaseState(loader, documentVersion, conditionPresetsByTree);
    return (await buildFocusTreeRenderPayloadFromBaseState(baseState)).payload;
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
        allFocuses,
        allInlays,
        focusById,
        gfxFiles: loadResult.result.gfxFiles,
        focusIconGfxFileByName: loadResult.result.focusIconGfxFileByName,
        focusIconAssetResolution: loadResult.result.focusIconAssetResolution,
        focusIconStyleSignature: loadResult.result.focusIconAssetResolution.styleSignature,
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

export async function buildFocusTreeRenderPayloadFromBaseState(
    baseState: FocusTreeRenderBaseState,
    isCancelled?: () => boolean,
): Promise<{ payload: FocusTreeRenderPayload; metrics: FocusTreeRenderPayloadBuildMetrics }> {
    throwIfFocusTreeRenderCancelled(isCancelled);
    resolveSearchFilterLabels(baseState.focusTrees);
    const focusIconAssetResolution = baseState.focusIconAssetResolution ?? createEmptyFocusIconAssetResolution();
    const focusIconStyleSignature = baseState.focusIconStyleSignature ?? focusIconAssetResolution.styleSignature;
    const styleTable = new StyleTable();
    const maxFocusIconWidth = Math.max(baseState.xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    ensureFocusTemplateStyles(styleTable, maxFocusIconWidth, maxFocusIconHeight);
    const focusRenderStart = Date.now();
    const focusIconStyleStart = Date.now();
    if (baseState.deferredAssetLoad) {
        await prepareDeferredFocusIconStyles(
            baseState.allFocuses,
            styleTable,
            baseState.xGridSize,
            baseState.yGridSize,
            isCancelled,
        );
    } else {
        await prepareFocusIconStyles(
            baseState.allFocuses,
            styleTable,
            focusIconAssetResolution,
            baseState.xGridSize,
            baseState.yGridSize,
            isCancelled,
        );
    }
    throwIfFocusTreeRenderCancelled(isCancelled);
    const focusIconStyleDurationMs = Date.now() - focusIconStyleStart;
    const localisationResolveStart = Date.now();
    const focusLocalizationTextById = await resolveFocusLocalizationTextByIdIfReady(
        baseState.allFocuses,
        undefined,
        isCancelled,
    );
    refreshUnsupportedLocalisationWarnings(baseState.focusTrees, focusLocalizationTextById);
    throwIfFocusTreeRenderCancelled(isCancelled);
    const localisationResolveDurationMs = Date.now() - localisationResolveStart;
    const focusTemplateRenderStart = Date.now();
    const renderedFocus: Record<string, string> = {};
    for (let index = 0; index < baseState.allFocuses.length; index += 1) {
        if (index > 0 && index % focusTreeRenderCancellationBatchSize === 0) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        }

        const focus = baseState.allFocuses[index];
        renderedFocus[focus.id] = renderFocusHtmlTemplate(
            focus,
            styleTable,
            baseState.focusPositionActiveFile,
            baseState.xGridSize,
            baseState.yGridSize,
            focusLocalizationTextById[focus.id],
        ).replace(/\s\s+/g, ' ');
    }
    const focusTemplateRenderDurationMs = Date.now() - focusTemplateRenderStart;
    const focusRenderDurationMs = Date.now() - focusRenderStart;

    const inlayRenderStart = Date.now();
    let inlayStyleDurationMs = 0;
    const renderedInlayWindows: Record<string, string> = {};
    if (!baseState.deferredAssetLoad) {
        const inlayStyleStart = Date.now();
        await prepareInlayGfxStyles(baseState.focusTrees, styleTable, isCancelled);
        throwIfFocusTreeRenderCancelled(isCancelled);
        inlayStyleDurationMs = Date.now() - inlayStyleStart;
        for (let start = 0; start < baseState.allInlays.length; start += focusTreeAssetRenderBatchSize) {
            const inlays = baseState.allInlays.slice(start, start + focusTreeAssetRenderBatchSize);
            await Promise.all(inlays.map(async inlay => {
                renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, baseState.gfxFiles)).replace(/\s\s+/g, ' ');
            }));
            if (start + focusTreeAssetRenderBatchSize < baseState.allInlays.length) {
                await yieldToFocusTreeRenderCancellation(isCancelled);
            } else {
                throwIfFocusTreeRenderCancelled(isCancelled);
            }
        }
    }
    const inlayRenderDurationMs = Date.now() - inlayRenderStart;
    throwIfFocusTreeRenderCancelled(isCancelled);

    return {
        payload: {
            focusTrees: baseState.focusTrees,
            selectedTreeId: baseState.focusTrees[0]?.id,
            renderedFocus,
            renderedInlayWindows,
            gfxFiles: baseState.gfxFiles,
            focusIconGfxFileByName: baseState.focusIconGfxFileByName,
            focusIconAssetResolution,
            focusIconStyleSignature,
            gridBox: baseState.gridBox,
            dynamicStyleCss: styleTable.toStyleContent(),
            styleNonce: Math.random().toString(36).slice(2),
            xGridSize: baseState.xGridSize,
            yGridSize: baseState.yGridSize,
            focusToolbarHeight,
            focusPositionDocumentVersion: baseState.focusPositionDocumentVersion,
            focusPositionActiveFile: baseState.focusPositionActiveFile,
            conditionPresetsByTree: baseState.conditionPresetsByTree,
            hasFocusSelector: baseState.hasFocusSelector,
            hasWarningsButton: hasFocusTreeWarnings(baseState.focusTrees),
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
            deferredAssetLoad: baseState.deferredAssetLoad,
        },
    };
}

export function resolveSearchFilterLabels(focusTrees: FocusTree[]): void {
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

async function buildFocusTreeRenderState(
    loader: FocusTreeLoader,
    documentVersion: number,
    conditionPresetsByTree: FocusConditionPresetsByTree,
): Promise<{ payload: FocusTreeRenderPayload; body: string; scripts: string[] }> {
    const baseState = await buildFocusTreeRenderBaseState(loader, documentVersion, conditionPresetsByTree);
    const { payload } = await buildFocusTreeRenderPayloadFromBaseState(baseState);
    const scripts = buildFocusTreeBootstrapScripts(payload);
    scripts.push(i18nTableAsScript());
    return {
        payload,
        body: renderFocusTreeBody(payload),
        scripts,
    };
}

export async function renderFocusTreeFocusHtmlMap(
    baseState: FocusTreeRenderBaseState,
    focusIds: readonly string[],
): Promise<Record<string, string>> {
    const styleTable = new StyleTable();
    const renderedFocus: Record<string, string> = {};
    const focuses = focusIds
        .map(focusId => baseState.focusById[focusId])
        .filter((focus): focus is Focus => !!focus);
    const focusLocalizationTextById = await resolveFocusLocalizationTextByIdIfReady(focuses);
    for (const focus of focuses) {
        renderedFocus[focus.id] = renderFocusHtmlTemplate(
            focus,
            styleTable,
            baseState.focusPositionActiveFile,
            baseState.xGridSize,
            baseState.yGridSize,
            focusLocalizationTextById[focus.id],
        ).replace(/\s\s+/g, ' ');
    }

    return renderedFocus;
}

export async function renderFocusTreeInlayHtmlMap(
    baseState: FocusTreeRenderBaseState,
    inlayIds: readonly string[],
): Promise<Record<string, string>> {
    const styleTable = new StyleTable();
    await prepareInlayGfxStyles(baseState.focusTrees, styleTable);
    const renderedInlayWindows: Record<string, string> = {};
    for (const inlayId of inlayIds) {
        const inlay = baseState.allInlays.find(currentInlay => currentInlay.id === inlayId);
        if (!inlay) {
            continue;
        }

        renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, baseState.gfxFiles)).replace(/\s\s+/g, ' ');
    }

    return renderedInlayWindows;
}

function buildFocusTreeBootstrapScripts(payload: FocusTreeRenderPayload): string[] {
    return [
        'window.focusTrees = ' + JSON.stringify(payload.focusTrees),
        'window.bootstrapSelectedFocusTreeId = ' + JSON.stringify(payload.selectedTreeId),
        'window.focusTreeTraceEnabled = ' + JSON.stringify(process.env.HOI4MU_FOCUSTREE_TRACE === '1'),
        'window.renderedFocus = ' + JSON.stringify(payload.renderedFocus),
        'window.renderedInlayWindows = ' + JSON.stringify(payload.renderedInlayWindows),
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
        selectedTreeId: undefined,
        renderedFocus: {},
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
        `)}">Continuous focuses</div>`;

    styleTable.raw('#focustreeplaceholder', 'pointer-events: none;');
    styleTable.raw('#focustreeplaceholder [data-focus-id], #focustreeplaceholder [data-focus-id] *, #focustreeplaceholder .navigator, #focustreeplaceholder .navigator *', 'pointer-events: auto;');
    styleTable.raw('#inlaywindowplaceholder', 'pointer-events: none;');
    styleTable.raw('#inlaywindowplaceholder .navigator, #inlaywindowplaceholder .navigator *, #inlaywindowplaceholder button, #inlaywindowplaceholder button *', 'pointer-events: auto;');

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
        renderToolBar(payload, styleTable);
    const shellCss = styleTable.toStyleContent();

    return (
        `<style id="focus-tree-shell-style" nonce="${payload.styleNonce}">${shellCss}</style>` +
        `<style id="focus-tree-dynamic-style" nonce="${payload.styleNonce}">${payload.dynamicStyleCss}</style>` +
        shellMarkup
    );
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
    <div id="warnings-container" class="${styleTable.style('warnings-container', () => `
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
        <div id="warnings" class="${styleTable.style('warnings', () => `
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
            />
        </div>`;

    const searchFilters = `
        <div id="search-filters-container" class="${toolbarGroupStyle()}">
            <label for="search-filters" class="${toolbarLabelStyle()}">${localize('focustree.searchfilters', 'Filters: ')}</label>
            <div class="select-container">
                <div id="search-filters" class="select multiple-select ${styleTable.style('searchFilters', () => `min-width:120px; max-width:260px;`)}" tabindex="0" role="combobox" aria-multiselectable="true">
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
        <button id="show-warnings" title="${localize('focustree.warnings', 'Toggle warnings')}" style="${payload.hasWarningsButton ? '' : 'display:none;'}">
            <i class="codicon codicon-warning"></i>
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
            const frame = sprite?.frames[0];
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

async function prepareFocusIconStyles(
    focuses: readonly Focus[],
    styleTable: StyleTable,
    focusIconAssetResolution: FocusIconAssetResolution,
    xGridSize: number,
    yGridSize: number,
    isCancelled?: () => boolean,
): Promise<void> {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set(
        focuses.flatMap(focus => [
            ...focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName),
            ...(focus.searchFilters ?? []).map(filter => `GFX_${filter}`),
        ]),
    ));
    const unresolvedIconNames = new Set(focusIconAssetResolution.unresolvedIconNames);
    const iconDiagnostics = {
        resolvedFromResolvedFilesCount: 0,
        defaultFallbackCount: 0,
        unresolvedGfxNames: [] as string[],
    };

    for (let start = 0; start < uniqueIconNames.length; start += focusTreeAssetRenderBatchSize) {
        const iconNames = uniqueIconNames.slice(start, start + focusTreeAssetRenderBatchSize);
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
                ? fitFocusIconToBounds(iconResolution.image.width, iconResolution.image.height, maxFocusIconWidth, maxFocusIconHeight)
                : { width: focusPlaceholderSize, height: focusPlaceholderSize };

            styleTable.style('focus-icon-' + normalizeForStyle(iconName), () => `
                width: ${displaySize.width}px;
                height: ${displaySize.height}px;
                background-repeat: no-repeat;
                background-size: contain;
                ${iconResolution.image ? `background-image: url(${iconResolution.image.uri});` : 'background: grey;'}
            `);
        }));
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
        await Promise.all(overlayNames.map(async overlayName => {
            const gfxFile = focusIconAssetResolution.gfxFileByIconName[overlayName];
            const overlaySprite = gfxFile
                ? await getSpriteByGfxNameFromResolvedFiles(overlayName, [gfxFile])
                : undefined;
            styleTable.style('focus-overlay-' + normalizeForStyle(overlayName), () =>
                overlaySprite ? `background-image: url(${overlaySprite.image.uri});` : '');
        }));
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

async function prepareDeferredFocusIconStyles(
    focuses: readonly Focus[],
    styleTable: StyleTable,
    xGridSize: number,
    yGridSize: number,
    isCancelled?: () => boolean,
): Promise<void> {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set(
        focuses.flatMap(focus => focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName)),
    ));

    for (let start = 0; start < uniqueIconNames.length; start += focusTreeRenderCancellationBatchSize) {
        uniqueIconNames
            .slice(start, start + focusTreeRenderCancellationBatchSize)
            .forEach(iconName => {
                styleTable.style('focus-icon-' + normalizeForStyle(iconName), () => `
                    width: ${focusPlaceholderSize}px;
                    height: ${focusPlaceholderSize}px;
                    background: grey;
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
    ));
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

export async function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined> {
    const resolvedFileSprite = await getSpriteByGfxNameFromResolvedFiles(name, gfxFiles);
    return resolvedFileSprite?.image ?? (await getImageByPath(defaultFocusIcon));
}
