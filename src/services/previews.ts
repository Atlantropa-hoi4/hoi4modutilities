import * as vscode from 'vscode';
import { DDSViewProvider, TGAViewProvider } from '../ddsviewprovider';
import { ViewType } from '../constants';
import { worldMap } from '../previewdef/worldmap';
import { ExtensionServices } from './serviceRegistry';
import { PreviewManager } from '../previewdef/previewmanager';
import { defaultPreviewProviders } from '../previewdef/previewproviders';

export function registerPreviewServices(services: ExtensionServices): void {
    const previewManager = new PreviewManager({
        previewProviders: defaultPreviewProviders,
    });

    services.push(
        previewManager.register(),
        worldMap.register(),
        vscode.window.registerCustomEditorProvider(ViewType.DDS, new DDSViewProvider()),
        vscode.window.registerCustomEditorProvider(ViewType.TGA, new TGAViewProvider()),
    );
}
