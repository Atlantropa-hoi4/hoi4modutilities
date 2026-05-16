import {
    ParsedUiShader,
    UiShaderConstant,
    UiShaderConstantBuffer,
    UiShaderEffect,
    UiShaderEntrypoint,
    UiShaderSampler,
} from './types';

export function parseUiShader(content: string, source?: string): ParsedUiShader {
    const includes = parseIncludes(content);
    const pixelShaderBlocks = findNamedBlocks(content, 'PixelShader');
    const vertexShaderBlocks = findNamedBlocks(content, 'VertexShader');
    const samplerBlocks = pixelShaderBlocks.flatMap(block => findNamedBlocks(block.body, 'Samplers'));

    return {
        source,
        includes,
        featureFlags: parseFeatureFlags(content),
        samplers: samplerBlocks.flatMap(block => parseSamplers(block.body)),
        constantBuffers: parseConstantBuffers(content, source),
        vertexShaders: vertexShaderBlocks.flatMap(block => parseMainCodeBlocks(block.body, source)),
        pixelShaders: pixelShaderBlocks.flatMap(block => parseMainCodeBlocks(block.body, source)),
        effects: parseEffects(content),
        rawCodeBlocks: parseCodeBlocks(content, source),
    };
}

export function mergeParsedUiShader(base: ParsedUiShader, includes: ParsedUiShader[]): ParsedUiShader {
    return {
        source: base.source,
        includes: base.includes,
        featureFlags: unique([
            ...includes.flatMap(include => include.featureFlags),
            ...base.featureFlags,
        ]),
        samplers: base.samplers,
        constantBuffers: [
            ...includes.flatMap(include => include.constantBuffers),
            ...base.constantBuffers,
        ],
        vertexShaders: base.vertexShaders,
        pixelShaders: base.pixelShaders,
        effects: base.effects,
        rawCodeBlocks: [
            ...includes.flatMap(include => include.rawCodeBlocks),
            ...base.rawCodeBlocks,
        ],
    };
}

function parseIncludes(content: string): string[] {
    const includes = findNamedBlocks(content, 'Includes')[0];
    if (!includes) {
        return [];
    }
    return [...includes.body.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function parseSamplers(content: string): UiShaderSampler[] {
    return findAssignmentBlocks(content).map(block => ({
        name: block.name,
        index: readNumberProperty(block.body, 'Index') ?? -1,
        magFilter: readStringProperty(block.body, 'MagFilter'),
        minFilter: readStringProperty(block.body, 'MinFilter'),
        mipFilter: readStringProperty(block.body, 'MipFilter'),
        addressU: readStringProperty(block.body, 'AddressU'),
        addressV: readStringProperty(block.body, 'AddressV'),
    })).filter(sampler => sampler.index >= 0);
}

function parseConstantBuffers(content: string, source?: string): UiShaderConstantBuffer[] {
    const result: UiShaderConstantBuffer[] = [];
    const regex = /ConstantBuffer\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const openIndex = content.indexOf('{', regex.lastIndex);
        if (openIndex < 0) {
            continue;
        }
        const closeIndex = findMatchingBrace(content, openIndex);
        if (closeIndex < 0) {
            continue;
        }
        const body = content.slice(openIndex + 1, closeIndex);
        result.push({
            slot: Number(match[1]),
            size: Number(match[2]),
            constants: parseConstants(body),
            source,
        });
        regex.lastIndex = closeIndex + 1;
    }
    return result;
}

function parseConstants(body: string): UiShaderConstant[] {
    const constants: UiShaderConstant[] = [];
    const lineRegex = /^\s*([A-Za-z_]\w*(?:\d+x\d+)?)\s+([A-Za-z_]\w*)(?:\[(\d+)\])?\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(body)) !== null) {
        constants.push({
            type: match[1],
            name: match[2],
            arraySize: match[3] ? Number(match[3]) : undefined,
        });
    }
    return constants;
}

function parseFeatureFlags(content: string): string[] {
    return unique([...content.matchAll(/@ifdef\s+([A-Za-z_]\w*)/g)].map(match => match[1]));
}

function parseMainCodeBlocks(content: string, source?: string): UiShaderEntrypoint[] {
    const result: UiShaderEntrypoint[] = [];
    const regex = /MainCode\s+([A-Za-z_]\w*)\s*\[\[([\s\S]*?)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        result.push({ name: match[1], code: match[2], source });
    }
    return result;
}

function parseCodeBlocks(content: string, source?: string): UiShaderEntrypoint[] {
    const result: UiShaderEntrypoint[] = [];
    const regex = /\bCode\s*\[\[([\s\S]*?)\]\]/g;
    let index = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        result.push({ name: `Code${index++}`, code: match[1], source });
    }
    return result;
}

function parseEffects(content: string): UiShaderEffect[] {
    return findKeywordBlocks(content, 'Effect').map(block => ({
        name: block.name,
        vertexShader: readStringProperty(block.body, 'VertexShader'),
        pixelShader: readStringProperty(block.body, 'PixelShader'),
    }));
}

function findNamedBlocks(content: string, name: string): Array<{ body: string; start: number; end: number }> {
    const result: Array<{ body: string; start: number; end: number }> = [];
    const regex = new RegExp(`\\b${escapeRegExp(name)}\\b\\s*=\\s*\\{`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const openIndex = content.indexOf('{', match.index);
        const closeIndex = findMatchingBrace(content, openIndex);
        if (closeIndex < 0) {
            continue;
        }
        result.push({ body: content.slice(openIndex + 1, closeIndex), start: openIndex, end: closeIndex });
        regex.lastIndex = closeIndex + 1;
    }
    return result;
}

function findAssignmentBlocks(content: string): Array<{ name: string; body: string }> {
    const result: Array<{ name: string; body: string }> = [];
    const regex = /\b([A-Za-z_]\w*)\b\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const openIndex = content.indexOf('{', match.index);
        const closeIndex = findMatchingBrace(content, openIndex);
        if (closeIndex < 0) {
            continue;
        }
        result.push({ name: match[1], body: content.slice(openIndex + 1, closeIndex) });
        regex.lastIndex = closeIndex + 1;
    }
    return result;
}

function findKeywordBlocks(content: string, keyword: string): Array<{ name: string; body: string }> {
    const result: Array<{ name: string; body: string }> = [];
    const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\s+([A-Za-z_][\\w-]*)\\s*\\{`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const openIndex = content.indexOf('{', match.index);
        const closeIndex = findMatchingBrace(content, openIndex);
        if (closeIndex < 0) {
            continue;
        }
        result.push({ name: match[1], body: content.slice(openIndex + 1, closeIndex) });
        regex.lastIndex = closeIndex + 1;
    }
    return result;
}

function findMatchingBrace(content: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < content.length; i++) {
        if (content.startsWith('[[', i)) {
            const rawEnd = content.indexOf(']]', i + 2);
            if (rawEnd < 0) {
                return -1;
            }
            i = rawEnd + 1;
            continue;
        }
        const char = content[i];
        if (char === '#') {
            const lineEnd = content.indexOf('\n', i + 1);
            if (lineEnd < 0) {
                return -1;
            }
            i = lineEnd;
            continue;
        }
        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function readNumberProperty(body: string, name: string): number | undefined {
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'i').exec(body);
    return match ? Number(match[1]) : undefined;
}

function readStringProperty(body: string, name: string): string | undefined {
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b\\s*=\\s*"([^"]+)"`, 'i').exec(body);
    return match?.[1];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique<T>(values: T[]): T[] {
    return values.filter((value, index, array) => array.indexOf(value) === index);
}
