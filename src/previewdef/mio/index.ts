import * as vscode from 'vscode';
import { PreviewDescriptor } from '../descriptor';
import { PreviewBase } from '../previewbase';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { matchPathEnd } from '../../util/nodecommon';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';
import { getMioPreviewPriority } from './detect';
import { documentSampleContainsAny, getDocumentPreviewSample } from '../previewdetect';

const mioPreviewHintKeywords = [
    'trait',
    'add_trait',
    'override_trait',
    'remove_trait',
    'equipment_bonus',
    'production_bonus',
    'organization_modifier',
    'special_trait_background',
] as const;

function canPreviewMio(document: vscode.TextDocument) {
    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['common', 'military_industrial_organization', 'organizations', '*'])) {
        return 0;
    }

    if (!documentSampleContainsAny(document, mioPreviewHintKeywords)) {
        return undefined;
    }

    return getMioPreviewPriority(getDocumentPreviewSample(document));
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

export const mioPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'mio',
    canPreview: canPreviewMio,
    createPreview: (uri, panel) => new MioPreview(uri, panel),
};
