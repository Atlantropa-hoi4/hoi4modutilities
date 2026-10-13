import { vscode } from '../util/vscode';
import { runtime } from './runtime';

export interface FocusNavigationTarget {
    start?: number;
    end?: number;
    file?: string;
    focusId?: string;
}

/**
 * Where a focus is defined, read from the current view rather than stale markup. `file` is set
 * only for focuses of another file, like the `file` attribute of their cards.
 */
export function getFocusNavigationTargetById(focusId: string | undefined, file?: string): FocusNavigationTarget {
    const focus = focusId ? runtime.renderedFocusTree?.focuses[focusId] : undefined;
    return {
        start: focus?.start,
        end: focus?.end,
        file: file ?? (focus && focus.file !== runtime.focusPositionActiveFile ? focus.file : undefined),
        focusId,
    };
}

/** Navigation data for a focus card. */
export function getFocusNavigationTarget(card: HTMLElement): FocusNavigationTarget {
    return getFocusNavigationTargetById(card.dataset.focusId || undefined, card.getAttribute('file') ?? undefined);
}

/** Opens a focus definition in the editor. */
export function navigateToFocus(target: FocusNavigationTarget): void {
    vscode.postMessage({
        command: 'navigate',
        ...target,
        documentVersion: runtime.focusPositionDocumentVersion,
    });
}
