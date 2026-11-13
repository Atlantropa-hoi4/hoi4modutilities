import type { FocusTreeInlay } from './focustreeschematypes';

export interface InlaySourceNavigation {
    file: string;
    start: number;
    end: number;
}

export function inlaySourceNavigation(
    source: { file?: string; token?: { start: number; end: number } },
): InlaySourceNavigation | undefined {
    if (!source.file) { return undefined; }
    const start = source.token?.start;
    const end = source.token?.end;
    const validStart = Number.isSafeInteger(start) && start! >= 0 ? start! : 0;
    return { file: source.file, start: validStart,
        end: Number.isSafeInteger(end) && end! >= validStart ? end! : validStart };
}

/** A rendered window navigates to its tree reference; older snapshots retain the definition. */
export function inlayWindowNavigation(inlay: Pick<FocusTreeInlay, 'file' | 'token' | 'referenceFile' | 'referenceToken'>): InlaySourceNavigation | undefined {
    return inlay.referenceFile
        ? inlaySourceNavigation({ file: inlay.referenceFile, token: inlay.referenceToken })
        : inlaySourceNavigation(inlay);
}
