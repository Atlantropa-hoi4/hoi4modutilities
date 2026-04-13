import * as vscode from 'vscode';
import { DDSViewProvider, TGAViewProvider } from '../../ddsviewprovider';
import { ViewType } from '../../constants';
import type { ExtensionFeature } from '../types';

export const imageFeature: ExtensionFeature = {
    id: 'images',
    registrations: [
        {
            area: 'preview',
            register: () => [
                vscode.window.registerCustomEditorProvider(ViewType.DDS, new DDSViewProvider()),
                vscode.window.registerCustomEditorProvider(ViewType.TGA, new TGAViewProvider()),
            ],
        },
    ],
};
