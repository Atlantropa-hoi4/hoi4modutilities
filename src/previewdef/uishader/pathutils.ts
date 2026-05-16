import * as path from 'path';

export function shaderCandidatesForEffect(effectFile: string): string[] {
    const normalized = normalizeShaderPath(effectFile);
    const parsed = path.posix.parse(normalized);
    const withoutExtension = joinShaderPath(parsed.dir, parsed.name);
    if (parsed.ext.toLowerCase() === '.shader') {
        return [normalized];
    }
    return unique([
        `${withoutExtension}.shader`,
        normalized.endsWith('.lua') ? normalized.slice(0, -'.lua'.length) + '.shader' : undefined,
    ].filter((value): value is string => !!value));
}

export function normalizeShaderPath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function shaderDirname(value: string): string {
    const dirname = path.posix.dirname(normalizeShaderPath(value));
    return dirname === '.' ? '' : dirname;
}

export function joinShaderPath(...parts: string[]): string {
    return path.posix.join(...parts.filter(part => part.length > 0));
}

export function unique<T>(values: T[]): T[] {
    return values.filter((value, index, array) => array.indexOf(value) === index);
}
