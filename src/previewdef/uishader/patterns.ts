import { ParsedUiShader, UiShaderPreviewStatus, UiShaderPreviewWarning } from './types';

const unsupportedShaderNamePattern = /(?:^|[\\/])(pdxmap|pdxwater|pdxmesh|.*terrain.*|.*water.*|.*mesh.*)\.shader$/i;

export interface UiShaderSupportClassification {
    readonly status: UiShaderPreviewStatus;
    readonly templateId: string;
    readonly supportReason: string;
    readonly warnings: UiShaderPreviewWarning[];
}

export function classifyUiShader(shaderPath: string | undefined, shader: ParsedUiShader): UiShaderSupportClassification {
    if (shaderPath && unsupportedShaderNamePattern.test(shaderPath)) {
        return {
            status: 'unsupported-map',
            templateId: 'unsupported-map',
            supportReason: 'Map, water, terrain, and mesh shaders are outside the first UI shader preview scope.',
            warnings: [warning('unsupported-map-shader', 'Map, water, terrain, and mesh shaders are outside the first UI shader preview scope.')],
        };
    }

    const includeNames = new Set(shader.includes.map(include => normalize(include)));
    const effectNames = new Set(shader.effects.map(effect => effect.name.toLowerCase()));
    const samplerNames = new Set(shader.samplers.map(sampler => sampler.name.toLowerCase()));
    const pixelCode = shader.pixelShaders.map(entry => entry.code).join('\n');
    const constantNames = new Set(shader.constantBuffers.flatMap(buffer => buffer.constants.map(constant => constant.name.toLowerCase())));

    if (includeNames.has('buttonstate.fxh') && hasButtonEffects(effectNames)) {
        if (includeNames.has('sprite_animation.fxh') && samplerNames.has('animatedtexture')) {
            return {
                status: 'renderable',
                templateId: isArgSenateLike(pixelCode) ? 'arg-senate-animation' : 'buttonstate-sprite-animation',
                supportReason: isArgSenateLike(pixelCode)
                    ? 'Matched the ARG senate-style buttonstate and sprite_animation reveal pattern.'
                    : 'Matched buttonstate effects with sprite_animation samplers.',
                warnings: [],
            };
        }
        return {
            status: 'renderable',
            templateId: 'buttonstate',
            supportReason: 'Matched standard buttonstate effects.',
            warnings: [],
        };
    }

    if (isProgressLike(pixelCode, constantNames, shader.source)) {
        const templateId = isRotatingNotchLike(pixelCode, shader.source)
            ? 'rotating-notch'
            : (isRadialProgressLike(pixelCode, shader.source) ? 'radial-progress' : 'progress');
        return {
            status: 'renderable',
            templateId,
            supportReason: `Matched ${templateId} progress-style shader inputs.`,
            warnings: [],
        };
    }

    if (isCustomUiAnimation(pixelCode, constantNames)) {
        return {
            status: 'metadata-only',
            templateId: 'custom-ui-animation',
            supportReason: 'Looks like a UI animation, but no dedicated render template exists yet.',
            warnings: [warning('no-template', 'This shader looks like a UI animation, but no dedicated render template exists yet. Showing metadata and texture bindings only.')],
        };
    }

    return {
        status: 'metadata-only',
        templateId: 'unknown-ui-shader',
        supportReason: 'No supported UI shader preview pattern matched this shader yet.',
        warnings: [warning('unknown-ui-shader', 'No supported UI shader preview pattern matched this shader yet.')],
    };
}

function hasButtonEffects(effectNames: Set<string>): boolean {
    return ['up', 'down', 'over', 'disable'].some(effect => effectNames.has(effect));
}

function isProgressLike(pixelCode: string, constantNames: Set<string>, source: string | undefined): boolean {
    return constantNames.has('currentstate')
        || constantNames.has('vprogress')
        || /\bvProgress\b|\bCurrentState\b|atan2\s*\(/.test(pixelCode)
        || /(?:^|[\\/])(?:progress|progress_reverse|progress_startend|progress_radial|circularprogressbar|rotating[_-]?notch)\.shader$/i.test(source ?? '');
}

function isRotatingNotchLike(pixelCode: string, source: string | undefined): boolean {
    return /rotating[_-]?notch/i.test(source ?? '') || (/atan2\s*\(/.test(pixelCode) && /\bOffset\b/.test(pixelCode));
}

function isRadialProgressLike(pixelCode: string, source: string | undefined): boolean {
    return /(?:progress[_-]?radial|circularprogressbar)/i.test(source ?? '') || pixelCode.includes('atan2');
}

function isCustomUiAnimation(pixelCode: string, constantNames: Set<string>): boolean {
    return /\bTime\s*-\s*AnimationTime\b/.test(pixelCode)
        || (constantNames.has('time') && constantNames.has('animationtime'))
        || (/\bOffset\b/.test(pixelCode) && /\btex2D\s*\(/.test(pixelCode));
}

function isArgSenateLike(pixelCode: string): boolean {
    return pixelCode.includes('timePos')
        && pixelCode.includes('colourCheck')
        && pixelCode.includes('Offset.x * 10');
}

function normalize(include: string): string {
    return include.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? include.toLowerCase();
}

function warning(code: string, message: string): UiShaderPreviewWarning {
    return {
        severity: 'warning',
        code,
        message,
    };
}
