import {
    UiShaderGfxFieldValue,
    UiShaderPreviewModel,
    UiShaderPreviewVisual,
    UiShaderSpriteBinding,
    UiShaderTextureBinding,
} from './types';

const progressTemplateIds = new Set(['progress', 'radial-progress', 'rotating-notch']);

export function buildUiShaderPreviewVisual(
    sprite: UiShaderSpriteBinding,
    templateId: string,
    shaderPath: string | undefined,
): UiShaderPreviewVisual {
    const size = getSize(sprite.fields.size);
    const previewKind = getPreviewKind(templateId);
    return {
        previewKind,
        preferredWidth: size?.width,
        preferredHeight: size?.height,
        primaryTextureRole: 'base',
        secondaryTextureRole: previewKind === 'linear-progress' || previewKind === 'radial-progress' || previewKind === 'rotating-notch'
            ? 'secondary'
            : undefined,
        progressDirection: getProgressDirection(templateId, shaderPath, sprite),
    };
}

export function chooseInitialUiShaderSprite(models: Record<string, UiShaderPreviewModel>): string | undefined {
    const entries = Object.entries(models);
    return entries.find(([, model]) => model.status === 'renderable' && isProgressPreview(model))?.[0]
        ?? entries.find(([, model]) => model.status === 'renderable')?.[0]
        ?? entries.find(([, model]) => model.status === 'metadata-only')?.[0]
        ?? entries[0]?.[0];
}

export function isProgressPreview(model: Pick<UiShaderPreviewModel, 'templateId' | 'visual'>): boolean {
    return progressTemplateIds.has(model.templateId)
        || model.visual?.previewKind === 'linear-progress'
        || model.visual?.previewKind === 'radial-progress'
        || model.visual?.previewKind === 'rotating-notch';
}

export function getUiShaderCanvasSize(
    model: Pick<UiShaderPreviewModel, 'visual'>,
    texture: Pick<UiShaderTextureBinding, 'width' | 'height'> | undefined,
): { width: number; height: number } {
    const sourceWidth = model.visual?.preferredWidth ?? texture?.width ?? 320;
    const sourceHeight = model.visual?.preferredHeight ?? texture?.height ?? 220;
    return fitSize(sourceWidth, sourceHeight, 720, 420, 320);
}

export function getUiShaderProgressDirection(model: Pick<UiShaderPreviewModel, 'visual' | 'templateId' | 'source' | 'sprite'>): UiShaderPreviewVisual['progressDirection'] {
    return model.visual?.progressDirection ?? getProgressDirection(model.templateId, model.source.shaderPath, {
        effectFile: model.source.effectFile,
        fields: model.sprite.fields,
    });
}

function getPreviewKind(templateId: string): UiShaderPreviewVisual['previewKind'] {
    if (templateId === 'radial-progress') {
        return 'radial-progress';
    }
    if (templateId === 'rotating-notch') {
        return 'rotating-notch';
    }
    if (templateId === 'progress') {
        return 'linear-progress';
    }
    if (templateId === 'buttonstate-sprite-animation' || templateId === 'arg-senate-animation') {
        return 'texture-animation';
    }
    if (templateId === 'buttonstate') {
        return 'buttonstate';
    }
    return 'metadata';
}

function getProgressDirection(
    templateId: string,
    shaderPath: string | undefined,
    sprite: Pick<UiShaderSpriteBinding, 'fields' | 'effectFile'>,
): UiShaderPreviewVisual['progressDirection'] {
    if (templateId === 'radial-progress') {
        return 'radial-clockwise';
    }
    if (templateId === 'rotating-notch') {
        return 'notch-clockwise';
    }
    const path = `${shaderPath ?? ''} ${sprite.effectFile ?? ''}`.toLowerCase();
    if (path.includes('reverse')) {
        return 'right-to-left';
    }
    if (sprite.fields.horizontal === false) {
        return 'bottom-to-top';
    }
    return 'left-to-right';
}

function getSize(value: UiShaderGfxFieldValue | undefined): { width: number; height: number } | undefined {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        return undefined;
    }
    const record = value as Readonly<Record<string, string | number | boolean>>;
    const width = typeof record.x === 'number' ? record.x : undefined;
    const height = typeof record.y === 'number' ? record.y : undefined;
    if (!width || !height) {
        return undefined;
    }
    return { width, height };
}

function fitSize(width: number, height: number, maxWidth: number, maxHeight: number, minWidth: number): { width: number; height: number } {
    if (width <= 0 || height <= 0) {
        return { width: 320, height: 220 };
    }
    const scale = Math.min(maxWidth / width, maxHeight / height, Math.max(1, minWidth / width));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}
