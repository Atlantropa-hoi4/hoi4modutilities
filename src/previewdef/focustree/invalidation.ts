import type { PreviewExternalFileChange } from '../previewbase';

export enum FocusTreeInvalidation {
    None = 0,
    Structure = 1 << 0,
    Layout = 1 << 1,
    Presentation = 1 << 2,
    Assets = 1 << 3,
    Localisation = 1 << 4,
    All = Structure | Layout | Presentation | Assets | Localisation,
}

export interface FocusTreeDependencyManifest {
    structure: string[];
    layout: string[];
    presentation: string[];
    assets: string[];
    localisation: string[];
}

export function classifyFocusTreeInvalidation(changes: readonly PreviewExternalFileChange[]): FocusTreeInvalidation {
    let result = FocusTreeInvalidation.None;
    for (const change of changes) {
        const path = change.uri.path.toLowerCase();
        if (path.endsWith('.yml')) {
            result |= FocusTreeInvalidation.Localisation;
        } else if (/\.(dds|tga|png|gfx)$/.test(path)) {
            result |= FocusTreeInvalidation.Assets;
            if (path.endsWith('.gfx')) {
                result |= FocusTreeInvalidation.Presentation;
            }
        } else if (path.endsWith('.gui')) {
            result |= FocusTreeInvalidation.Layout | FocusTreeInvalidation.Presentation | FocusTreeInvalidation.Assets;
        } else if (path.endsWith('.txt')) {
            result |= path.includes('/common/national_focus/')
                ? FocusTreeInvalidation.Structure
                : FocusTreeInvalidation.Presentation;
        } else {
            result |= FocusTreeInvalidation.All;
        }
    }
    return result;
}

export function buildFocusTreeDependencyManifest(paths: readonly string[]): FocusTreeDependencyManifest {
    const manifest: FocusTreeDependencyManifest = {
        structure: [],
        layout: [],
        presentation: [],
        assets: [],
        localisation: [],
    };
    for (const path of paths) {
        const normalized = path.toLowerCase();
        if (normalized.endsWith('.yml')) {
            manifest.localisation.push(path);
        } else if (/\.(dds|tga|png)$/.test(normalized)) {
            manifest.assets.push(path);
        } else if (normalized.endsWith('.gfx')) {
            manifest.assets.push(path);
            manifest.presentation.push(path);
        } else if (normalized.endsWith('.gui')) {
            manifest.layout.push(path);
            manifest.presentation.push(path);
        } else if (normalized.endsWith('.txt')) {
            manifest.structure.push(path);
        }
    }
    return manifest;
}
