export interface FocusTreeRefreshUri {
    path: string;
    toString(): string;
}

export function shouldRefreshFocusTreeOnExternalFileChange(
    previewUri: string,
    changedUri: FocusTreeRefreshUri,
    changeKind: 'change' | 'create' | 'delete',
    liveRefreshExtensions: ReadonlySet<string>,
): boolean {
    const lowerPath = changedUri.path.replace(/\\+/g, '/').toLowerCase();
    const extension = lowerPath.slice(lowerPath.lastIndexOf('.'));
    if (!liveRefreshExtensions.has(extension)) {
        return false;
    }

    if (changedUri.toString() === previewUri) {
        return true;
    }

    if (extension === '.txt') {
        return lowerPath.includes('/common/national_focus/')
            || (changeKind === 'create' && lowerPath.includes('/common/focus_inlay_windows/'));
    }

    return lowerPath.includes('/common/national_focus/')
        || lowerPath.includes('/interface/')
        || lowerPath.includes('/localisation/')
        || extension === '.mod';
}
