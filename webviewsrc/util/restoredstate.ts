export function restoreArrayState<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

export function restoreSelectionIndex(value: unknown, itemCount: number): number {
    if (itemCount <= 0 || typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.min(itemCount - 1, Math.max(0, Math.trunc(value)));
}
