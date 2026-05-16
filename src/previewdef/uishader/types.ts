export type UiShaderPreviewStatus = 'renderable' | 'metadata-only' | 'unsupported-map' | 'missing-input';
export type UiShaderPreviewWarningSeverity = 'info' | 'warning' | 'error';

export const uiShaderPreviewSchemaVersion = 1;

export interface UiShaderPreviewWarning {
    readonly severity: UiShaderPreviewWarningSeverity;
    readonly code: string;
    readonly message: string;
    readonly source?: string;
    readonly path?: string;
}

export type UiShaderGfxFieldValue =
    | string
    | number
    | boolean
    | readonly (string | number | boolean)[]
    | Readonly<Record<string, string | number | boolean>>;

export interface UiShaderAnimationBinding {
    readonly fields: Record<string, UiShaderGfxFieldValue>;
}

export interface UiShaderSpriteBinding {
    readonly name: string;
    readonly kind: string;
    readonly texturefile: string;
    readonly effectFile?: string;
    readonly noOfFrames: number;
    readonly tokenStart?: number;
    readonly tokenEnd?: number;
    readonly fields: Record<string, UiShaderGfxFieldValue>;
    readonly animations: UiShaderAnimationBinding[];
}

export interface UiShaderSampler {
    readonly name: string;
    readonly index: number;
    readonly magFilter?: string;
    readonly minFilter?: string;
    readonly mipFilter?: string;
    readonly addressU?: string;
    readonly addressV?: string;
}

export interface UiShaderConstant {
    readonly name: string;
    readonly type: string;
    readonly arraySize?: number;
}

export interface UiShaderConstantBuffer {
    readonly slot: number;
    readonly size: number;
    readonly constants: UiShaderConstant[];
    readonly source?: string;
}

export interface UiShaderEntrypoint {
    readonly name: string;
    readonly code: string;
    readonly source?: string;
}

export interface UiShaderEffect {
    readonly name: string;
    readonly vertexShader?: string;
    readonly pixelShader?: string;
}

export interface ParsedUiShader {
    readonly source?: string;
    readonly includes: string[];
    readonly featureFlags: string[];
    readonly samplers: UiShaderSampler[];
    readonly constantBuffers: UiShaderConstantBuffer[];
    readonly vertexShaders: UiShaderEntrypoint[];
    readonly pixelShaders: UiShaderEntrypoint[];
    readonly effects: UiShaderEffect[];
    readonly rawCodeBlocks: UiShaderEntrypoint[];
}

export interface UiShaderTextureBinding {
    readonly samplerName: string;
    readonly samplerIndex: number;
    readonly role: string;
    readonly path?: string;
    readonly uri?: string;
    readonly width?: number;
    readonly height?: number;
    readonly warning?: UiShaderPreviewWarning;
}

export interface UiShaderPreviewControls {
    readonly effects: string[];
    readonly defaultEffect?: string;
    readonly constants: Record<string, number | number[]>;
}

export type UiShaderPreviewKind =
    | 'linear-progress'
    | 'radial-progress'
    | 'rotating-notch'
    | 'texture-animation'
    | 'buttonstate'
    | 'metadata';

export type UiShaderProgressDirection =
    | 'left-to-right'
    | 'right-to-left'
    | 'top-to-bottom'
    | 'bottom-to-top'
    | 'radial-clockwise'
    | 'notch-clockwise';

export interface UiShaderPreviewVisual {
    readonly previewKind: UiShaderPreviewKind;
    readonly preferredWidth?: number;
    readonly preferredHeight?: number;
    readonly primaryTextureRole: string;
    readonly secondaryTextureRole?: string;
    readonly progressDirection: UiShaderProgressDirection;
}

export interface UiShaderResolvedInclude {
    readonly include: string;
    readonly path: string;
    readonly resolvedUri: string;
}

export interface UiShaderPreviewModel {
    readonly schemaVersion: typeof uiShaderPreviewSchemaVersion;
    readonly source: {
        readonly gfxFile: string;
        readonly spriteName: string;
        readonly effectFile?: string;
        readonly shaderPath?: string;
        readonly shaderResolvedUri?: string;
    };
    readonly sprite: {
        readonly kind: string;
        readonly texturefile: string;
        readonly noOfFrames: number;
        readonly fields: Record<string, UiShaderGfxFieldValue>;
        readonly animations: UiShaderAnimationBinding[];
    };
    readonly shader?: ParsedUiShader;
    readonly resolvedIncludes: UiShaderResolvedInclude[];
    readonly bindings: UiShaderTextureBinding[];
    readonly controls: UiShaderPreviewControls;
    readonly status: UiShaderPreviewStatus;
    readonly pattern: string;
    readonly templateId: string;
    readonly supportReason: string;
    readonly visual?: UiShaderPreviewVisual;
    readonly dependencies: string[];
    readonly warnings: UiShaderPreviewWarning[];
}
