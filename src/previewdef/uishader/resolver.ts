import * as vscode from 'vscode';
import { readFileFromModOrHOI4 } from '../../util/fileloader';
import { getImageByPath } from '../../util/image/imagecache';
import { UiShaderPreviewWarning, UiShaderTextureBinding } from './types';
import { joinShaderPath, normalizeShaderPath, shaderCandidatesForEffect, shaderDirname, unique } from './pathutils';

export interface ResolvedUiShaderFile {
    readonly requestedPath: string;
    readonly shaderPath: string;
    readonly realUri: vscode.Uri;
    readonly content: string;
    readonly candidates: string[];
    readonly warnings: UiShaderPreviewWarning[];
}

export interface ResolvedUiShaderInclude {
    readonly include: string;
    readonly path: string;
    readonly realUri: vscode.Uri;
    readonly content: string;
}

export async function resolveEffectShader(effectFile: string): Promise<ResolvedUiShaderFile | undefined> {
    const normalizedEffect = normalizeShaderPath(effectFile);
    const warnings: UiShaderPreviewWarning[] = [];
    const candidates = shaderCandidatesForEffect(normalizedEffect);
    for (const candidate of candidates) {
        const resolved = await tryReadRelativeFile(candidate);
        if (resolved) {
            if (candidate !== normalizedEffect) {
                warnings.push({
                    severity: 'info',
                    code: 'effectfile-shader-candidate',
                    message: `Resolved effectFile "${normalizedEffect}" to shader candidate "${candidate}".`,
                    path: candidate,
                });
            }
            return {
                requestedPath: normalizedEffect,
                shaderPath: candidate,
                realUri: resolved.realUri,
                content: resolved.content,
                candidates,
                warnings,
            };
        }
    }
    return undefined;
}

export async function resolveInclude(include: string, shaderPath: string, effectFile?: string): Promise<ResolvedUiShaderInclude | undefined> {
    const normalizedInclude = normalizeShaderPath(include);
    const candidates = unique([
        joinShaderPath(shaderDirname(shaderPath), normalizedInclude),
        effectFile ? joinShaderPath(shaderDirname(normalizeShaderPath(effectFile)), normalizedInclude) : undefined,
        joinShaderPath('gfx/FX', normalizedInclude),
        normalizedInclude,
    ].filter((value): value is string => !!value));

    for (const candidate of candidates) {
        const resolved = await tryReadRelativeFile(candidate);
        if (resolved) {
            return {
                include,
                path: candidate,
                realUri: resolved.realUri,
                content: resolved.content,
            };
        }
    }
    return undefined;
}

export async function resolveTextureBinding(
    samplerName: string,
    samplerIndex: number,
    role: string,
    texturePath: string | undefined,
): Promise<UiShaderTextureBinding> {
    if (!texturePath) {
        return {
            samplerName,
            samplerIndex,
            role,
            warning: {
                severity: role === 'unmapped' ? 'warning' : 'error',
                code: role === 'unmapped' ? 'unknown-sampler' : 'missing-texture-path',
                message: role === 'unmapped'
                    ? `Sampler ${samplerName} is not mapped to a known UI preview texture role.`
                    : `No texture path was found for sampler ${samplerName}.`,
            },
        };
    }

    const image = await getImageByPath(texturePath);
    if (!image) {
        return {
            samplerName,
            samplerIndex,
            role,
            path: texturePath,
            warning: {
                severity: role === 'base' ? 'error' : 'warning',
                code: 'texture-load-failed',
                message: `Texture "${texturePath}" could not be loaded.`,
                path: texturePath,
            },
        };
    }

    return {
        samplerName,
        samplerIndex,
        role,
        path: texturePath,
        uri: image.uri,
        width: image.width,
        height: image.height,
    };
}

async function tryReadRelativeFile(relativePath: string): Promise<{ content: string; realUri: vscode.Uri } | undefined> {
    try {
        const [buffer, realUri] = await readFileFromModOrHOI4(relativePath);
        return { content: buffer.toString('utf-8'), realUri };
    } catch {
        return undefined;
    }
}
