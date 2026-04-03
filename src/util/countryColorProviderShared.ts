export interface CountryColorMatch {
    start: number;
    end: number;
    key: "color" | "color_ui";
    valueText: string;
    red: number;
    green: number;
    blue: number;
    format: "plain" | "rgb";
}

export function isCountryColorFile(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
    return /(?:^|\/)(?:(?:common\/)?countries\/(?:colors?|cosmetic)|(?:common\/)?ideologies\/[^/]+)\.txt$/.test(normalizedPath);
}

export function findCountryColorMatches(text: string): CountryColorMatch[] {
    const matches: CountryColorMatch[] = [];

    for (const match of text.matchAll(countryColorPattern)) {
        const fullMatch = match[0];
        const propertyPrefix = match.groups?.prefix;
        const key = match.groups?.key;
        if (!fullMatch || propertyPrefix === undefined || (key !== 'color' && key !== 'color_ui') || isCommentedOut(text, match.index ?? 0)) {
            continue;
        }

        const red = parseRgbComponent(match.groups?.red);
        const green = parseRgbComponent(match.groups?.green);
        const blue = parseRgbComponent(match.groups?.blue);
        if (red === undefined || green === undefined || blue === undefined) {
            continue;
        }

        const start = (match.index ?? 0) + propertyPrefix.length;
        const valueText = fullMatch.slice(propertyPrefix.length);
        matches.push({
            start,
            end: (match.index ?? 0) + fullMatch.length,
            key,
            valueText,
            red,
            green,
            blue,
            format: match.groups?.attachment ? "rgb" : "plain",
        });
    }

    return matches;
}

export function formatCountryColorValue(
    red: number,
    green: number,
    blue: number,
    format: "plain" | "rgb",
): string {
    const clippedRed = normalizeRgbComponent(red);
    const clippedGreen = normalizeRgbComponent(green);
    const clippedBlue = normalizeRgbComponent(blue);
    const values = `${clippedRed} ${clippedGreen} ${clippedBlue}`;

    return format === "rgb" ? `rgb { ${values} }` : `{ ${values} }`;
}

export function createCountryColorLabel(
    referenceText: string | undefined,
    rgb: { red: number; green: number; blue: number; },
): string {
    const format = referenceText === undefined
        ? 'rgb'
        : (referenceText.trimStart().toLowerCase().startsWith('rgb') ? 'rgb' : 'plain');
    return formatCountryColorValue(rgb.red, rgb.green, rgb.blue, format);
}

export function formatCountryColorBlock(
    referenceText: string | undefined,
    rgb: { red: number; green: number; blue: number; },
): string {
    if (!referenceText) {
        return createCountryColorLabel(referenceText, rgb);
    }

    const rewritten = rewriteCountryColorBlock(referenceText, rgb);
    return rewritten ?? createCountryColorLabel(referenceText, rgb);
}

function parseRgbComponent(rawValue: string | undefined): number | undefined {
    if (rawValue === undefined) {
        return undefined;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return normalizeRgbComponent(parsed);
}

function normalizeRgbComponent(value: number): number {
    if (value <= 0) {
        return 0;
    }

    if (value >= 255) {
        return 255;
    }

    return Math.round(value);
}

function isCommentedOut(text: string, matchStart: number): boolean {
    const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;
    const commentIndex = text.indexOf('#', lineStart);
    return commentIndex !== -1 && commentIndex < matchStart;
}

const countryColorPattern = /(?<prefix>\b(?<key>color(?:_ui)?)\b\s*=\s*)(?<attachment>rgb\s*)?\{\s*(?<red>-?(?:\d+(?:\.\d*)?|\.\d+))\s+(?<green>-?(?:\d+(?:\.\d*)?|\.\d+))\s+(?<blue>-?(?:\d+(?:\.\d*)?|\.\d+))\s*\}/gim;

function rewriteCountryColorBlock(
    referenceText: string,
    rgb: { red: number; green: number; blue: number; },
): string | undefined {
    const match = referenceText.match(/^(?<attachment>rgb\b\s*)?(?<open>\{)(?<prefix>\s*)(?<red>-?(?:\d+(?:\.\d*)?|\.\d+))(?<sep1>\s+)(?<green>-?(?:\d+(?:\.\d*)?|\.\d+))(?<sep2>\s+)(?<blue>-?(?:\d+(?:\.\d*)?|\.\d+))(?<suffix>\s*\})$/is);
    if (!match?.groups) {
        return undefined;
    }

    return `${match.groups.attachment ?? ''}${match.groups.open}${match.groups.prefix}${normalizeRgbComponent(rgb.red)}${match.groups.sep1}${normalizeRgbComponent(rgb.green)}${match.groups.sep2}${normalizeRgbComponent(rgb.blue)}${match.groups.suffix}`;
}
