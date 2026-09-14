import * as vscode from 'vscode';
import { PreviewDescriptor } from '../descriptor';
import { PreviewBase } from '../previewbase';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { matchPathEnd } from '../../util/nodecommon';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';
import { getMioPreviewPriority } from './detect';
import { documentSampleContainsAny, getDocumentPreviewSample } from '../previewdetect';
import { MioEditCommandHandler } from './edithandler';
import type { MioEditMessage } from './editcommon';
import type { Mio } from './schema';

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
    private mios: Mio[] = [];
    private readonly editCommandHandler: MioEditCommandHandler;
    private readonly locallyAppliedVersions = new Set<number>();
    private readonly forcedRefreshVersions = new Set<number>();

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.mioFileLoader = new MioLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.mioFileLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.editCommandHandler = new MioEditCommandHandler({
            uri: this.uri,
            webview: this.panel.webview,
            getMios: () => this.mios,
            recordLocallyAppliedVersion: version => {
                this.locallyAppliedVersions.add(version);
                return () => this.locallyAppliedVersions.delete(version);
            },
            refreshAfterEdit: async (message, document) => {
                if (message.command === 'applyMioPositionEdits') {
                    const mio = this.mios.find(item => item.id === message.mioId);
                    for (const edit of message.edits) {
                        const trait = mio?.traits[edit.traitId];
                        if (trait) {
                            trait.x = edit.x;
                            trait.y = edit.y;
                        }
                    }
                    return;
                }
                this.forcedRefreshVersions.add(document.version);
                await this.onDocumentChange(document);
            },
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        try {
            const result = await renderMioFile(this.mioFileLoader, document.uri, this.panel.webview, document.version);
            this.mios = result.mios;
            return result.html;
        } finally {
            this.content = undefined;
        }
    }

    public override getDocumentChangeDebounceMs(): number {
        return 75;
    }

    public override async onDocumentChange(
        document: vscode.TextDocument,
        options?: { source?: 'document' | 'dependency' },
    ): Promise<void> {
        const forced = this.forcedRefreshVersions.delete(document.version);
        if (!forced && this.locallyAppliedVersions.delete(document.version)) {
            return;
        }
        this.locallyAppliedVersions.delete(document.version);
        await super.onDocumentChange(document, options);
    }

    protected async onDidReceiveMessage(message: MioEditMessage): Promise<boolean> {
        return this.editCommandHandler.handleMessage(message);
    }
}

export const mioPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'mio',
    canPreview: canPreviewMio,
    createPreview: (uri, panel) => new MioPreview(uri, panel),
};
