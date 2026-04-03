import * as vscode from 'vscode';
import { FocusTree, Focus } from './schema';
import { getSpriteByGfxName, Image, getImageByPath } from '../../util/image/imagecache';
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
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { localisationIndex } from "../../util/featureflags";
import { ParentInfo, calculateBBox } from '../../util/hoi4gui/common';
import { RenderChildTypeMap, RenderContainerWindowOptions, renderContainerWindow } from '../../util/hoi4gui/containerwindow';
import { renderSprite } from '../../util/hoi4gui/nodecommon';
import { renderInstantTextBox } from '../../util/hoi4gui/instanttextbox';

const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';
const focusToolbarHeight = 68;

export interface FocusTreeRenderPayload {
    focusTrees: FocusTree[];
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
    hasFocusSelector: boolean;
    hasWarningsButton: boolean;
}

export async function renderFocusTreeFile(loader: FocusTreeLoader, uri: vscode.Uri, webview: vscode.Webview, documentVersion: number): Promise<string> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const renderState = await buildFocusTreeRenderState(loader, documentVersion);
        if (renderState.payload.focusTrees.length === 0) {
            const baseContent = localize('focustree.nofocustree', 'No focus tree.');
            return html(webview, baseContent, [setPreviewFileUriScript], []);
        }

        return html(
            webview,
            renderState.body,
            [
                setPreviewFileUriScript,
                ...renderState.scripts.map(c => ({ content: c })),
                'common.js',
                'focustree.js',
            ],
            [
                'codicon.css',
                'common.css',
                { nonce: renderState.payload.styleNonce },
            ],
        );

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return html(webview, baseContent, [setPreviewFileUriScript], []);
    }
}

const leftPaddingBase = 50;
const topPaddingBase = 50;
const defaultXGridSize = 96;
const defaultYGridSize = 130;

function attributeEscape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export async function buildFocusTreeRenderPayload(
    loader: FocusTreeLoader,
    documentVersion: number,
): Promise<FocusTreeRenderPayload> {
    const session = new LoaderSession(false);
    const loadResult = await loader.load(session);
    const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
    debug('Loader session focus tree', loadedLoaders);

    const focusTrees = loadResult.result.focusTrees;
    const styleTable = new StyleTable();
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
    for (const tree of focusTrees) {
        allFocuses.push(...Object.values(tree.focuses));
        allInlays.push(...tree.inlayWindows);
    }

    const renderedFocus: Record<string, string> = {};
    await Promise.all(allFocuses.map(async (focus) => {
        renderedFocus[focus.id] = (await renderFocus(focus, styleTable, loadResult.result.gfxFiles, loader.file)).replace(/\s\s+/g, ' ');
    }));

    await prepareInlayGfxStyles(focusTrees, styleTable);
    const renderedInlayWindows: Record<string, string> = {};
    await Promise.all(allInlays.map(async (inlay) => {
        renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, loadResult.result.gfxFiles)).replace(/\s\s+/g, ' ');
    }));

    return {
        focusTrees,
        renderedFocus,
        renderedInlayWindows,
        gridBox,
        dynamicStyleCss: styleTable.toStyleContent(),
        styleNonce: Math.random().toString(36).slice(2),
        xGridSize,
        yGridSize,
        focusToolbarHeight,
        focusPositionDocumentVersion: documentVersion,
        focusPositionActiveFile: loader.file,
        hasFocusSelector: focusTrees.length > 1,
        hasWarningsButton: !focusTrees.every(ft => ft.warnings.length === 0),
    };
}

async function buildFocusTreeRenderState(
    loader: FocusTreeLoader,
    documentVersion: number,
): Promise<{ payload: FocusTreeRenderPayload; body: string; scripts: string[] }> {
    const payload = await buildFocusTreeRenderPayload(loader, documentVersion);
    const scripts = buildFocusTreeBootstrapScripts(payload);
    scripts.push(i18nTableAsScript());
    return {
        payload,
        body: renderFocusTreeBody(payload),
        scripts,
    };
}

function buildFocusTreeBootstrapScripts(payload: FocusTreeRenderPayload): string[] {
    return [
        'window.focusTrees = ' + JSON.stringify(payload.focusTrees),
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
    ];
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
            pointer-events: none;
            z-index: 0;
        `)}">Continuous focuses</div>`;

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
            <div id="focus-empty-state" class="${styleTable.oneTimeStyle('focusEmptyState', () => `
                position: absolute;
                top: 24px;
                left: 24px;
                display: none;
                padding: 10px 12px;
                background: rgba(127, 127, 127, 0.12);
                border: 1px dashed var(--vscode-panel-border);
                z-index: 4;
            `)}">${localize('TODO', 'No focuses match the current conditions.')}</div>
            ${continuousFocusContent}
        </div>` +
        renderFocusMinimapShell(styleTable, payload.focusToolbarHeight) +
        renderWarningContainer(styleTable) +
        renderToolBar(payload.focusTrees, styleTable);
    const shellCss = styleTable.toStyleContent();

    return (
        `<style id="focus-tree-shell-style" nonce="${payload.styleNonce}">${shellCss}</style>` +
        `<style id="focus-tree-dynamic-style" nonce="${payload.styleNonce}">${payload.dynamicStyleCss}</style>` +
        shellMarkup
    );
}

function renderFocusMinimapShell(styleTable: StyleTable, toolbarHeight: number): string {
    return `<div id="focus-minimap" class="${styleTable.oneTimeStyle('focusMinimap', () => `
        position: fixed;
        right: 12px;
        top: ${toolbarHeight + 12}px;
        width: 188px;
        max-height: calc(100vh - ${toolbarHeight + 24}px);
        display: flex;
        flex-direction: column;
        border: 1px solid var(--vscode-panel-border);
        background: color-mix(in srgb, var(--vscode-editor-background) 94%, transparent);
        backdrop-filter: blur(4px);
        z-index: 40;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
    `)}">
        <div class="${styleTable.oneTimeStyle('focusMinimapHeader', () => `
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 28px;
            padding: 4px 6px;
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 6px;
        `)}">
            <span>${localize('TODO', 'Minimap')}</span>
            <button id="toggle-focus-minimap" title="${localize('TODO', 'Collapse minimap')}">
                <i class="codicon codicon-chevron-down"></i>
            </button>
        </div>
        <div id="focus-minimap-body" class="${styleTable.oneTimeStyle('focusMinimapBody', () => `
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 6px;
        `)}">
            <div class="${styleTable.oneTimeStyle('focusMinimapActions', () => `
                display: flex;
                gap: 6px;
            `)}">
                <button id="jump-to-selected" class="${styleTable.oneTimeStyle('focusMinimapActionButton', () => `
                    flex: 1 1 0;
                    min-height: 24px;
                `)}">${localize('TODO', 'Jump to selected')}</button>
                <button id="jump-to-continuous" class="${styleTable.oneTimeStyle('focusMinimapActionButton', () => `
                    flex: 1 1 0;
                    min-height: 24px;
                `)}">${localize('TODO', 'Jump to continuous')}</button>
            </div>
            <div id="focus-minimap-canvas" class="${styleTable.oneTimeStyle('focusMinimapCanvas', () => `
                position: relative;
                width: 100%;
                height: 220px;
                overflow: hidden;
                border: 1px solid var(--vscode-panel-border);
                background: rgba(127, 127, 127, 0.08);
                cursor: pointer;
            `)}">
                <div id="focus-minimap-points" class="${styleTable.oneTimeStyle('focusMinimapPoints', () => `
                    position: absolute;
                    inset: 0;
                `)}"></div>
                <div id="focus-minimap-viewport" class="${styleTable.oneTimeStyle('focusMinimapViewport', () => `
                    position: absolute;
                    display: none;
                    border: 1px solid rgba(96, 196, 255, 0.95);
                    background: rgba(96, 196, 255, 0.15);
                    box-sizing: border-box;
                    pointer-events: none;
                `)}"></div>
                <div id="focus-minimap-tooltip" class="${styleTable.oneTimeStyle('focusMinimapTooltip', () => `
                    position: absolute;
                    display: none;
                    padding: 3px 6px;
                    border: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
                    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
                    pointer-events: none;
                    white-space: nowrap;
                    z-index: 1;
                `)}"></div>
            </div>
        </div>
    </div>`;
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

function renderToolBar(focusTrees: FocusTree[], styleTable: StyleTable): string {
    const toolbarGroupStyle = (marginRight: string = '10px') => styleTable.style('toolbarGroup', () => `display:flex; align-items:center; margin-right:${marginRight}; min-height:24px;`);
    const toolbarLabelStyle = (extra: string = '') => styleTable.style('toolbarLabel', () => `margin-right:5px; display:flex; align-items:center;${extra}`);

    const focuses = focusTrees.length <= 1 ? '' : `
        <div class="${toolbarGroupStyle()}">
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
                <div id="condition-presets" class="select multiple-select ${styleTable.style('conditionPresetLabel', () => `max-width:220px`)}" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
            <button
                id="save-condition-preset"
                title="${localize('TODO', 'Save current preset')}"
                class="${styleTable.style('conditionPresetIconButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0; margin-left:6px;`)}"
            ><i class="codicon codicon-save"></i></button>
            <button
                id="delete-condition-preset"
                title="${localize('TODO', 'Delete current preset')}"
                class="${styleTable.style('conditionPresetIconButton', () => `display:inline-flex; align-items:center; justify-content:center; height:20px; width:20px; padding:0; margin-left:4px;`)}"
            ><i class="codicon codicon-trash"></i></button>
        </div>`;

    const warningsButton = focusTrees.every(ft => ft.warnings.length === 0) ? '' : `
        <button id="show-warnings" title="${localize('focustree.warnings', 'Toggle warnings')}">
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
                ${useConditionInFocus ? conditionPresets : ''}
                ${useConditionInFocus ? conditions : allowbranch}
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

function ensureFocusStatusStyles(styleTable: StyleTable) {
    styleTable.raw('.focus-lint-badges', `
        position: absolute;
        top: 2px;
        left: 22px;
        display: flex;
        gap: 3px;
        flex-wrap: wrap;
        max-width: 96px;
        z-index: 1;
        pointer-events: none;
    `);
    styleTable.raw('.focus-lint-badge', `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 13px;
        min-width: 13px;
        padding: 0 4px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(48, 48, 48, 0.82);
        color: var(--vscode-editor-foreground);
        font-size: 9px;
        line-height: 1;
        white-space: nowrap;
        box-sizing: border-box;
        pointer-events: none;
    `);
    styleTable.raw('.focus-lint-badge-warning', `
        background: rgba(198, 120, 28, 0.88);
        border-color: rgba(198, 120, 28, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-lint-badge-info', `
        background: rgba(78, 98, 120, 0.84);
        border-color: rgba(108, 128, 150, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-badges', `
        position: absolute;
        top: 2px;
        right: 2px;
        display: flex;
        gap: 3px;
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 120px;
        z-index: 2;
        pointer-events: none;
    `);
    styleTable.raw('.focus-status-badge', `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 14px;
        padding: 0 4px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(32, 32, 32, 0.82);
        color: var(--vscode-editor-foreground);
        font-size: 9px;
        line-height: 1;
        white-space: nowrap;
        box-sizing: border-box;
        pointer-events: none;
    `);
    styleTable.raw('.focus-status-badge-available', `
        background: rgba(46, 160, 67, 0.9);
        border-color: rgba(46, 160, 67, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-badge-blocked', `
        background: rgba(201, 70, 56, 0.92);
        border-color: rgba(201, 70, 56, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-badge-branch', `
        background: rgba(40, 112, 214, 0.9);
        border-color: rgba(40, 112, 214, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-badge-capitulated', `
        background: rgba(182, 126, 22, 0.92);
        border-color: rgba(182, 126, 22, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-badge-prerequisite, .focus-status-badge-exclusive', `
        background: rgba(90, 90, 90, 0.88);
        border-color: rgba(120, 120, 120, 1);
        color: #ffffff;
    `);
    styleTable.raw('.focus-status-summary', `
        position: absolute;
        top: 20px;
        right: 0;
        display: none;
        min-width: 168px;
        max-width: 240px;
        padding: 6px 8px;
        border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
        background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
        color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
        text-align: left;
        white-space: pre-line;
        line-height: 1.35;
        z-index: 3;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    `);
    styleTable.raw('.navigator:hover .focus-status-summary, .navigator:focus-within .focus-status-summary', `
        display: block;
    `);
}

async function renderFocus(focus: Focus, styleTable: StyleTable, gfxFiles: string[], file: string): Promise<string> {
    ensureFocusStatusStyles(styleTable);

    for (const focusIcon of focus.icon) {
        const iconName = focusIcon.icon;
        const iconObject = iconName ? await getFocusIcon(iconName, gfxFiles) : null;
        styleTable.style('focus-icon-' + normalizeForStyle(iconName ?? '-empty'), () =>
            `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width : 0}px;`
        );
    }

    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => 'background: grey;');

    let textContent = focus.id;
    if (localisationIndex) {
        let localizedText = await getLocalisedTextQuick(focus.id);
        if (localizedText === focus.id || !localizedText) {
            if (focus.text) {
                localizedText = await getLocalisedTextQuick(focus.text);
                if (localizedText !== focus.text && localizedText !== null) {
                    textContent += `<br/>${localizedText}`;
                }
            }
        } else {
            textContent += `<br/>${localizedText}`;
        }
    }

    return `<div
    class="
        navigator
        {{iconClass}}
        ${styleTable.style('focus-common', () => `
            background-position-x: center;
            background-position-y: calc(50% - 18px);
            background-repeat: no-repeat;
            width: 100%;
            height: 100%;
            text-align: center;
            cursor: pointer;
            position: relative;
            overflow: visible;
        `)}
    "
    start="${focus.token?.start}"
    end="${focus.token?.end}"
    ${file === focus.file ? '' : `file="${focus.file}"`}
    data-focus-id="${attributeEscape(focus.id)}"
    data-focus-editable="${focus.isInCurrentFile && focus.layout?.editable === true ? 'true' : 'false'}"
    data-focus-source-file="${attributeEscape(focus.layout?.sourceFile ?? focus.file)}"
    title="${focus.id}\n({{position}})">
        {{lintBadges}}
        {{statusBadges}}
        {{statusSummary}}
        <div class="focus-checkbox ${styleTable.style('focus-checkbox', () => `position: absolute; top: 1px;`)}">
            <input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/>
        </div>
        <span
        class="${styleTable.style('focus-span', () => `
            margin: 10px -400px;
            margin-top: 85px;
            text-align: center;
            display: inline-block;
        `)}">
        ${textContent}
        </span>
    </div>`;
}

export async function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined> {
    const sprite = await getSpriteByGfxName(name, gfxFiles);
    if (sprite !== undefined) {
        return sprite.image;
    }

    return await getImageByPath(defaultFocusIcon);
}
