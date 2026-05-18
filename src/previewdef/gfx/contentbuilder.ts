import * as vscode from 'vscode';
import { getImageByPath } from '../../util/image/imagecache';
import { localize } from '../../util/i18n';
import { html, htmlAttributeEscape, htmlEscape, htmlTextEscape } from '../../util/html';
import { StyleTable } from '../../util/styletable';
import { forceError } from '../../util/common';
import { extractUiShaderSpriteBindings } from '../uishader/gfxbinding';
import { buildUiShaderPreviewModel } from '../uishader/model';
import { UiShaderPreviewModel, UiShaderSpriteBinding } from '../uishader/types';

export interface RenderedGfxFile {
    html: string;
    dependencies: string[];
}

export async function renderGfxFile(fileContent: string, uri: vscode.Uri, webview: vscode.Webview): Promise<RenderedGfxFile> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const spriteTypes = extractUiShaderSpriteBindings(fileContent, localize('infile', 'In file {0}:\n', uri.toString()));
        const shaderPreviewModels = await buildShaderPreviewModels(spriteTypes, uri.toString());
        const styleTable = new StyleTable();
        const baseContent = await renderSpriteTypes(spriteTypes, shaderPreviewModels, styleTable);
        return {
            html: html(
                webview,
                baseContent,
                [
                    setPreviewFileUriScript,
                    { content: `window.uiShaderPreviewModels = ${safeJson(shaderPreviewModels)};` },
                    'gfx.js',
                    'uishaderpreview.js',
                ],
                [
                    'common.css',
                    styleTable,
                ],
            ),
            dependencies: collectShaderPreviewDependencies(shaderPreviewModels),
        };

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return {
            html: html(webview, baseContent, [ setPreviewFileUriScript ], []),
            dependencies: [],
        };
    }
}

async function buildShaderPreviewModels(spriteTypes: UiShaderSpriteBinding[], gfxFile: string): Promise<Record<string, UiShaderPreviewModel>> {
    const entries = await Promise.all(spriteTypes.map(async spriteType => {
        const model = await buildUiShaderPreviewModel(spriteType, gfxFile);
        return model ? [spriteType.name, model] as const : undefined;
    }));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, UiShaderPreviewModel] => !!entry));
}

function collectShaderPreviewDependencies(shaderPreviewModels: Record<string, UiShaderPreviewModel>): string[] {
    return Array.from(new Set(Object.values(shaderPreviewModels).flatMap(model => model.dependencies)));
}

async function renderSpriteTypes(
    spriteTypes: UiShaderSpriteBinding[],
    shaderPreviewModels: Record<string, UiShaderPreviewModel>,
    styleTable: StyleTable,
): Promise<string> {
    const imageList = (await Promise.all(spriteTypes.map(st => renderSpriteType(st, shaderPreviewModels[st.name], styleTable)))).join('');
    const shaderPanel = renderShaderVisualPanel(shaderPreviewModels, styleTable);
    const filter = `<div
    class="${styleTable.style('filterBar', () => `
        position: fixed;
        padding-top: 10px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
    `)}">
        <label for="filter" class="${styleTable.style('filterLabel', () => `margin-right:5px`)}">${localize('gfx.filter', 'Filter: ')}</label>
        <input
            id="filter"
            type="text"
        />
    </div>`;

    return `${filter}
    ${shaderPanel}
    <div class="${styleTable.style('imageList', () => `margin-top: ${Object.keys(shaderPreviewModels).length > 0 ? 12 : 40}px`)}">
        ${imageList}
    </div>`;
}

async function renderSpriteType(
    spriteType: UiShaderSpriteBinding,
    shaderPreviewModel: UiShaderPreviewModel | undefined,
    styleTable: StyleTable,
): Promise<string> {
    const image = await getImageByPath(spriteType.texturefile);
    const shaderPreview = shaderPreviewModel ? renderShaderPreviewTrigger(spriteType, shaderPreviewModel, styleTable) : '';
    const titleText = `${spriteType.name}${image ? ` (${image.width / spriteType.noOfFrames}x${image.height}x${spriteType.noOfFrames})` : ''}\n${image ? image.path : localize('gfx.imagenotfound', 'Image not found')}`;
    return `<div
        id="${htmlAttributeEscape(spriteType.name)}"
        class="
            spriteTypePreview
            navigator
            ${styleTable.style('spriteTypePreview', () => `
                display: inline-block;
                text-align: center;
                margin: 10px;
                cursor: pointer;
            `)}
        "
        start="${spriteType.tokenStart ?? ''}"
        end="${spriteType.tokenEnd ?? ''}"
        title="${htmlAttributeEscape(titleText)}">
        ${image ? `<img src="${image.uri}" />` :
            `<div 
            class="${styleTable.style('missingImageOuter', () => `
                height: 100px;
                width: 100px;
                background: grey;
                margin: auto;
                display: table;
            `)}">
                <div class="${styleTable.style('missingImageInner', () => `display:table-cell;vertical-align:middle;color:black;`)}">
                    MISSING
                </div>
            </div>`}
        <p class="
            ${styleTable.style('imageName-common', () => `
                min-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0
            `)}
            ${styleTable.oneTimeStyle('imageName', () => `
                max-width: ${Math.max(image?.width || 100, 120)}px;
            `)}
        ">
            ${htmlEscape(spriteType.name)}
        </p>
        ${shaderPreview}
    </div>`;
}

function renderShaderVisualPanel(
    shaderPreviewModels: Record<string, UiShaderPreviewModel>,
    styleTable: StyleTable,
): string {
    return `<section
        id="uiShaderVisualPanel"
        class="${styleTable.style('uiShaderVisualPanel', () => `
            margin: 48px 10px 10px;
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
        `)}"
        data-model-count="${Object.keys(shaderPreviewModels).length}">
        <div id="uiShaderVisualPanelMount">${localize('gfx.uishader.loading', 'Loading UI shader preview...')}</div>
    </section>`;
}

function renderShaderPreviewTrigger(
    spriteType: UiShaderSpriteBinding,
    model: UiShaderPreviewModel,
    styleTable: StyleTable,
): string {
    const warnings = model.warnings.length > 0
        ? `<span class="${styleTable.style('uiShaderPreviewWarningBadge', () => `
            color: var(--vscode-editorWarning-foreground);
            margin-left: 4px;
        `)}" title="${htmlAttributeEscape(model.warnings.map(warning => warning.message).join('\n'))}">!</span>`
        : '';
    return `<button
        type="button"
        class="uiShaderPreviewTrigger ${styleTable.style('uiShaderPreviewTrigger', () => `
            display: block;
            margin: 6px auto 0;
            max-width: 240px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
        `)}"
        data-sprite-name="${htmlAttributeEscape(spriteType.name)}"
        data-status="${htmlAttributeEscape(model.status)}"
        data-template-id="${htmlAttributeEscape(model.templateId)}"
        title="${htmlAttributeEscape(model.supportReason)}">
        <span class="${styleTable.style('uiShaderPreviewTriggerLabel', () => `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 6px auto 0;
            max-width: 220px;
            font-size: 11px;
        `)}">Shader Preview: ${htmlTextEscape(model.templateId)}${warnings}</span>
    </button>`;
}

function safeJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}
