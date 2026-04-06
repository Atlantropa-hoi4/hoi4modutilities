import * as vscode from 'vscode';
import { PreviewBase } from './previewbase';

export interface PreviewDescriptorBase {
    type: string;
    canPreview(document: vscode.TextDocument): number | undefined;
}

export interface StandardPreviewDescriptor extends PreviewDescriptorBase {
    kind: 'panel';
    createPreview(uri: vscode.Uri, panel: vscode.WebviewPanel): PreviewBase;
    panelOptions?: Partial<vscode.WebviewOptions & vscode.WebviewPanelOptions>;
}

export interface AlternativePreviewDescriptor extends PreviewDescriptorBase {
    kind: 'alternative';
    onPreview(document: vscode.TextDocument): Promise<void>;
}

export type PreviewDescriptor = StandardPreviewDescriptor | AlternativePreviewDescriptor;
