export function applyStringMapPatchInPlace(
    target: Record<string, string>,
    changedEntries: Readonly<Record<string, string>> | undefined,
    removedKeys: readonly string[] | undefined,
): Record<string, string> {
    if (changedEntries) {
        Object.assign(target, changedEntries);
    }
    removedKeys?.forEach(key => {
        delete target[key];
    });
    return target;
}
