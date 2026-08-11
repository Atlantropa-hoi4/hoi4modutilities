import * as path from 'path';

export function matchPathEnd(pathname: string, segments: string[]): boolean {
    pathname = pathname.replace(/\/|\\/g, path.sep);

    for (let i = segments.length - 1; i >= 0; i--) {
        const name = path.basename(pathname);
        pathname = path.dirname(pathname);

        if (segments[i] === '*') {
            continue;
        }

        if (segments[i].toLowerCase() !== name.toLowerCase()) {
            return false;
        }
    }

    return true;
}

export function isSamePath(a: string, b: string): boolean {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

export function getRelativePathWithinRoot(
    rootPath: string,
    filePath: string,
    requiredPrefix: string,
): string | undefined {
    const nativeRelative = path.relative(rootPath, filePath);
    const relative = nativeRelative.replace(/\\+/g, '/');
    const normalizedPrefix = requiredPrefix.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!relative
        || path.isAbsolute(nativeRelative)
        || relative === '..'
        || relative.startsWith('../')
        || (normalizedPrefix && relative !== normalizedPrefix && !relative.startsWith(normalizedPrefix + '/'))) {
        return undefined;
    }
    return relative;
}
