import { Focus } from './schema';
import { StyleTable, normalizeForStyle } from '../../util/styletable';

export const focusIconSidePadding = 12;
export const focusIconTopOffset = 10;
export const focusTextMarginTop = 85;
export const focusIconBottomGap = 4;
export const focusDefaultPlaceholderSize = 56;

function attributeEscape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function tryGetLocalizedText(key: string): string | null | undefined {
    try {
        const { localisationIndex } = require('../../util/featureflags') as { localisationIndex: boolean };
        if (!localisationIndex) {
            return null;
        }

        const { getLocalisedTextQuickIfReady } = require('../../util/localisationIndex') as {
            getLocalisedTextQuickIfReady: (text: string) => string | null;
        };
        return getLocalisedTextQuickIfReady(key);
    } catch {
        return null;
    }
}

export function renderFocusHtmlTemplate(
    focus: Focus,
    styleTable: StyleTable,
    file: string,
    xGridSize: number,
    yGridSize: number,
): string {
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);

    let textContent = focus.id;
    let localizedText = tryGetLocalizedText(focus.id);
    if (localizedText === focus.id || !localizedText) {
        if (focus.text) {
            localizedText = tryGetLocalizedText(focus.text);
            if (localizedText !== focus.text && localizedText !== null) {
                textContent += `<br/>${localizedText}`;
            }
        }
    } else {
        textContent += `<br/>${localizedText}`;
    }

    return `<div
    class="
        navigator
        ${styleTable.style('focus-common', () => `
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
    data-focus-source-file="${attributeEscape(focus.layout?.sourceFile ?? focus.file)}">
        <div class="focus-checkbox ${styleTable.style('focus-checkbox', () => `position: absolute; top: 1px;`)}">
            <input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/>
        </div>
        <div
        class="${styleTable.style('focus-icon-slot', () => `
            position: absolute;
            left: ${focusIconSidePadding}px;
            top: ${focusIconTopOffset}px;
            width: ${maxFocusIconWidth}px;
            height: ${maxFocusIconHeight}px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        `)}">
            <div
            class="
                {{iconClass}}
                ${styleTable.style('focus-icon-image', () => `
                    display: block;
                    flex: none;
                    background-repeat: no-repeat;
                    background-position: center;
                    background-size: 100% 100%;
                    pointer-events: none;
                `)}
            "></div>
        </div>
        <span
        class="${styleTable.style('focus-span', () => `
            margin: 10px -400px;
            margin-top: ${focusTextMarginTop}px;
            text-align: center;
            display: inline-block;
        `)}">
        ${textContent}
        </span>
    </div>`;
}
