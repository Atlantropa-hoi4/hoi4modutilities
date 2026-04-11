import * as vscode from 'vscode';
import { FocusTree, Focus } from './schema';
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
import { useConditionInFocus } from '../../util/featureflags';
import { ParentInfo, calculateBBox } from '../../util/hoi4gui/common';
import { RenderChildTypeMap, RenderContainerWindowOptions, renderContainerWindow } from '../../util/hoi4gui/containerwindow';
import { renderSprite } from '../../util/hoi4gui/nodecommon';
import { renderInstantTextBox } from '../../util/hoi4gui/instanttextbox';
import { fitFocusIconToBounds } from './focusiconlayout';
import { FocusConditionPresetsByTree } from './conditionpresets';
import {
    focusDefaultPlaceholderSize,
    focusIconBottomGap,
    focusIconSidePadding,
    focusIconTopOffset,
    focusTextMarginTop,
    renderFocusHtmlTemplate,
} from './focusrender';

const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';
const focusToolbarHeight = 68;

export interface FocusTreeRenderPayload {
    focusTrees: FocusTree[];
    selectedTreeId?: string;
    renderedFocus: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
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
}

export interface FocusTreeRenderBaseState {
    focusTrees: FocusTree[];
    allFocuses: Focus[];
    allInlays: FocusTree["inlayWindows"][number][];
    focusById: Record<string, Focus>;
    gfxFiles: string[];
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
}

export interface FocusTreeRenderPayloadBuildMetrics {
    focusRenderDurationMs: number;
    inlayRenderDurationMs: number;
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
): Promise<FocusTreeRenderBaseState> {
    const session = new LoaderSession(false);
    const loadStart = Date.now();
    const loadResult = await loader.load(session);
    const loadDurationMs = Date.now() - loadStart;
    const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
    debug('Loader session focus tree', loadedLoaders);

    const focusTrees = loadResult.result.focusTrees;
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
    };
}

export async function buildFocusTreeRenderPayloadFromBaseState(
    baseState: FocusTreeRenderBaseState,
): Promise<{ payload: FocusTreeRenderPayload; metrics: FocusTreeRenderPayloadBuildMetrics }> {
    const styleTable = new StyleTable();
    const focusRenderStart = Date.now();
    if (baseState.deferredAssetLoad) {
        prepareDeferredFocusIconStyles(baseState.allFocuses, styleTable, baseState.xGridSize, baseState.yGridSize);
    } else {
        await prepareFocusIconStyles(baseState.allFocuses, styleTable, baseState.gfxFiles, baseState.xGridSize, baseState.yGridSize);
    }
    const renderedFocus: Record<string, string> = {};
    for (const focus of baseState.allFocuses) {
        renderedFocus[focus.id] = renderFocusHtmlTemplate(
            focus,
            styleTable,
            baseState.focusPositionActiveFile,
            baseState.xGridSize,
            baseState.yGridSize,
        ).replace(/\s\s+/g, ' ');
    }
    const focusRenderDurationMs = Date.now() - focusRenderStart;

    const inlayRenderStart = Date.now();
    const renderedInlayWindows: Record<string, string> = {};
    if (!baseState.deferredAssetLoad) {
        await prepareInlayGfxStyles(baseState.focusTrees, styleTable);
        await Promise.all(baseState.allInlays.map(async (inlay) => {
            renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, baseState.gfxFiles)).replace(/\s\s+/g, ' ');
        }));
    }
    const inlayRenderDurationMs = Date.now() - inlayRenderStart;

    return {
        payload: {
        focusTrees: baseState.focusTrees,
        selectedTreeId: baseState.focusTrees[0]?.id,
        renderedFocus,
        renderedInlayWindows,
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
        hasWarningsButton: baseState.hasWarningsButton,
        deferredAssetLoad: baseState.deferredAssetLoad,
    },
        metrics: {
            focusRenderDurationMs,
            inlayRenderDurationMs,
        },
    };
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

export function renderFocusTreeFocusHtmlMap(
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
        'window.useConditionInFocus = ' + useConditionInFocus,
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
    return {
        focusTrees: [],
        selectedTreeId: undefined,
        renderedFocus: {},
        renderedInlayWindows: {},
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
        gap: 4px;
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--vscode-panel-border);
        background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background));
        color: var(--vscode-editor-foreground);
        text-align: left;
        font: inherit;
        cursor: pointer;
    `);
    const warningEntryMutedClass = styleTable.style('warnings-entry-muted', () => `
        cursor: default;
        opacity: 0.92;
    `);
    const warningMetaClass = styleTable.style('warnings-entry-meta', () => `
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
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
            gap: 8px;
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

    const editToggle = `
        <div class="${styleTable.style('toolbarIconGroup', () => `display:flex; align-items:center;`) }">
            <button
                id="focus-position-edit"
                title="${localize('TODO', 'Toggle focus position editing')}"
                class="${styleTable.style('focusPositionEditButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0;`)}"
            ><i class="codicon codicon-edit"></i></button>
        </div>`;

    const inlayWindows = `
        <div id="inlay-window-container" class="${toolbarGroupStyle()}">
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

    return `<div class="toolbar-outer ${styleTable.style('toolbar-height', () => `box-sizing: border-box; min-height:${focusToolbarHeight}px; padding: 4px 6px;`)}">
        <div class="toolbar ${styleTable.style('toolbarAlign', () => `display:flex; flex-direction:column; align-items:stretch; gap:4px;`) }">
            <div class="${styleTable.style('toolbarRow', () => `display:flex; align-items:center; gap:10px;`) }">
                ${focuses}
                ${searchbox}
                ${editToggle}
            </div>
            <div class="${styleTable.style('toolbarRow', () => `display:flex; align-items:center; flex-wrap:wrap; gap:10px;`) }">
                ${useConditionInFocus ? conditionPresets + conditions : allowbranch}
                ${inlayWindows}
                ${warningsButton}
            </div>
        </div>
    </div>`;
}

function getInlayGfxStyleKey(gfxName: string | undefined, gfxFile: string | undefined) {
    return 'inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}

async function prepareInlayGfxStyles(focusTrees: FocusTree[], styleTable: StyleTable): Promise<void> {
    const processed = new Set<string>();
    for (const focusTree of focusTrees) {
        for (const inlay of focusTree.inlayWindows) {
            for (const slot of inlay.scriptedImages) {
                for (const option of slot.gfxOptions) {
                    const key = getInlayGfxStyleKey(option.gfxName, option.gfxFile);
                    if (processed.has(key)) {
                        continue;
                    }
                    processed.add(key);

                    if (!option.gfxFile) {
                        styleTable.style(key, () => `
                            width: 96px;
                            height: 96px;
                            background: rgba(127, 127, 127, 0.35);
                            border: 1px dashed var(--vscode-panel-border);
                        `);
                        continue;
                    }

                    const sprite = await getSpriteByGfxName(option.gfxName, option.gfxFile);
                    const frame = sprite?.frames[0];
                    if (!frame) {
                        styleTable.style(key, () => `
                            width: 96px;
                            height: 96px;
                            background: rgba(127, 127, 127, 0.35);
                            border: 1px dashed var(--vscode-panel-border);
                        `);
                        continue;
                    }

                    styleTable.style(key, () => `
                        width: ${Math.min(frame.width, 144)}px;
                        height: ${Math.min(frame.height, 144)}px;
                        background-image: url(${frame.uri});
                        background-repeat: no-repeat;
                        background-position: center;
                        background-size: contain;
                    `);
                }
            }
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
            getSprite: (sprite) => getSpriteByGfxName(sprite, gfxFiles),
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
    gfxFiles: string[],
    xGridSize: number,
    yGridSize: number,
): Promise<void> {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set(
        focuses.flatMap(focus => focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName)),
    ));
    const iconDiagnostics = {
        resolvedFromResolvedFilesCount: 0,
        resolvedFromGfxScanCount: 0,
        defaultFallbackCount: 0,
        unresolvedGfxNames: [] as string[],
    };

    await Promise.all(uniqueIconNames.map(async iconName => {
        const iconResolution = await resolveFocusIcon(iconName, gfxFiles);
        if (iconResolution.kind === 'resolved-files') {
            iconDiagnostics.resolvedFromResolvedFilesCount += 1;
        } else if (iconResolution.kind === 'gfx-scan') {
            iconDiagnostics.resolvedFromGfxScanCount += 1;
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
            ${iconResolution.image ? `background-image: url(${iconResolution.image.uri});` : 'background: grey;'}
        `);
    }));

    debug('Focus tree icon diagnostics', {
        resolvedFromResolvedFilesCount: iconDiagnostics.resolvedFromResolvedFilesCount,
        resolvedFromGfxScanCount: iconDiagnostics.resolvedFromGfxScanCount,
        defaultFallbackCount: iconDiagnostics.defaultFallbackCount,
        unresolvedGfxNames: iconDiagnostics.unresolvedGfxNames.slice(0, 20),
    });

    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => `
        width: ${focusPlaceholderSize}px;
        height: ${focusPlaceholderSize}px;
        background: grey;
    `);
}

function prepareDeferredFocusIconStyles(
    focuses: readonly Focus[],
    styleTable: StyleTable,
    xGridSize: number,
    yGridSize: number,
): void {
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const focusPlaceholderSize = Math.max(1, Math.min(focusDefaultPlaceholderSize, maxFocusIconWidth, maxFocusIconHeight));
    const uniqueIconNames = Array.from(new Set(
        focuses.flatMap(focus => focus.icon.map(focusIcon => focusIcon.icon).filter((iconName): iconName is string => !!iconName)),
    ));

    uniqueIconNames.forEach(iconName => {
        styleTable.style('focus-icon-' + normalizeForStyle(iconName), () => `
            width: ${focusPlaceholderSize}px;
            height: ${focusPlaceholderSize}px;
            background: grey;
        `);
    });

    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => `
        width: ${focusPlaceholderSize}px;
        height: ${focusPlaceholderSize}px;
        background: grey;
    `);
}

type FocusIconResolution =
    | { kind: 'resolved-files'; image: Image }
    | { kind: 'gfx-scan'; image: Image }
    | { kind: 'default'; image: Image | undefined };

async function resolveFocusIcon(name: string, gfxFiles: string[]): Promise<FocusIconResolution> {
    const resolvedFileSprite = await getSpriteByGfxNameFromResolvedFiles(name, gfxFiles);
    if (resolvedFileSprite !== undefined) {
        return {
            kind: 'resolved-files',
            image: resolvedFileSprite.image,
        };
    }

    const scannedSprite = await getSpriteByGfxName(name, gfxFiles);
    if (scannedSprite !== undefined) {
        return {
            kind: 'gfx-scan',
            image: scannedSprite.image,
        };
    }

    return {
        kind: 'default',
        image: await getImageByPath(defaultFocusIcon),
    };
}

export async function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined> {
    return (await resolveFocusIcon(name, gfxFiles)).image;
}
