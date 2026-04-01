export function normalizeFileOrUriString(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
        return trimmed;
    }

    const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
    const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");
    if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}
