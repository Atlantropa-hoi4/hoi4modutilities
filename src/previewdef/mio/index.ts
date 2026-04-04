import * as vscode from 'vscode';
import { PreviewProviderDef } from '../previewmanager';
import { PreviewBase } from '../previewbase';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { matchPathEnd } from '../../util/nodecommon';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';
import { getMioPreviewPriority } from './detect';

function canPreviewMio(document: vscode.TextDocument) {
    const uri = document.uri;
    if (!uri.path.toLowerCase().endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'military_industrial_organization', 'organizations', '*'])) {
        return 0;
    }

    return getMioPreviewPriority(document.getText());
}

class MioPreview extends PreviewBase {
    private mioFileLoader: MioLoader;
    private content: string | undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.mioFileLoader = new MioLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.mioFileLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const result = await renderMioFile(this.mioFileLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
}

export const mioPreviewDef: PreviewProviderDef = {
    type: 'mio',
    canPreview: canPreviewMio,
    previewContructor: MioPreview,
};
