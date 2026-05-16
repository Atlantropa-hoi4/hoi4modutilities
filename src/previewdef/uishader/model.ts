import { parseUiShader, mergeParsedUiShader } from './shaderparser';
import { classifyUiShader } from './patterns';
import { resolveEffectShader, resolveInclude, resolveTextureBinding } from './resolver';
import { shaderCandidatesForEffect } from './pathutils';
import { buildUiShaderPreviewVisual } from './visual';
import {
    ParsedUiShader,
    UiShaderAnimationBinding,
    UiShaderGfxFieldValue,
    UiShaderPreviewControls,
    UiShaderPreviewModel,
    UiShaderPreviewWarning,
    uiShaderPreviewSchemaVersion,
    UiShaderResolvedInclude,
    UiShaderSpriteBinding,
    UiShaderTextureBinding,
} from './types';

const samplerTextureFields: Record<string, { role: string; fields: string[] }> = {
    maptexture: { role: 'base', fields: ['texturefile', 'texturefile1'] },
    textureone: { role: 'base', fields: ['texturefile1', 'texturefile'] },
    texturetwo: { role: 'secondary', fields: ['texturefile2', 'texturefile'] },
    masktexture: { role: 'animation-mask', fields: ['animationmaskfile'] },
    animatedtexture: { role: 'animation-texture', fields: ['animationtexturefile'] },
    masktexture2: { role: 'animation-mask-2', fields: ['animationmaskfile2', 'animationmaskfile'] },
    animatedtexture2: { role: 'animation-texture-2', fields: ['animationtexturefile2', 'animationtexturefile'] },
    maskingtexture: { role: 'masking', fields: ['maskingtexturefile', 'animationmaskfile'] },
};

export interface UiShaderPreviewModelBuilderDeps {
    resolveEffectShader: typeof resolveEffectShader;
    resolveInclude: typeof resolveInclude;
    resolveTextureBinding: typeof resolveTextureBinding;
}

const defaultBuilderDeps: UiShaderPreviewModelBuilderDeps = {
    resolveEffectShader,
    resolveInclude,
    resolveTextureBinding,
};

export async function buildUiShaderPreviewModel(
    sprite: UiShaderSpriteBinding,
    gfxFile: string,
    deps: UiShaderPreviewModelBuilderDeps = defaultBuilderDeps,
): Promise<UiShaderPreviewModel | undefined> {
    if (!sprite.effectFile) {
        return undefined;
    }

    const warnings: UiShaderPreviewWarning[] = [];
    const resolvedShader = await deps.resolveEffectShader(sprite.effectFile);
    if (!resolvedShader) {
        const candidates = shaderCandidatesForEffect(sprite.effectFile);
        warnings.push({
            severity: 'error',
            code: 'missing-shader',
            message: `Could not resolve shader for effectFile "${sprite.effectFile}". Tried: ${candidates.join(', ')}.`,
            path: sprite.effectFile,
        });
        return {
            schemaVersion: uiShaderPreviewSchemaVersion,
            source: {
                gfxFile,
                spriteName: sprite.name,
                effectFile: sprite.effectFile,
            },
            sprite: {
                kind: sprite.kind,
                texturefile: sprite.texturefile,
                noOfFrames: sprite.noOfFrames,
                fields: sprite.fields,
                animations: sprite.animations,
            },
            resolvedIncludes: [],
            bindings: [],
            controls: createControls(undefined),
            status: 'missing-input',
            pattern: 'missing-shader',
            templateId: 'missing-shader',
            supportReason: 'No shader file could be resolved from this sprite effectFile.',
            visual: buildUiShaderPreviewVisual(sprite, 'missing-shader', undefined),
            dependencies: unique([gfxFile, sprite.effectFile, ...candidates]),
            warnings,
        };
    }

    warnings.push(...resolvedShader.warnings);
    const parsedShader = parseUiShader(resolvedShader.content, resolvedShader.shaderPath);
    const includeParses: ParsedUiShader[] = [];
    const resolvedIncludes: UiShaderResolvedInclude[] = [];
    for (const include of parsedShader.includes) {
        const resolvedInclude = await deps.resolveInclude(include, resolvedShader.shaderPath, sprite.effectFile);
        if (!resolvedInclude) {
            warnings.push({
                severity: 'warning',
                code: 'missing-include',
                message: `Could not resolve include "${include}".`,
                source: resolvedShader.shaderPath,
            });
            continue;
        }
        includeParses.push(parseUiShader(resolvedInclude.content, resolvedInclude.path));
        resolvedIncludes.push({
            include,
            path: resolvedInclude.path,
            resolvedUri: resolvedInclude.realUri.toString(),
        });
    }

    const shader = mergeParsedUiShader(parsedShader, includeParses);
    const classification = classifyUiShader(resolvedShader.shaderPath, shader);
    warnings.push(...classification.warnings);

    const bindings = await Promise.all(shader.samplers
        .slice()
        .sort((a, b) => a.index - b.index)
        .map(sampler => {
            const texture = getTexturePathForSampler(sprite, sampler.name);
            const samplerInfo = samplerTextureFields[sampler.name.toLowerCase()];
            return deps.resolveTextureBinding(
                sampler.name,
                sampler.index,
                samplerInfo?.role ?? 'unmapped',
                texture,
            );
        }));
    warnings.push(...bindings.map(binding => binding.warning).filter((warning): warning is UiShaderPreviewWarning => !!warning));

    const status = resolveStatus(classification.status, bindings, warnings);

    return {
        schemaVersion: uiShaderPreviewSchemaVersion,
        source: {
            gfxFile,
            spriteName: sprite.name,
            effectFile: sprite.effectFile,
            shaderPath: resolvedShader.shaderPath,
            shaderResolvedUri: resolvedShader.realUri.toString(),
        },
        sprite: {
            kind: sprite.kind,
            texturefile: sprite.texturefile,
            noOfFrames: sprite.noOfFrames,
            fields: sprite.fields,
            animations: sprite.animations,
        },
        shader,
        resolvedIncludes,
        bindings,
        controls: createControls(shader, classification.templateId, sprite),
        status,
        pattern: classification.templateId,
        templateId: classification.templateId,
        supportReason: classification.supportReason,
        visual: buildUiShaderPreviewVisual(sprite, classification.templateId, resolvedShader.shaderPath),
        dependencies: buildDependencies(gfxFile, resolvedShader.shaderPath, resolvedIncludes, bindings, sprite),
        warnings,
    };
}

function createControls(
    shader: ParsedUiShader | undefined,
    templateId: string = 'metadata-only',
    sprite?: UiShaderSpriteBinding,
): UiShaderPreviewControls {
    const effects = shader?.effects.map(effect => effect.name) ?? [];
    const progressDefault = templateId === 'progress' || templateId === 'radial-progress' || templateId === 'rotating-notch' ? 0.5 : 0.75;
    const color = getNumberVector(sprite?.fields.color, [1, 1, 1, 1], 4);
    return {
        effects,
        defaultEffect: effects.includes('Up') ? 'Up' : effects[0],
        constants: {
            Time: 0,
            AnimationTime: 0,
            Offset: [0, 0],
            Color: color,
            vProgress: progressDefault,
            CurrentState: progressDefault,
        },
    };
}

function getTexturePathForSampler(sprite: UiShaderSpriteBinding, samplerName: string): string | undefined {
    const samplerInfo = samplerTextureFields[samplerName.toLowerCase()];
    if (!samplerInfo) {
        return undefined;
    }
    for (const field of samplerInfo.fields) {
        if (field === 'texturefile') {
            return sprite.texturefile;
        }
        const spriteValue = sprite.fields[field];
        if (typeof spriteValue === 'string') {
            return spriteValue;
        }
        const animationValue = getAnimationField(sprite.animations, field);
        if (typeof animationValue === 'string') {
            return animationValue;
        }
    }
    return undefined;
}

function getNumberVector(value: UiShaderGfxFieldValue | undefined, fallback: number[], length: number): number[] {
    if (!Array.isArray(value)) {
        return fallback;
    }
    const numbers = value.filter((entry): entry is number => typeof entry === 'number');
    if (numbers.length === 0) {
        return fallback;
    }
    return [...numbers, ...fallback].slice(0, length);
}

function getAnimationField(animations: UiShaderAnimationBinding[], field: string): UiShaderGfxFieldValue | undefined {
    for (const animation of animations) {
        const value = animation.fields[field];
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function resolveStatus(
    classifiedStatus: UiShaderPreviewModel['status'],
    bindings: UiShaderTextureBinding[],
    warnings: UiShaderPreviewWarning[],
): UiShaderPreviewModel['status'] {
    if (warnings.some(warning => warning.severity === 'error' && (warning.code === 'missing-shader' || warning.code === 'missing-texture-path' || warning.code === 'texture-load-failed'))) {
        return 'missing-input';
    }
    if (classifiedStatus === 'renderable' && bindings.some(binding => binding.warning?.code === 'unknown-sampler')) {
        return 'metadata-only';
    }
    return classifiedStatus;
}

function buildDependencies(
    gfxFile: string,
    shaderPath: string,
    resolvedIncludes: UiShaderResolvedInclude[],
    bindings: UiShaderTextureBinding[],
    sprite: UiShaderSpriteBinding,
): string[] {
    return unique([
        gfxFile,
        sprite.effectFile,
        sprite.texturefile,
        shaderPath,
        ...resolvedIncludes.map(include => include.path),
        ...bindings.map(binding => binding.path).filter((path): path is string => !!path),
    ].filter((path): path is string => !!path));
}

function unique<T>(values: T[]): T[] {
    return values.filter((value, index, array) => array.indexOf(value) === index);
}
