import * as vscode from 'vscode';
import { flatMap } from 'lodash';
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

export async function renderFocusTreeFile(loader: FocusTreeLoader, uri: vscode.Uri, webview: vscode.Webview, documentVersion: number): Promise<string> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const session = new LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
        debug('Loader session focus tree', loadedLoaders);

        const focustrees = loadResult.result.focusTrees;

        if (focustrees.length === 0) {
            const baseContent = localize('focustree.nofocustree', 'No focus tree.');
            return html(webview, baseContent, [setPreviewFileUriScript], []);
        }

        const styleTable = new StyleTable();
        const jsCodes: string[] = [];
        const styleNonce = Math.random().toString(36).slice(2);
        const baseContent = await renderFocusTrees(
            focustrees,
            styleTable,
            loadResult.result.gfxFiles,
            loadResult.result.focusSpacing,
            jsCodes,
            styleNonce,
            loader.file,
            documentVersion,
        );
        jsCodes.push(i18nTableAsScript());

        return html(
            webview,
            baseContent,
            [
                setPreviewFileUriScript,
                ...jsCodes.map(c => ({ content: c })),
                'common.js',
                'focustree.js',
            ],
            [
                'codicon.css',
                'common.css',
                styleTable,
                { nonce: styleNonce },
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

async function renderFocusTrees(
    focusTrees: FocusTree[],
    styleTable: StyleTable,
    gfxFiles: string[],
    focusSpacing: NumberPosition | undefined,
    jsCodes: string[],
    styleNonce: string,
    file: string,
    documentVersion: number,
): Promise<string> {
    const xGridSize = normalizeFocusSpacingValue(focusSpacing?.x, defaultXGridSize);
    const yGridSize = normalizeFocusSpacingValue(focusSpacing?.y, defaultYGridSize);
    const gridBox: HOIPartial<GridBoxType> = {
        position: { x: toNumberLike(leftPaddingBase), y: toNumberLike(topPaddingBase) },
        format: toStringAsSymbolIgnoreCase('up'),
        size: { width: toNumberLike(xGridSize), height: undefined },
        slotsize: { width: toNumberLike(xGridSize), height: toNumberLike(yGridSize) },
    } as HOIPartial<GridBoxType>;

    const renderedFocus: Record<string, string> = {};
    await Promise.all(flatMap(focusTrees, tree => Object.values(tree.focuses)).map(async (focus) => {
        renderedFocus[focus.id] = (await renderFocus(focus, styleTable, gfxFiles, file)).replace(/\s\s+/g, ' ');
    }));

    await prepareInlayGfxStyles(focusTrees, styleTable);
    const renderedInlayWindows: Record<string, string> = {};
    await Promise.all(flatMap(focusTrees, tree => tree.inlayWindows).map(async (inlay) => {
        renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, gfxFiles)).replace(/\s\s+/g, ' ');
    }));

    jsCodes.push('window.focusTrees = ' + JSON.stringify(focusTrees));
    jsCodes.push('window.renderedFocus = ' + JSON.stringify(renderedFocus));
    jsCodes.push('window.renderedInlayWindows = ' + JSON.stringify(renderedInlayWindows));
    jsCodes.push('window.gridBox = ' + JSON.stringify(gridBox));
    jsCodes.push('window.styleNonce = ' + JSON.stringify(styleNonce));
    jsCodes.push('window.useConditionInFocus = ' + useConditionInFocus);
    jsCodes.push('window.xGridSize = ' + xGridSize);
    jsCodes.push('window.yGridSize = ' + yGridSize);
    jsCodes.push('window.focusToolbarHeight = ' + focusToolbarHeight);
    jsCodes.push('window.focusPositionDocumentVersion = ' + JSON.stringify(documentVersion));
    jsCodes.push('window.focusPositionActiveFile = ' + JSON.stringify(file));

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

    return (
        `<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` +
        `<div id="focustreecontent" class="${styleTable.oneTimeStyle('focustreecontent', () => `top:${focusToolbarHeight}px;left:-20px;position:relative`)}">
            <div id="focustreeplaceholder" class="${styleTable.oneTimeStyle('focustreeplaceholder', () => `position: relative; z-index: 2;`)}"></div>
            <div id="inlaywindowplaceholder" class="${styleTable.oneTimeStyle('inlaywindowplaceholder', () => `position: relative; z-index: 3;`)}"></div>
            ${continuousFocusContent}
        </div>` +
        renderWarningContainer(styleTable) +
        renderToolBar(focusTrees, styleTable)
    );
}

function normalizeFocusSpacingValue(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function renderWarningContainer(styleTable: StyleTable) {
    styleTable.style('warnings', () => 'outline: none;', ':focus');
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
        <textarea id="warnings" readonly wrap="off" class="${styleTable.style('warnings', () => `
            height: 100%;
            width: 100%;
            font-family: 'Consolas', monospace;
            resize: none;
            background: var(--vscode-editor-background);
            padding: 10px;
            border-top: none;
            border-left: none;
            border-bottom: none;
            box-sizing: border-box;
        `)}"></textarea>
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
        <div class="${styleTable.style('toolbarIconGroup', () => `display:flex; align-items:center; margin-left:auto;`) }">
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

async function renderFocus(focus: Focus, styleTable: StyleTable, gfxFiles: string[], file: string): Promise<string> {
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
        `)}
    "
    start="${focus.token?.start}"
    end="${focus.token?.end}"
    ${file === focus.file ? '' : `file="${focus.file}"`}
    data-focus-id="${attributeEscape(focus.id)}"
    data-focus-editable="${focus.isInCurrentFile && focus.layout?.editable === true ? 'true' : 'false'}"
    data-focus-source-file="${attributeEscape(focus.layout?.sourceFile ?? focus.file)}"
    title="${focus.id}\n({{position}})">
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
