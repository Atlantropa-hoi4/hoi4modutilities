import * as assert from 'assert';
import Module = require('module');
import { extractUiShaderSpriteBindings } from '../../src/previewdef/uishader/gfxbinding';
import { classifyUiShader } from '../../src/previewdef/uishader/patterns';
import { shaderCandidatesForEffect } from '../../src/previewdef/uishader/pathutils';
import { mergeParsedUiShader, parseUiShader } from '../../src/previewdef/uishader/shaderparser';
import { chooseInitialUiShaderSprite, getUiShaderCanvasSize, getUiShaderProgressDirection } from '../../src/previewdef/uishader/visual';

const argSenateShader = `Includes = {
    "buttonstate.fxh"
    "sprite_animation.fxh"
}

PixelShader =
{
    Samplers =
    {
        MapTexture = { Index = 0 MagFilter = "Linear" MinFilter = "Linear" AddressU = "Clamp" AddressV = "Clamp" }
        MaskTexture = { Index = 1 MagFilter = "Linear" MinFilter = "Linear" AddressU = "Clamp" AddressV = "Clamp" }
        AnimatedTexture = { Index = 2 MagFilter = "Linear" MinFilter = "Linear" AddressU = "Wrap" AddressV = "Wrap" }
        MaskTexture2 = { Index = 3 MagFilter = "Linear" MinFilter = "Linear" AddressU = "Clamp" AddressV = "Clamp" }
        AnimatedTexture2 = { Index = 4 MagFilter = "Linear" MinFilter = "Linear" AddressU = "Wrap" AddressV = "Wrap" }
        MaskingTexture = { Index = 5 MagFilter = "Point" MinFilter = "Point" AddressU = "Clamp" AddressV = "Clamp" }
    }
}

VertexShader =
{
    MainCode VertexShader
    [[
        VS_OUTPUT main(const VS_INPUT v )
        {
            float value = (Offset.x * 10.f) + 1.f;
            return Out;
        }
    ]]
}

PixelShader =
{
    MainCode PixelShaderUp
    [[
        float4 main( VS_OUTPUT v ) : PDX_COLOR
        {
            float4 OutColor = tex2D( MapTexture, v.vTexCoord );
            float value = (Offset.x * 10.f) + 1.f;
            float currentPos = floor(value/10000.f);
            float totalPos = floor(value/10.f) - (currentPos * 1000.f);
            float vTime = (Time - AnimationTime);
            float timePos = floor(totalPos * cos(vTime * 0.5f));
            float colourCheck = 0.f;
            return OutColor;
        }
    ]]
    MainCode PixelShaderDown [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { return tex2D( MapTexture, v.vTexCoord ); } ]]
    MainCode PixelShaderDisable [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { return tex2D( MapTexture, v.vTexCoord ); } ]]
    MainCode PixelShaderOver [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { return tex2D( MapTexture, v.vTexCoord ); } ]]
}

Effect Up { VertexShader = "VertexShader" PixelShader = "PixelShaderUp" }
Effect Down { VertexShader = "VertexShader" PixelShader = "PixelShaderDown" }
Effect Disable { VertexShader = "VertexShader" PixelShader = "PixelShaderDisable" }
Effect Over { VertexShader = "VertexShader" PixelShader = "PixelShaderOver" }
`;

describe('UI shader preview', () => {
    it('extracts shader-related sprite bindings from gfx files', () => {
        const bindings = extractUiShaderSpriteBindings(`spriteTypes = {
    spriteType = {
        name = "GFX_ARG_senate"
        texturefile = "gfx/interface/arg/senate.dds"
        effectFile = "gfx/FX/ARG_senate_animation.lua"
        noOfFrames = 3
        animation = {
            animationmaskfile = "gfx/interface/arg/senate_mask.dds"
            animationtexturefile = "gfx/interface/arg/senate_anim.dds"
            animationlooping = yes
            animationtime = 0.75
        }
        animation = {
            animationmaskfile2 = "gfx/interface/arg/senate_mask_2.dds"
            animationtexturefile2 = "gfx/interface/arg/senate_anim_2.dds"
        }
    }
    spriteType = {
        name = "GFX_no_shader"
        texturefile = "gfx/interface/arg/plain.dds"
    }
    progressbartype = {
        name = "GFX_progress"
        textureFile1 = "gfx/interface/progress/full.dds"
        textureFile2 = "gfx/interface/progress/empty.dds"
        color = { 0 0.305 0.635 0 }
        size = { x = 350 y = 20 }
        horizontal = yes
        effectFile = "gfx/FX/progress.lua"
    }
}`, 'test.gfx');

        assert.strictEqual(bindings.length, 3);
        assert.strictEqual(bindings[0].name, 'GFX_ARG_senate');
        assert.strictEqual(bindings[0].kind, 'spritetype');
        assert.strictEqual(bindings[0].texturefile, 'gfx/interface/arg/senate.dds');
        assert.strictEqual(bindings[0].effectFile, 'gfx/FX/ARG_senate_animation.lua');
        assert.strictEqual(bindings[0].noOfFrames, 3);
        assert.deepStrictEqual(bindings[0].animations[0].fields, {
            animationmaskfile: 'gfx/interface/arg/senate_mask.dds',
            animationtexturefile: 'gfx/interface/arg/senate_anim.dds',
            animationlooping: true,
            animationtime: 0.75,
        });
        assert.deepStrictEqual(bindings[0].animations[1].fields, {
            animationmaskfile2: 'gfx/interface/arg/senate_mask_2.dds',
            animationtexturefile2: 'gfx/interface/arg/senate_anim_2.dds',
        });
        assert.strictEqual(bindings[1].effectFile, undefined);
        assert.strictEqual(bindings[2].kind, 'progressbartype');
        assert.strictEqual(bindings[2].texturefile, 'gfx/interface/progress/full.dds');
        assert.strictEqual(bindings[2].effectFile, 'gfx/FX/progress.lua');
        assert.strictEqual(bindings[2].fields.texturefile2, 'gfx/interface/progress/empty.dds');
        assert.deepStrictEqual(bindings[2].fields.color, [0, 0.305, 0.635, 0]);
        assert.deepStrictEqual(bindings[2].fields.size, { x: 350, y: 20 });
        assert.strictEqual(bindings[2].fields.horizontal, true);
    });

    it('extracts ARG senate shader includes, samplers, effects, and include constants', () => {
        const shader = parseUiShader(argSenateShader, 'gfx/FX/ARG_senate_animation.shader');
        const buttonstate = parseUiShader(`ConstantBuffer( 0, 0 ) {
    float4x4 WorldViewProjectionMatrix;
    float4 Color;
    float2 Offset;
    float2 NextOffset;
    float Time;
    float AnimationTime;
}`, 'buttonstate.fxh');
        const spriteAnimation = parseUiShader(`ConstantBuffer( 1, 7 ) {
    float4 ConstantData[10];
}
Code [[ float4 Animate(float4 BaseColor) { return BaseColor; } ]]`, 'sprite_animation.fxh');
        const merged = mergeParsedUiShader(shader, [buttonstate, spriteAnimation]);

        assert.deepStrictEqual(shader.includes, ['buttonstate.fxh', 'sprite_animation.fxh']);
        assert.deepStrictEqual(shader.samplers.map(s => [s.name, s.index]), [
            ['MapTexture', 0],
            ['MaskTexture', 1],
            ['AnimatedTexture', 2],
            ['MaskTexture2', 3],
            ['AnimatedTexture2', 4],
            ['MaskingTexture', 5],
        ]);
        assert.deepStrictEqual(shader.effects.map(e => e.name), ['Up', 'Down', 'Disable', 'Over']);
        assert.ok(merged.constantBuffers.some(buffer => buffer.constants.some(constant => constant.name === 'AnimationTime')));
        assert.ok(merged.constantBuffers.some(buffer => buffer.constants.some(constant => constant.name === 'ConstantData' && constant.arraySize === 10)));

        const preprocessed = parseUiShader(`VertexStruct VS_OUTPUT {
@ifdef ANIMATED
    float4 vAnimatedTexCoord : TEXCOORD1;
@endif
};`);
        assert.deepStrictEqual(preprocessed.featureFlags, ['ANIMATED']);
    });

    it('classifies supported UI patterns and excludes map shaders', () => {
        const shader = mergeParsedUiShader(parseUiShader(argSenateShader), [
            parseUiShader('ConstantBuffer( 0, 0 ) { float Time; float AnimationTime; float2 Offset; }', 'buttonstate.fxh'),
        ]);
        const argClassification = classifyUiShader('gfx/FX/ARG_senate_animation.shader', shader);
        assert.strictEqual(argClassification.status, 'renderable');
        assert.strictEqual(argClassification.templateId, 'arg-senate-animation');
        assert.match(argClassification.supportReason, /ARG senate/);

        const mapClassification = classifyUiShader('gfx/FX/pdxmap.shader', shader);
        assert.strictEqual(mapClassification.status, 'unsupported-map');
        assert.strictEqual(mapClassification.warnings[0].code, 'unsupported-map-shader');
    });

    it('classifies progress shader visual families from common shader paths', () => {
        const progressShader = parseUiShader(`ConstantBuffer( 0, 0 ) { float CurrentState; }
PixelShader = { MainCode PixelShader [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { return v.vTexCoord0.x < CurrentState ? tex2D(TextureOne, v.vTexCoord0.xy) : tex2D(TextureTwo, v.vTexCoord0.xy); } ]] }`, 'gfx/FX/progress.shader');
        const radialShader = parseUiShader(`PixelShader = { MainCode PixelShader [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { return tex2D(TextureOne, v.vTexCoord0.xy); } ]] }`, 'gfx/FX/circularprogressbar.shader');
        const notchShader = parseUiShader(`PixelShader = { MainCode PixelShader [[ float4 main( VS_OUTPUT v ) : PDX_COLOR { float a = atan2(Offset.x, Offset.y); return tex2D(TextureOne, v.vTexCoord0.xy); } ]] }`, 'gfx/FX/rotating_notch.shader');

        assert.strictEqual(classifyUiShader('gfx/FX/progress.shader', progressShader).templateId, 'progress');
        assert.strictEqual(classifyUiShader('gfx/FX/progress_reverse.shader', progressShader).templateId, 'progress');
        assert.strictEqual(classifyUiShader('gfx/FX/progress_radial.shader', radialShader).templateId, 'radial-progress');
        assert.strictEqual(classifyUiShader('gfx/FX/circularprogressbar.shader', radialShader).templateId, 'radial-progress');
        assert.strictEqual(classifyUiShader('gfx/FX/rotating_notch.shader', notchShader).templateId, 'rotating-notch');
    });

    it('derives shader candidates from lua effect files', () => {
        assert.deepStrictEqual(
            shaderCandidatesForEffect('gfx/FX/ARG_senate_animation.lua'),
            ['gfx/FX/ARG_senate_animation.shader'],
        );
        assert.deepStrictEqual(
            shaderCandidatesForEffect('gfx/FX/buttonstate.shader'),
            ['gfx/FX/buttonstate.shader'],
        );
    });

    it('builds model v1 with dependencies and structured warnings', async () => {
        const { buildUiShaderPreviewModel } = loadModelModuleWithVscodeMock();
        const model = await buildUiShaderPreviewModel({
            name: 'GFX_ARG_senate',
            kind: 'spritetype',
            texturefile: 'gfx/interface/arg/senate.dds',
            effectFile: 'gfx/FX/ARG_senate_animation.lua',
            noOfFrames: 1,
            fields: {
                texturefile: 'gfx/interface/arg/senate.dds',
            },
            animations: [{
                fields: {
                    animationmaskfile: 'gfx/interface/arg/senate_mask.dds',
                    animationtexturefile: 'gfx/interface/arg/senate_anim.dds',
                },
            }],
        }, 'interface/arg.gfx', {
            resolveEffectShader: async () => ({
                requestedPath: 'gfx/FX/ARG_senate_animation.lua',
                shaderPath: 'gfx/FX/ARG_senate_animation.shader',
                realUri: { toString: () => 'file:///shader' } as any,
                content: `${argSenateShader}
PixelShader = { Samplers = { UnknownTexture = { Index = 9 } } }`,
                candidates: ['gfx/FX/ARG_senate_animation.shader'],
                warnings: [{
                    severity: 'info',
                    code: 'effectfile-shader-candidate',
                    message: 'Resolved lua to shader.',
                    path: 'gfx/FX/ARG_senate_animation.shader',
                }],
            }),
            resolveInclude: async (include: string) => ({
                include,
                path: `gfx/FX/${include}`,
                realUri: { toString: () => `file:///${include}` } as any,
                content: include === 'buttonstate.fxh'
                    ? 'ConstantBuffer( 0, 0 ) { float4 Color; float2 Offset; float Time; float AnimationTime; }'
                    : 'ConstantBuffer( 1, 7 ) { float4 ConstantData[10]; } Code [[ float4 Animate(float4 BaseColor) { return BaseColor; } ]]',
            }),
            resolveTextureBinding: async (samplerName: string, samplerIndex: number, role: string, texturePath: string | undefined) => ({
                samplerName,
                samplerIndex,
                role,
                path: texturePath,
                uri: texturePath ? `data:${texturePath}` : undefined,
                width: texturePath ? 16 : undefined,
                height: texturePath ? 16 : undefined,
                warning: role === 'unmapped'
                    ? {
                        severity: 'warning',
                        code: 'unknown-sampler',
                        message: `Unknown sampler ${samplerName}.`,
                    }
                    : undefined,
            }),
        });

        assert.ok(model);
        assert.strictEqual(model.schemaVersion, 1);
        assert.strictEqual(model.templateId, 'arg-senate-animation');
        assert.strictEqual(model.status, 'metadata-only');
        assert.ok(model.dependencies.includes('interface/arg.gfx'));
        assert.ok(model.dependencies.includes('gfx/FX/ARG_senate_animation.shader'));
        assert.ok(model.dependencies.includes('gfx/FX/buttonstate.fxh'));
        assert.ok(model.dependencies.includes('gfx/interface/arg/senate_anim.dds'));
        assert.ok(model.warnings.some(warning => warning.code === 'unknown-sampler'));
        assert.ok(model.resolvedIncludes.some(include => include.path === 'gfx/FX/sprite_animation.fxh'));
    });

    it('binds progressbartype TextureOne and TextureTwo from textureFile1 and textureFile2', async () => {
        const { buildUiShaderPreviewModel } = loadModelModuleWithVscodeMock();
        const model = await buildUiShaderPreviewModel({
            name: 'GFX_progress',
            kind: 'progressbartype',
            texturefile: 'gfx/interface/progress/full.dds',
            effectFile: 'gfx/FX/progress.lua',
            noOfFrames: 1,
            fields: {
                texturefile1: 'gfx/interface/progress/full.dds',
                texturefile2: 'gfx/interface/progress/empty.dds',
                color: [0, 0.305, 0.635, 0],
                size: { x: 350, y: 20 },
                steps: 100,
                horizontal: true,
            },
            animations: [],
        }, 'interface/progress.gfx', {
            resolveEffectShader: async () => ({
                requestedPath: 'gfx/FX/progress.lua',
                shaderPath: 'gfx/FX/progress.shader',
                realUri: { toString: () => 'file:///progress.shader' } as any,
                content: `PixelShader = {
    Samplers = {
        TextureOne = { Index = 0 }
        TextureTwo = { Index = 1 }
    }
    MainCode PixelShader [[
        float4 main( VS_OUTPUT v ) : PDX_COLOR {
            if (v.vTexCoord0.x < CurrentState) { return tex2D( TextureOne, v.vTexCoord0.xy ); }
            return tex2D( TextureTwo, v.vTexCoord0.xy );
        }
    ]]
}
Effect Up { PixelShader = "PixelShader" }`,
                candidates: ['gfx/FX/progress.shader'],
                warnings: [],
            }),
            resolveInclude: async () => undefined,
            resolveTextureBinding: async (samplerName: string, samplerIndex: number, role: string, texturePath: string | undefined) => ({
                samplerName,
                samplerIndex,
                role,
                path: texturePath,
                uri: texturePath ? `data:${texturePath}` : undefined,
                width: 16,
                height: 16,
            }),
        });

        assert.ok(model);
        assert.strictEqual(model.templateId, 'progress');
        assert.strictEqual(model.status, 'renderable');
        assert.deepStrictEqual(model.bindings.map(binding => [binding.samplerName, binding.role, binding.path]), [
            ['TextureOne', 'base', 'gfx/interface/progress/full.dds'],
            ['TextureTwo', 'secondary', 'gfx/interface/progress/empty.dds'],
        ]);
        assert.deepStrictEqual(model.controls.constants.Color, [0, 0.305, 0.635, 0]);
        assert.strictEqual(model.visual?.previewKind, 'linear-progress');
        assert.strictEqual(model.visual?.preferredWidth, 350);
        assert.strictEqual(model.visual?.preferredHeight, 20);
        assert.strictEqual(model.visual?.progressDirection, 'left-to-right');
        assert.ok(model.dependencies.includes('gfx/interface/progress/empty.dds'));
    });

    it('chooses visual panel defaults for progress models first', () => {
        const models = {
            meta: { status: 'metadata-only', templateId: 'unknown-ui-shader' },
            button: { status: 'renderable', templateId: 'buttonstate' },
            progress: { status: 'renderable', templateId: 'progress' },
        };

        assert.strictEqual(chooseInitialUiShaderSprite(models as any), 'progress');
        assert.deepStrictEqual(getUiShaderCanvasSize({
            visual: {
                previewKind: 'linear-progress',
                preferredWidth: 350,
                preferredHeight: 20,
                primaryTextureRole: 'base',
                secondaryTextureRole: 'secondary',
                progressDirection: 'left-to-right',
            },
        }, undefined), { width: 350, height: 20 });
        assert.strictEqual(getUiShaderProgressDirection({
            templateId: 'progress',
            visual: undefined,
            source: {
                gfxFile: 'interface/progress.gfx',
                spriteName: 'GFX_progress',
                effectFile: 'gfx/FX/progress_reverse.lua',
                shaderPath: 'gfx/FX/progress_reverse.shader',
            },
            sprite: {
                kind: 'progressbartype',
                texturefile: 'gfx/interface/progress/full.dds',
                noOfFrames: 1,
                fields: {
                    texturefile1: 'gfx/interface/progress/full.dds',
                    texturefile2: 'gfx/interface/progress/empty.dds',
                    horizontal: true,
                },
                animations: [],
            },
        } as any), 'right-to-left');
    });

    it('reports failed shader candidates in missing-input models', async () => {
        const { buildUiShaderPreviewModel } = loadModelModuleWithVscodeMock();
        const model = await buildUiShaderPreviewModel({
            name: 'GFX_missing_shader',
            kind: 'spritetype',
            texturefile: 'gfx/interface/missing.dds',
            effectFile: 'gfx/FX/missing_effect.lua',
            noOfFrames: 1,
            fields: {
                texturefile: 'gfx/interface/missing.dds',
            },
            animations: [],
        }, 'interface/missing.gfx', {
            resolveEffectShader: async () => undefined,
            resolveInclude: async () => undefined,
            resolveTextureBinding: async (samplerName: string, samplerIndex: number, role: string) => ({
                samplerName,
                samplerIndex,
                role,
            }),
        });

        assert.ok(model);
        assert.strictEqual(model.status, 'missing-input');
        assert.strictEqual(model.templateId, 'missing-shader');
        assert.ok(model.dependencies.includes('gfx/FX/missing_effect.shader'));
        assert.strictEqual(model.warnings[0].code, 'missing-shader');
        assert.match(model.warnings[0].message, /Tried: gfx\/FX\/missing_effect\.shader/);
    });

    it('renders the visual shader panel and sprite trigger in gfx preview HTML', async () => {
        const { renderGfxFile } = loadGfxContentBuilderWithMocks();
        const result = await renderGfxFile(`spriteTypes = {
    spriteType = {
        name = "GFX_shader_shell"
        texturefile = "gfx/interface/shell.dds"
        effectFile = "gfx/FX/shell.lua"
    }
}`, { toString: () => 'file:///interface/shell.gfx' } as any, {
            cspSource: 'vscode-resource:',
            asWebviewUri: () => 'static-resource',
        } as any);

        assert.match(result, /window\.uiShaderPreviewModels/);
        assert.match(result, /id="uiShaderVisualPanel"/);
        assert.match(result, /id="uiShaderVisualPanelMount"/);
        assert.match(result, /uiShaderPreviewTrigger/);
        assert.match(result, /data-sprite-name="GFX_shader_shell"/);
        assert.match(result, /Shader Preview: buttonstate/);
        assert.match(result, /fixture warning/);
    });

    it('renders the visual shader panel even when no shader models are available', async () => {
        const { renderGfxFile } = loadGfxContentBuilderWithMocks();
        const result = await renderGfxFile(`spriteTypes = {
    spriteType = {
        name = "GFX_plain_shell"
        texturefile = "gfx/interface/plain.dds"
    }
}`, { toString: () => 'file:///interface/plain.gfx' } as any, {
            cspSource: 'vscode-resource:',
            asWebviewUri: () => 'static-resource',
        } as any);

        assert.match(result, /window\.uiShaderPreviewModels/);
        assert.match(result, /id="uiShaderVisualPanel"/);
        assert.match(result, /id="uiShaderVisualPanelMount"/);
        assert.match(result, /data-model-count="0"/);
        assert.match(result, /Loading UI shader preview/);
        assert.doesNotMatch(result, /uiShaderPreviewTrigger/);
    });
});

function loadModelModuleWithVscodeMock(): typeof import('../../src/previewdef/uishader/model') {
    const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
    const originalLoad = nodeModule._load;
    nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
        if (request === 'vscode') {
            return {
                Uri: {
                    parse: (value: string) => ({ toString: () => value }),
                    joinPath: (...parts: unknown[]) => ({ toString: () => parts.join('/') }),
                    file: (value: string) => ({ toString: () => value }),
                },
                workspace: {},
                window: {},
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require('../../src/previewdef/uishader/model') as typeof import('../../src/previewdef/uishader/model');
    } finally {
        nodeModule._load = originalLoad;
    }
}

function loadGfxContentBuilderWithMocks(): typeof import('../../src/previewdef/gfx/contentbuilder') {
    const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
    const originalLoad = nodeModule._load;
    nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
        if (request === 'vscode') {
            return {
                env: { language: 'en' },
                Uri: {
                    joinPath: () => ({ toString: () => 'joined' }),
                },
            };
        }
        if (request.endsWith('/util/i18n') || request === '../../util/i18n') {
            return {
                localize: (_key: string, message: string, ...args: unknown[]) =>
                    message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
            };
        }
        if (request.endsWith('/util/image/imagecache') || request === '../../util/image/imagecache') {
            return {
                getImageByPath: async () => ({
                    width: 16,
                    height: 16,
                    path: 'file:///gfx/interface/shell.dds',
                    uri: 'data:image/png;base64,AAAA',
                }),
            };
        }
        if (request.endsWith('/uishader/model') || request === '../uishader/model') {
            return {
                buildUiShaderPreviewModel: async (sprite: { effectFile?: string }) => sprite.effectFile ? ({
                    schemaVersion: 1,
                    source: {
                        gfxFile: 'file:///interface/shell.gfx',
                        spriteName: 'GFX_shader_shell',
                        effectFile: 'gfx/FX/shell.lua',
                        shaderPath: 'gfx/FX/shell.shader',
                    },
                    sprite: {
                        kind: 'spritetype',
                        texturefile: 'gfx/interface/shell.dds',
                        noOfFrames: 1,
                        fields: {
                            texturefile: 'gfx/interface/shell.dds',
                        },
                        animations: [],
                    },
                    shader: {
                        source: 'gfx/FX/shell.shader',
                        includes: [],
                        featureFlags: [],
                        samplers: [],
                        constantBuffers: [],
                        vertexShaders: [],
                        pixelShaders: [],
                        effects: [{ name: 'Up', vertexShader: 'VertexShader', pixelShader: 'PixelShader' }],
                        rawCodeBlocks: [],
                    },
                    resolvedIncludes: [],
                    bindings: [],
                    controls: {
                        effects: ['Up'],
                        defaultEffect: 'Up',
                        constants: {},
                    },
                    status: 'renderable',
                    pattern: 'buttonstate',
                    templateId: 'buttonstate',
                    supportReason: 'fixture support',
                    visual: {
                        previewKind: 'buttonstate',
                        primaryTextureRole: 'base',
                        progressDirection: 'left-to-right',
                    },
                    dependencies: ['interface/shell.gfx', 'gfx/FX/shell.shader'],
                    warnings: [{
                        severity: 'warning',
                        code: 'fixture-warning',
                        message: 'fixture warning',
                    }],
                }) : undefined,
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve('../../src/previewdef/gfx/contentbuilder')];
        return require('../../src/previewdef/gfx/contentbuilder') as typeof import('../../src/previewdef/gfx/contentbuilder');
    } finally {
        nodeModule._load = originalLoad;
    }
}
