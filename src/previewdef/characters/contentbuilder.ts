import type * as vscode from 'vscode';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { forceError } from '../../util/common';
import { html, htmlAttributeEscape, htmlEscape, htmlTextEscape } from '../../util/html';
import { localize } from '../../util/i18n';
import { getLocalisedTextQuick } from '../../util/localisationIndex';
import { isLocalisationIndexEnabled } from '../../util/featureflags';
import { StyleTable } from '../../util/styletable';
import { CharacterPreviewItem, getCharactersFromFile } from './schema';
import {
    CharacterPortraitAssetResolver,
    createDefaultCharacterPortraitAssetResolver,
} from './portraitassets';

export interface CharacterPreviewRenderResult {
    html: string;
    dependencies: string[];
}

export interface CharacterPreviewBodyOptions {
    resolvePortraitAsset?: CharacterPortraitAssetResolver;
    resolveDisplayName?: (character: CharacterPreviewItem) => Promise<string>;
}

export async function renderCharacterFile(
    content: string,
    file: string,
    uri: vscode.Uri,
    webview: vscode.Webview,
    options: CharacterPreviewBodyOptions = {},
): Promise<CharacterPreviewRenderResult> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const node = parseHoi4File(content, localize('infile', 'In file {0}:\n', file));
        const characters = getCharactersFromFile(node, file);
        const styleTable = new StyleTable();
        const bodyResult = await renderCharacterPreviewBody(characters, styleTable, options);

        return {
            html: html(
                webview,
                bodyResult.body,
                [
                    setPreviewFileUriScript,
                    'characterpreview.js',
                ],
                [
                    'codicon.css',
                    'common.css',
                    styleTable,
                ],
            ),
            dependencies: [file, ...bodyResult.dependencies],
        };
    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return {
            html: html(webview, baseContent, [setPreviewFileUriScript], []),
            dependencies: [file],
        };
    }
}

export async function renderCharacterPreviewBody(
    characters: CharacterPreviewItem[],
    styleTable: StyleTable,
    options: CharacterPreviewBodyOptions = {},
): Promise<{ body: string; dependencies: string[] }> {
    const dependencies = new Set<string>();
    const resolvePortraitAsset = options.resolvePortraitAsset ?? createDefaultCharacterPortraitAssetResolver();
    const resolveDisplayName = options.resolveDisplayName ?? resolveCharacterDisplayName;

    addCharacterPreviewStyles(styleTable);

    if (characters.length === 0) {
        return {
            body: `<div class="${styleTable.name('characters-empty')}">${htmlTextEscape(localize('characterpreview.nocharacters', 'No characters defined.'))}</div>`,
            dependencies: [],
        };
    }

    const renderedCharacters = await Promise.all(characters.map(async character => {
        const displayName = await resolveDisplayName(character);
        const renderedPortraits = character.portraits.length === 0
            ? [renderMissingPortrait(character.id, localize('characterpreview.noportrait', 'No portrait'), character)]
            : await Promise.all(character.portraits.map(async portrait => {
                const asset = await resolvePortraitAsset(portrait.sprite);
                for (const dependency of asset.dependencies) {
                    dependencies.add(dependency);
                }

                return asset.image
                    ? renderPortraitImage(character, portrait.sprite, `${portrait.role} ${portrait.size}`, asset.image.uri)
                    : renderMissingPortrait(character.id, portrait.sprite, character, `${portrait.role} ${portrait.size}`);
            }));

        return `<article class="${styleTable.name('character-card')}" data-character-id="${htmlAttributeEscape(character.id)}">
            <div class="${styleTable.name('portrait-list')}">
                ${renderedPortraits.join('')}
            </div>
            <div class="${styleTable.name('character-name')}" title="${htmlAttributeEscape(character.id)}">${htmlTextEscape(displayName)}</div>
        </article>`;
    }));

    return {
        body: `<main id="character-preview-root" class="${styleTable.name('character-preview-root')}">
            ${renderedCharacters.join('')}
        </main>`,
        dependencies: [...dependencies],
    };
}

async function resolveCharacterDisplayName(character: CharacterPreviewItem): Promise<string> {
    if (character.name && isLocalisationIndexEnabled()) {
        const localizedName = await getLocalisedTextQuick(character.name);
        if (localizedName) {
            return localizedName;
        }
    }

    return character.name || character.id;
}

function renderPortraitImage(
    character: CharacterPreviewItem,
    spriteName: string,
    label: string,
    imageUri: string,
): string {
    return `<button
        type="button"
        class="navigator st-portrait-button"
        start="${character.token?.start}"
        end="${character.token?.end}"
        title="${htmlAttributeEscape(`${character.id}\n${label}\n${spriteName}`)}"
    >
        <img class="st-portrait-image" src="${htmlAttributeEscape(imageUri)}" alt="${htmlAttributeEscape(spriteName)}" />
        <span class="st-portrait-label">${htmlTextEscape(label)}</span>
    </button>`;
}

function renderMissingPortrait(
    characterId: string,
    spriteName: string,
    character: CharacterPreviewItem,
    label?: string,
): string {
    return `<button
        type="button"
        class="navigator st-portrait-button st-portrait-missing"
        start="${character.token?.start}"
        end="${character.token?.end}"
        title="${htmlAttributeEscape(`${characterId}\n${label ? `${label}\n` : ''}${spriteName}`)}"
    >
        <span class="st-portrait-placeholder">${htmlTextEscape(spriteName)}</span>
        ${label ? `<span class="st-portrait-label">${htmlTextEscape(label)}</span>` : ''}
    </button>`;
}

function addCharacterPreviewStyles(styleTable: StyleTable): void {
    styleTable.style('character-preview-root', () => `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
        padding: 16px;
        box-sizing: border-box;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
    `);
    styleTable.style('character-card', () => `
        display: grid;
        grid-template-rows: minmax(132px, auto) auto;
        gap: 8px;
        min-width: 0;
        padding: 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    `);
    styleTable.style('portrait-list', () => `
        display: flex;
        align-items: flex-end;
        justify-content: center;
        gap: 8px;
        min-width: 0;
        min-height: 132px;
        flex-wrap: wrap;
    `);
    styleTable.style('portrait-button', () => `
        width: 96px;
        min-height: 128px;
        display: grid;
        grid-template-rows: 112px auto;
        align-items: end;
        justify-items: center;
        gap: 4px;
        padding: 5px;
        border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
        border-radius: 4px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        cursor: pointer;
        overflow: hidden;
    `);
    styleTable.raw('.st-portrait-button:hover, .st-portrait-button:focus', `
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
        filter: brightness(1.08);
    `);
    styleTable.style('portrait-image', () => `
        max-width: 84px;
        max-height: 112px;
        width: auto;
        height: auto;
        object-fit: contain;
        align-self: end;
    `);
    styleTable.style('portrait-label', () => `
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
    `);
    styleTable.style('portrait-missing', () => `
        opacity: 0.82;
    `);
    styleTable.style('portrait-placeholder', () => `
        width: 84px;
        height: 112px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 6px;
        overflow-wrap: anywhere;
        text-align: center;
        font-size: 11px;
        line-height: 1.2;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-input-background);
        border: 1px dashed var(--vscode-panel-border);
    `);
    styleTable.style('character-name', () => `
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
        font-weight: 600;
        line-height: 1.35;
    `);
    styleTable.style('characters-empty', () => `
        padding: 16px;
        color: var(--vscode-descriptionForeground);
    `);
}
