import * as vscode from 'vscode';
import { ConfigurationKey } from '../../constants';
import { getCharacterPreviewPriority } from '../characters/detect';
import type { PreviewDescriptor } from '../descriptor';
import { LoaderPreview } from '../loaderpreview';
import { renderCharacterFile } from './contentbuilder';
import { CharactersLoader } from './loader';

function canPreviewCharacter(document: vscode.TextDocument): number | undefined {
    return getCharacterPreviewPriority(document.uri.toString(), document.uri.path, document.getText());
}

class CharacterPreview extends LoaderPreview<CharactersLoader> {
    private readonly configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new CharactersLoader(file, contentProvider), renderCharacterFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)
                || event.affectsConfiguration(`${ConfigurationKey}.featureFlags`)) {
                this.reload();
            }
        });
    }

    public shouldRefreshOnExternalFileChange(uri: vscode.Uri): boolean {
        const path = uri.path.replace(/\\/g, '/').toLowerCase();
        return /\.(?:yml|gfx|dds|tga|png|mod)$/.test(path)
            || /\/common\/(?:characters|country_leader|unit_leader|scientist_traits|modifier_definitions)\/.*\.txt$/.test(path);
    }

    public dispose(): void {
        this.configurationHandler.dispose();
        super.dispose();
    }
}

export const characterPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'character',
    canPreview: canPreviewCharacter,
    createPreview: (uri, panel) => new CharacterPreview(uri, panel),
};
