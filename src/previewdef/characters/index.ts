import * as vscode from 'vscode';
import { PreviewDescriptor } from '../descriptor';
import { PreviewBase } from '../previewbase';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { getCharacterPreviewPriority } from './detect';
import { renderCharacterFile } from './contentbuilder';

const characterLiveRefreshExtensions = new Set(['.txt', '.gfx', '.dds', '.tga', '.png', '.mod']);

function canPreviewCharacter(document: vscode.TextDocument): number | undefined {
    return getCharacterPreviewPriority(document.uri.toString(), document.uri.path);
}

class CharacterPreview extends PreviewBase {
    private readonly relativeFilePath: string;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        const result = await renderCharacterFile(document.getText(), this.relativeFilePath, document.uri, this.panel.webview);
        this.updateDependencies(result.dependencies);
        return result.html;
    }

    public override shouldRefreshOnExternalFileChange(uri: vscode.Uri, changeKind: 'change' | 'create' | 'delete'): boolean {
        const lowerPath = uri.path.toLowerCase();
        const extension = lowerPath.slice(lowerPath.lastIndexOf('.'));
        if (!characterLiveRefreshExtensions.has(extension)) {
            return false;
        }

        if (uri.toString() === this.uri.toString()) {
            return true;
        }

        if (extension === '.txt') {
            return changeKind !== 'delete'
                && (lowerPath.includes('/common/characters/') || lowerPath.includes('\\common\\characters\\'));
        }

        if (extension === '.gfx') {
            return lowerPath.includes('/interface/') || lowerPath.includes('\\interface\\');
        }

        if (extension === '.dds' || extension === '.tga' || extension === '.png') {
            return lowerPath.includes('/gfx/') || lowerPath.includes('\\gfx\\');
        }

        return extension === '.mod';
    }
}

export const characterPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'character',
    canPreview: canPreviewCharacter,
    createPreview: (uri, panel) => new CharacterPreview(uri, panel),
};
