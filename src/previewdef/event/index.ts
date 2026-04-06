import * as vscode from 'vscode';
import { renderEventFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { EventsLoader } from './loader';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { eventTreePreview } from '../../util/featureflags';
import { ConfigurationKey } from '../../constants';
import { findDocumentRegexPreviewPriority } from '../previewdetect';

function canPreviewEvent(document: vscode.TextDocument) {
    if (!eventTreePreview) {
        return undefined;
    }

    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['events', '*'])) {
        return 0;
    }

    return findDocumentRegexPreviewPriority(
        document,
        /(country_event|news_event|unit_leader_event|state_event|operative_leader_event)\s*=\s*{/,
    );
}

class EventPreview extends PreviewBase {
    private eventsLoader: EventsLoader;
    private content: string | undefined;
    private configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.eventsLoader = new EventsLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.eventsLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)) {
                this.reload();
            }
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const result = await renderEventFile(this.eventsLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }

    public dispose(): void {
        super.dispose();
        this.configurationHandler.dispose();
    }
}

export const eventPreviewDef: PreviewProviderDef = {
    type: 'event',
    canPreview: canPreviewEvent,
    previewContructor: EventPreview,
};
