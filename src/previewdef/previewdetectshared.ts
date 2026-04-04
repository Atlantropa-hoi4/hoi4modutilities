export const previewDetectionMaxChars = 64 * 1024;

export function samplePreviewText(text: string, maxChars: number = previewDetectionMaxChars): string {
    return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function findRegexPreviewPriority(text: string, pattern: RegExp): number | undefined {
    const flags = pattern.flags.replace(/g/g, '');
    const match = new RegExp(pattern.source, flags).exec(text);
    return match?.index;
}
