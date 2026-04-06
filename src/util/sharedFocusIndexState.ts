export interface FocusIndexState {
    byFile: Record<string, string[]>;
    byId: Record<string, string[]>;
}

export function createEmptyFocusIndexState(): FocusIndexState {
    return {
        byFile: {},
        byId: {},
    };
}

export function removeFocusFileFromIndex(index: FocusIndexState, focusFile: string): void {
    const previousIds = index.byFile[focusFile];
    if (!previousIds) {
        return;
    }

    delete index.byFile[focusFile];
    for (const focusId of previousIds) {
        const files = index.byId[focusId];
        if (!files) {
            continue;
        }

        const nextFiles = files.filter(file => file !== focusFile);
        if (nextFiles.length === 0) {
            delete index.byId[focusId];
        } else {
            index.byId[focusId] = nextFiles;
        }
    }
}

export function applyFocusFileToIndex(index: FocusIndexState, focusFile: string, focusIds: readonly string[]): void {
    removeFocusFileFromIndex(index, focusFile);

    const normalizedIds = Array.from(new Set(focusIds.filter(Boolean)));
    if (normalizedIds.length === 0) {
        return;
    }

    index.byFile[focusFile] = normalizedIds;
    for (const focusId of normalizedIds) {
        const files = index.byId[focusId] ?? [];
        if (!files.includes(focusFile)) {
            index.byId[focusId] = [...files, focusFile];
        }
    }
}

export function findFileByFocusKeyInIndex(index: FocusIndexState, key: string): string | undefined {
    return index.byId[key]?.[0];
}
