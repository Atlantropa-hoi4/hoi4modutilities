const defaultPreviewScale = 1;
const minPreviewScale = 0.2;
const maxPreviewScale = 1;

export function normalizePreviewScale(value: unknown): number {
    const scale = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : defaultPreviewScale;

    if (!Number.isFinite(scale)) {
        return defaultPreviewScale;
    }

    return Math.min(maxPreviewScale, Math.max(minPreviewScale, scale));
}
