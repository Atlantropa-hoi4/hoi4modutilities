import { Node, NodeValue, parseHoi4File } from '../hoiformat/hoiparser';

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
    try {
        const root = parseHoi4File(text);
        const matches: CountryColorMatch[] = [];

        visitNodeValue(root.value, node => {
            const match = toCountryColorMatch(node, text);
            if (match) {
                matches.push(match);
            }
        });

        return matches;
    } catch {
        return [];
    }
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

function parseRgbComponent(rawValue: string | null | undefined): number | undefined {
    if (rawValue === undefined || rawValue === null) {
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

function visitNodeValue(value: NodeValue, callback: (node: Node) => void): void {
    if (!Array.isArray(value)) {
        return;
    }

    for (const node of value) {
        callback(node);
        visitNodeValue(node.value, callback);
    }
}

function toCountryColorMatch(node: Node, sourceText: string): CountryColorMatch | undefined {
    const key = node.name?.toLowerCase();
    if (key !== 'color' && key !== 'color_ui') {
        return undefined;
    }

    if (!Array.isArray(node.value) || !node.valueStartToken || !node.valueEndToken) {
        return undefined;
    }

    const attachment = node.valueAttachment?.name?.toLowerCase();
    if (attachment && attachment !== 'rgb') {
        return undefined;
    }

    const [redNode, greenNode, blueNode, extraNode] = node.value;
    if (extraNode) {
        return undefined;
    }

    const red = parseRgbComponent(redNode?.name);
    const green = parseRgbComponent(greenNode?.name);
    const blue = parseRgbComponent(blueNode?.name);
    if (red === undefined || green === undefined || blue === undefined) {
        return undefined;
    }

    const start = (node.valueAttachmentToken ?? node.valueStartToken).start;
    const end = node.valueEndToken.end;
    return {
        start,
        end,
        key,
        valueText: sourceText.slice(start, end),
        red,
        green,
        blue,
        format: attachment === 'rgb' ? 'rgb' : 'plain',
    };
}

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
