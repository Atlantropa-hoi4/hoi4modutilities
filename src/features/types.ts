import * as vscode from 'vscode';
import type { PreviewDescriptor } from '../previewdef/descriptor';

export type FeatureArea = 'preview' | 'editor' | 'index';

export interface FeatureRegistration {
    area: FeatureArea;
    register(): vscode.Disposable | readonly vscode.Disposable[];
}

export interface ExtensionFeature {
    id: string;
    previewDescriptors?: readonly PreviewDescriptor[];
    registrations?: readonly FeatureRegistration[];
}
