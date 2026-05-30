export const maxCustomEditorImageBytes = 64 * 1024 * 1024;

export function isImagePreviewWithinLimit(sizeBytes: number, limitBytes: number = maxCustomEditorImageBytes): boolean {
    return sizeBytes <= limitBytes;
}

export function formatByteSize(sizeBytes: number): string {
    if (sizeBytes < 1024) {
        return `${sizeBytes} B`;
    }

    const units = ['KiB', 'MiB', 'GiB'];
    let value = sizeBytes / 1024;
    for (const unit of units) {
        if (value < 1024 || unit === units[units.length - 1]) {
            return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
        }
        value /= 1024;
    }

    return `${sizeBytes} B`;
}
