import * as vscode from 'vscode';
import { ConfigurationKey } from '../../constants';
import { isIdeaPreviewEnabled } from '../../util/featureflags';
import { matchPathEnd } from '../../util/nodecommon';
import type { PreviewDescriptor } from '../descriptor';
import { LoaderPreview } from '../loaderpreview';
import { renderIdeaFile } from './contentbuilder';
import { IdeasLoader } from './loader';

function canPreviewIdea(document: vscode.TextDocument): number | undefined {
    if (!isIdeaPreviewEnabled() || !document.uri.path.toLowerCase().endsWith('.txt')) {
        return undefined;
    }
    return matchPathEnd(document.uri.toString().toLowerCase(), ['common', 'ideas', '*'])
        ? 0
        : undefined;
}

class IdeaPreview extends LoaderPreview<IdeasLoader> {
    private readonly configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new IdeasLoader(file, contentProvider), renderIdeaFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)
                || event.affectsConfiguration(`${ConfigurationKey}.featureFlags`)) {
                this.reload();
            }
        });
    }

    public shouldRefreshOnExternalFileChange(uri: vscode.Uri): boolean {
        return /\.(?:txt|yml|gfx|dds|tga|png)$/i.test(uri.path);
    }

    public dispose(): void {
        this.configurationHandler.dispose();
        super.dispose();
    }
}

export const ideaPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'idea',
    canPreview: canPreviewIdea,
    createPreview: (uri, panel) => new IdeaPreview(uri, panel),
};

