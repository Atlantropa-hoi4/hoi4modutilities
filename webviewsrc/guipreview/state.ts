export function resolveGuiPreviewFolder(
    restoredFolder: unknown,
    availableFolders: readonly string[],
    fallbackFolder: string,
): string {
    return typeof restoredFolder === 'string' && availableFolders.includes(restoredFolder)
        ? restoredFolder
        : fallbackFolder;
}
