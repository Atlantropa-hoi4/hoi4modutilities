import * as vscode from 'vscode';
import { renderTechnologyFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewDescriptor } from '../descriptor';
import { PreviewBase } from '../previewbase';
import { TechnologyTreeLoader } from './loader';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { TechnologyEditCommandHandler } from './edithandler';
import { TechnologyEditMessage, TechnologyEditRenderContext } from './editcommon';
import { isLocalisationIndexReady, whenLocalisationIndexReady } from '../../util/localisationIndex';

function canPreviewTechnology(document: vscode.TextDocument) {
    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['common', 'technologies', '*'])) {
        return 0;
    }

    return findDocumentRegexPreviewPriority(document, /(technologies)\s*=\s*{/);
}

class TechnologyTreePreview extends PreviewBase {
    private technologyTreeLoader: TechnologyTreeLoader;
    private content: string | undefined;
    private readonly relativeFilePath: string;
    private readonly editCommandHandler: TechnologyEditCommandHandler;
    private editContext: TechnologyEditRenderContext = {
        availableTreeRootsByFolder: {},
        gridLayoutsByFolder: {},
    };
    private renderGeneration = 0;
    private renderQueue: Promise<void> = Promise.resolve();
    private locallyAppliedPositionVersions = new Set<number>();
    private pendingLocalisationRefreshVersion: number | undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        this.technologyTreeLoader = new TechnologyTreeLoader(this.relativeFilePath, () => Promise.resolve(this.content ?? ''));
        this.technologyTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.editCommandHandler = new TechnologyEditCommandHandler({
            uri: this.uri,
            relativeFilePath: this.relativeFilePath,
            webview: this.panel.webview,
            getEditContext: () => this.editContext,
            refreshDocument: document => this.onDocumentChange(document),
            recordLocallyAppliedVersion: (command, version) => {
                if (command === 'applyTechnologyPositionEdits') {
                    this.locallyAppliedPositionVersions.add(version);
                    return () => this.locallyAppliedPositionVersions.delete(version);
                }
            },
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const result = await renderTechnologyFile(this.technologyTreeLoader, document.uri, this.panel.webview, document.version);
        this.content = undefined;
        this.editContext = result.editContext;
        this.scheduleLocalisationReadyRefresh(document.version);
        return result.html;
    }

    private scheduleLocalisationReadyRefresh(documentVersion: number): void {
        if (this.isDisposed
            || isLocalisationIndexReady()
            || this.pendingLocalisationRefreshVersion === documentVersion) {
            return;
        }

        this.pendingLocalisationRefreshVersion = documentVersion;
        void whenLocalisationIndexReady({ showStatusBar: false }).then(() => {
            if (this.isDisposed || this.pendingLocalisationRefreshVersion !== documentVersion) {
                return;
            }

            this.pendingLocalisationRefreshVersion = undefined;
            const latestDocument = getDocumentByUri(this.uri);
            if (latestDocument?.version === documentVersion) {
                void this.onDocumentChange(latestDocument);
            }
        }, () => {
            if (this.pendingLocalisationRefreshVersion === documentVersion) {
                this.pendingLocalisationRefreshVersion = undefined;
            }
        });
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        if (this.locallyAppliedPositionVersions.delete(document.version)) {
            return;
        }
        const generation = ++this.renderGeneration;
        this.renderQueue = this.renderQueue
            .catch(() => undefined)
            .then(async () => {
                if (this.isDisposed || generation !== this.renderGeneration) {
                    return;
                }
                const html = await this.getContent(document);
                if (!this.isDisposed && generation === this.renderGeneration) {
                    this.panel.webview.html = html;
                }
            });
        await this.renderQueue;
    }

    public override getDocumentChangeDebounceMs(): number {
        return 75;
    }

    protected async onDidReceiveMessage(message: TechnologyEditMessage): Promise<boolean> {
        return this.editCommandHandler.handleMessage(message);
    }
}

export const technologyPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'technology',
    canPreview: canPreviewTechnology,
    createPreview: (uri, panel) => new TechnologyTreePreview(uri, panel),
};
