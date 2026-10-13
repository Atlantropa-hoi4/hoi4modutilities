/**
 * DOM-free search result navigation. Enter walks the current matches that the scene shows: laid
 * out under the selected conditions and outside hidden branches, whether or not their cards are
 * mounted yet, so the frame-budgeted scene never limits what search can reach.
 */

export interface FocusSearchScene {
    /** Laid out and outside every hidden branch, mounted or not. */
    isShown(focusId: string): boolean;
    /** Mounts the focus if needed, then scrolls it into view. */
    reveal(focusId: string): void;
}

/** The parts of the retained focus scene that search uses. */
export interface FocusSearchSceneSource {
    isFocusShown(focusId: string, isHiddenBranchClass: (className: string) => boolean): boolean;
    ensureMounted(focusIds: readonly string[]): void;
    getWrapper(focusId: string): { scrollIntoView(options?: ScrollIntoViewOptions): void } | undefined;
}

/**
 * Adapts the scene for search. A match whose card the frame-budgeted scene has not mounted yet
 * is mounted right away, so scrolling always finds its element.
 */
export function createFocusSearchScene(
    scene: FocusSearchSceneSource,
    isHiddenBranchClass: (className: string) => boolean,
): FocusSearchScene {
    return {
        isShown: focusId => scene.isFocusShown(focusId, isHiddenBranchClass),
        reveal: focusId => {
            scene.ensureMounted([focusId]);
            scene.getWrapper(focusId)?.scrollIntoView({ block: 'center', inline: 'center' });
        },
    };
}

export interface FocusSearchPosition {
    /** 1-based position of the current result among the shown ones; undefined before Enter. */
    current: number | undefined;
    total: number;
}

/** Ids whose search text contains the query, in the tree's focus order. */
export function matchFocusSearch(searchTextByFocusId: Readonly<Record<string, string>>, query: string): Set<string> {
    const normalized = query.trim().toLowerCase();
    const result = new Set<string>();
    if (!normalized) {
        return result;
    }
    for (const [focusId, text] of Object.entries(searchTextByFocusId)) {
        if (text.includes(normalized)) {
            result.add(focusId);
        }
    }
    return result;
}

export class FocusSearchNavigator {
    private resultIds: string[] = [];
    private currentId: string | undefined;

    constructor(private readonly scene: FocusSearchScene) {}

    public get current(): string | undefined {
        return this.currentId;
    }

    /** The matches Enter can walk, in result order. */
    public getShownResultIds(): string[] {
        return this.resultIds.filter(focusId => this.scene.isShown(focusId));
    }

    /**
     * Replaces the matches. `reveal` moves to and shows the first shown match, as typing does;
     * otherwise the current match stays current while it is still a shown match.
     */
    public setResults(resultIds: Iterable<string>, reveal: boolean): void {
        this.resultIds = Array.from(resultIds);
        if (reveal) {
            this.currentId = this.getShownResultIds()[0];
            if (this.currentId !== undefined) {
                this.scene.reveal(this.currentId);
            }
            return;
        }
        this.refresh();
    }

    /** Drops a current match that conditions, branches, or the tree no longer show. */
    public refresh(): void {
        if (this.currentId !== undefined && (!this.resultIds.includes(this.currentId) || !this.scene.isShown(this.currentId))) {
            this.currentId = undefined;
        }
    }

    /**
     * Moves to the next shown match, or the previous one for Shift+Enter, wrapping around. The
     * first Enter lands on the first match, the first Shift+Enter on the last.
     */
    public step(backwards: boolean): string | undefined {
        const shown = this.getShownResultIds();
        if (shown.length === 0) {
            this.currentId = undefined;
            return undefined;
        }
        const index = this.currentId === undefined ? -1 : shown.indexOf(this.currentId);
        const next = index < 0
            ? backwards ? shown.length - 1 : 0
            : (index + (backwards ? shown.length - 1 : 1)) % shown.length;
        this.currentId = shown[next];
        this.scene.reveal(this.currentId);
        return this.currentId;
    }

    /** The current match, first moving to the first shown one when there is none. */
    public ensureCurrent(): string | undefined {
        this.refresh();
        return this.currentId ?? this.step(false);
    }

    public getPosition(): FocusSearchPosition {
        const shown = this.getShownResultIds();
        const index = this.currentId === undefined ? -1 : shown.indexOf(this.currentId);
        return { current: index < 0 ? undefined : index + 1, total: shown.length };
    }
}
