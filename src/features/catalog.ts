import * as vscode from 'vscode';
import { characterFeature } from './characters';
import { countryColorFeature } from './countrycolors';
import { decisionFeature } from './decisions';
import { eventTreeFeature } from './eventtree';
import { focusTreeFeature } from './focustree';
import { formatterFeature } from './formatter';
import { gfxFeature } from './gfx';
import { guiFeature } from './gui';
import { imageFeature } from './images';
import { ideaFeature } from './ideas';
import { localisationFeature } from './localisation';
import { mioFeature } from './mio';
import { referencesFeature } from './references';
import { technologyFeature } from './technology';
import { worldMapFeature } from './worldmap';
import { workspaceFeature } from './workspace';
import type { PreviewDescriptor } from '../previewdef/descriptor';
import type { ExtensionFeature, FeatureArea } from './types';

export const extensionFeatures: readonly ExtensionFeature[] = [
    focusTreeFeature,
    gfxFeature,
    technologyFeature,
    characterFeature,
    worldMapFeature,
    eventTreeFeature,
    guiFeature,
    mioFeature,
    imageFeature,
    ideaFeature,
    decisionFeature,
    workspaceFeature,
    referencesFeature,
    localisationFeature,
    countryColorFeature,
    formatterFeature,
];

export function getPreviewDescriptors(): PreviewDescriptor[] {
    return extensionFeatures.flatMap(feature => feature.previewDescriptors ?? []);
}

export function registerFeatureArea(area: FeatureArea): vscode.Disposable[] {
    return extensionFeatures.flatMap(feature =>
        (feature.registrations ?? [])
            .filter(registration => registration.area === area)
            .flatMap(registration => toDisposableArray(registration.register())));
}

function toDisposableArray(disposableOrArray: vscode.Disposable | readonly vscode.Disposable[]): vscode.Disposable[] {
    return Array.isArray(disposableOrArray)
        ? [...disposableOrArray]
        : [disposableOrArray as vscode.Disposable];
}
