import * as vscode from 'vscode';
import { renderEventFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewDescriptor } from '../descriptor';
import { EventsLoader } from './loader';
import { isEventTreePreviewEnabled } from '../../util/featureflags';
import { ConfigurationKey } from '../../constants';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { LoaderPreview } from '../loaderpreview';

function canPreviewEvent(document: vscode.TextDocument) {
    if (!isEventTreePreviewEnabled()) {
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

class EventPreview extends LoaderPreview<EventsLoader> {
    private configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new EventsLoader(file, contentProvider), renderEventFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)) {
                this.reload();
            }
        });
    }

    public dispose(): void {
        super.dispose();
        this.configurationHandler.dispose();
    }
}

export const eventPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'event',
    canPreview: canPreviewEvent,
    createPreview: (uri, panel) => new EventPreview(uri, panel),
};
