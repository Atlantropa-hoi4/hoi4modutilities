export function clampFocusTreeIndex(index: number, focusTreeCount: number): number {
    if (!Number.isFinite(index) || focusTreeCount <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(focusTreeCount - 1, index));
}
