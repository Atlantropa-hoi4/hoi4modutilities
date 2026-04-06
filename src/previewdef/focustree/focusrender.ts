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

function textEscape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

export function resolveFocusLocalizationText(
    focus: Pick<Focus, 'id' | 'text'>,
    resolveText: (key: string) => string | null | undefined = tryGetLocalizedText,
): string | undefined {
    if (!focus.text) {
        const defaultLocalizedText = resolveText(focus.id);
        return defaultLocalizedText && defaultLocalizedText !== focus.id
            ? defaultLocalizedText
            : undefined;
    }

    const explicitLocalizedText = resolveText(focus.text);
    if (explicitLocalizedText && explicitLocalizedText !== focus.text) {
        return explicitLocalizedText;
    }

    if (focus.text !== focus.id) {
        return focus.text;
    }

    const defaultLocalizedText = resolveText(focus.id);
    return defaultLocalizedText && defaultLocalizedText !== focus.id
        ? defaultLocalizedText
        : undefined;
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
    const sharedStyles = ensureFocusTemplateStyles(styleTable, maxFocusIconWidth, maxFocusIconHeight);
    const localizedText = resolveFocusLocalizationText(focus);
    const textContent = `
        <span class="${sharedStyles.codeLineClass}">${textEscape(focus.id)}</span>
        ${localizedText ? `<span class="${sharedStyles.localizationLineClass}">${textEscape(localizedText)}</span>` : ''}
    `;

    return `<div
    class="
        navigator
        ${sharedStyles.commonClass}
    "
    start="${focus.token?.start}"
    end="${focus.token?.end}"
    ${file === focus.file ? '' : `file="${focus.file}"`}
    data-focus-id="${attributeEscape(focus.id)}"
    data-focus-editable="${focus.isInCurrentFile && focus.layout?.editable === true ? 'true' : 'false'}"
    data-focus-source-file="${attributeEscape(focus.layout?.sourceFile ?? focus.file)}">
        <div class="focus-checkbox ${sharedStyles.checkboxClass}">
            <input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/>
        </div>
        <div
        class="${sharedStyles.iconSlotClass}">
            <div
            class="
                {{iconClass}}
                ${sharedStyles.iconImageClass}
            "></div>
        </div>
        <span
        class="${sharedStyles.spanClass}">
        ${textContent}
        </span>
    </div>`;
}

export function ensureFocusTemplateStyles(
    styleTable: StyleTable,
    maxFocusIconWidth: number,
    maxFocusIconHeight: number,
): {
    commonClass: string;
    checkboxClass: string;
    iconSlotClass: string;
    iconImageClass: string;
    spanClass: string;
    codeLineClass: string;
    localizationLineClass: string;
} {
    return {
        commonClass: styleTable.style('focus-common', () => `
            width: 100%;
            height: 100%;
            text-align: center;
            cursor: pointer;
            position: relative;
            overflow: visible;
        `) as string,
        checkboxClass: styleTable.style('focus-checkbox', () => `
            position: absolute;
            top: 1px;
        `) as string,
        iconSlotClass: styleTable.style('focus-icon-slot', () => `
            position: absolute;
            left: ${focusIconSidePadding}px;
            top: ${focusIconTopOffset}px;
            width: ${maxFocusIconWidth}px;
            height: ${maxFocusIconHeight}px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        `) as string,
        iconImageClass: styleTable.style('focus-icon-image', () => `
            display: block;
            flex: none;
            background-repeat: no-repeat;
            background-position: center;
            background-size: 100% 100%;
            pointer-events: none;
        `) as string,
        spanClass: styleTable.style('focus-span', () => `
            margin: 10px -400px;
            margin-top: ${focusTextMarginTop}px;
            text-align: center;
            display: inline-block;
            line-height: 1.2;
        `) as string,
        codeLineClass: styleTable.style('focus-code-line', () => `
            display: block;
        `) as string,
        localizationLineClass: styleTable.style('focus-localization-line', () => `
            display: block;
            margin-top: 2px;
            opacity: 0.9;
            font-size: 0.92em;
            line-height: 1.2;
            white-space: normal;
        `) as string,
    };
}
