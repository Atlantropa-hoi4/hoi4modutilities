import * as vscode from 'vscode';
import { renderGfxFile } from './contentbuilder';
import { PreviewDescriptor } from '../descriptor';
import { PreviewBase } from '../previewbase';

function canPreviewGfx(document: vscode.TextDocument) {
    const uri = document.uri;
    return uri.path.toLowerCase().endsWith('.gfx') ? 0 : undefined;
}

class GfxPreview extends PreviewBase {
    protected getContent(document: vscode.TextDocument): Promise<string> {
        return renderGfxFile(document.getText(), document.uri, this.panel.webview);
    }
}

export const gfxPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'gfx',
    canPreview: canPreviewGfx,
    createPreview: (uri, panel) => new GfxPreview(uri, panel),
};
