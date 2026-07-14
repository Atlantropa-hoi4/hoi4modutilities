import { Focus } from './schema';
import {
    focusTreeRenderCancellationBatchSize,
    throwIfFocusTreeRenderCancelled,
    yieldToFocusTreeRenderCancellation,
} from './rendercancellation';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { htmlAttributeEscape, htmlTextEscape } from '../../util/htmlescape';

export const focusIconSidePadding = 12;
export const focusIconTopOffset = 10;
export const focusTextMarginTop = 85;
export const focusIconBottomGap = 4;
export const focusDefaultPlaceholderSize = 56;

function tryGetLocalizedText(key: string): string | null | undefined {
    try {
        const { isLocalisationIndexEnabled } = require('../../util/featureflags') as { isLocalisationIndexEnabled: () => boolean };
        if (!isLocalisationIndexEnabled()) {
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

async function tryGetLocalizedTextAsync(key: string): Promise<string | null | undefined> {
    try {
        const { isLocalisationIndexEnabled } = require('../../util/featureflags') as { isLocalisationIndexEnabled: () => boolean };
        if (!isLocalisationIndexEnabled()) {
            return null;
        }

        const { getLocalisedTextQuick } = require('../../util/localisationIndex') as {
            getLocalisedTextQuick: (text: string) => Promise<string | undefined>;
        };
        return getLocalisedTextQuick(key);
    } catch {
        return null;
    }
}

function tryCreateReadyFocusLocalizationResolver(): ((key: string) => string | null | undefined) | undefined {
    try {
        const { createLocalisedTextQuickIfReadyResolver } = require('../../util/localisationIndex') as {
            createLocalisedTextQuickIfReadyResolver: () => (text: string) => string | null | undefined;
        };
        return createLocalisedTextQuickIfReadyResolver();
    } catch {
        return undefined;
    }
}

export function resolveFocusLocalizationText(
    focus: Pick<Focus, 'id' | 'text'>,
    resolveText: (key: string) => string | null | undefined = tryGetLocalizedText,
): string | undefined {
    const textKey = focus.text && focus.text !== focus.id ? focus.text : undefined;
    if (textKey) {
        const explicitLocalizedText = resolveText(textKey);
        if (explicitLocalizedText && explicitLocalizedText !== textKey) {
            return explicitLocalizedText;
        }
    }

    const defaultLocalizedText = resolveText(focus.id);
    return defaultLocalizedText && defaultLocalizedText !== focus.id
        ? defaultLocalizedText
        : undefined;
}

export async function resolveFocusLocalizationTextAsync(
    focus: Pick<Focus, 'id' | 'text'>,
    resolveText: (key: string) => Promise<string | null | undefined> = tryGetLocalizedTextAsync,
): Promise<string | undefined> {
    const textKey = focus.text && focus.text !== focus.id ? focus.text : undefined;
    if (textKey) {
        const explicitLocalizedText = await resolveText(textKey);
        if (explicitLocalizedText && explicitLocalizedText !== textKey) {
            return explicitLocalizedText;
        }
    }

    const defaultLocalizedText = await resolveText(focus.id);
    return defaultLocalizedText && defaultLocalizedText !== focus.id
        ? defaultLocalizedText
        : undefined;
}

export async function resolveFocusLocalizationTextById(
    focuses: readonly Pick<Focus, 'id' | 'text'>[],
    resolveText?: (key: string) => Promise<string | null | undefined>,
): Promise<Record<string, string>> {
    const entries = await Promise.all(focuses.map(async focus => {
        const text = await resolveFocusLocalizationTextAsync(focus, resolveText);
        return [focus.id, text] as const;
    }));

    const textById: Record<string, string> = {};
    for (const [focusId, text] of entries) {
        if (text) {
            textById[focusId] = text;
        }
    }
    return textById;
}

export async function resolveFocusLocalizationTextByIdIfReady(
    focuses: readonly Pick<Focus, 'id' | 'text'>[],
    resolveText: ((key: string) => string | null | undefined) | undefined = tryCreateReadyFocusLocalizationResolver(),
    isCancelled?: () => boolean,
): Promise<Record<string, string>> {
    if (!resolveText) {
        return {};
    }

    throwIfFocusTreeRenderCancelled(isCancelled);
    const textById: Record<string, string> = {};
    for (let index = 0; index < focuses.length; index += 1) {
        if (index > 0 && index % focusTreeRenderCancellationBatchSize === 0) {
            await yieldToFocusTreeRenderCancellation(isCancelled);
        }

        const focus = focuses[index];
        const text = resolveFocusLocalizationText(focus, resolveText);
        if (text) {
            textById[focus.id] = text;
        }
    }
    throwIfFocusTreeRenderCancelled(isCancelled);
    return textById;
}

export function renderFocusHtmlTemplate(
    focus: Focus,
    styleTable: StyleTable,
    file: string,
    xGridSize: number,
    yGridSize: number,
    localizedText: string | undefined = resolveFocusLocalizationText(focus),
): string {
    const maxFocusIconHeight = Math.max(focusTextMarginTop - focusIconTopOffset - focusIconBottomGap, 0);
    const maxFocusIconWidth = Math.max(xGridSize - (focusIconSidePadding * 2), 0);
    const sharedStyles = ensureFocusTemplateStyles(styleTable, maxFocusIconWidth, maxFocusIconHeight);
    const displayName = localizedText ?? focus.id;
    const textContent = `
        <span
            class="${sharedStyles.codeLineClass}"
            data-preview-label-id="${htmlAttributeEscape(focus.id)}"
            data-preview-label-name="${htmlAttributeEscape(displayName)}"
        >${htmlTextEscape(focus.id)}</span>
    `;
    const idTitle = `${focus.id}\n({{position}})`;
    const nameTitle = `${displayName}\n({{position}})`;

    return `<div
    class="
        navigator
        ${sharedStyles.commonClass}
    "
    start="${focus.token?.start}"
    end="${focus.token?.end}"
    ${file === focus.file ? '' : `file="${htmlAttributeEscape(focus.file)}"`}
    data-focus-id="${htmlAttributeEscape(focus.id)}"
    data-focus-editable="${focus.isInCurrentFile && focus.layout?.editable === true ? 'true' : 'false'}"
    data-focus-source-file="${htmlAttributeEscape(focus.layout?.sourceFile ?? focus.file)}"
    title="${htmlAttributeEscape(idTitle)}"
    data-preview-title-id="${htmlAttributeEscape(idTitle)}"
    data-preview-title-name="${htmlAttributeEscape(nameTitle)}">
        <div class="focus-checkbox ${sharedStyles.checkboxClass}">
            <input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/>
        </div>
        ${focus.overlay ? `<div class="${sharedStyles.overlayClass} ${styleTable.name('focus-overlay-' + normalizeForStyle(focus.overlay))}"></div>` : ''}
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
    overlayClass: string;
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
            z-index: 3;
        `) as string,
        overlayClass: styleTable.style('focus-overlay-common', () => `
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            background-position: center;
            background-repeat: no-repeat;
            background-size: contain;
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
            z-index: 1;
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
            position: relative;
            z-index: 2;
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
