import * as vscode from 'vscode';
import { DDSViewProvider, TGAViewProvider } from '../ddsviewprovider';
import { ViewType } from '../constants';
import { previewManager } from '../previewdef/previewmanager';
import { worldMap } from '../previewdef/worldmap';
import { ExtensionServices } from './serviceRegistry';

export function registerPreviewServices(services: ExtensionServices): void {
    services.push(
        previewManager.register(),
        worldMap.register(),
        vscode.window.registerCustomEditorProvider(ViewType.DDS, new DDSViewProvider()),
        vscode.window.registerCustomEditorProvider(ViewType.TGA, new TGAViewProvider()),
    );
}
