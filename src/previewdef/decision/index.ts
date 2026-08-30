import * as vscode from 'vscode';
import { ConfigurationKey } from '../../constants';
import { isDecisionPreviewEnabled } from '../../util/featureflags';
import { matchPathEnd } from '../../util/nodecommon';
import type { PreviewDescriptor } from '../descriptor';
import { LoaderPreview } from '../loaderpreview';
import { renderDecisionFile } from './contentbuilder';
import { DecisionsLoader } from './loader';

function canPreviewDecision(document: vscode.TextDocument): number | undefined {
    if (!isDecisionPreviewEnabled() || !document.uri.path.toLowerCase().endsWith('.txt')) {
        return undefined;
    }
    return matchPathEnd(document.uri.toString().toLowerCase(), ['common', 'decisions', '*']) ? 0 : undefined;
}

class DecisionPreview extends LoaderPreview<DecisionsLoader> {
    private readonly configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new DecisionsLoader(file, contentProvider), renderDecisionFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)
                || event.affectsConfiguration(`${ConfigurationKey}.featureFlags`)) {
                this.reload();
            }
        });
    }

    public shouldRefreshOnExternalFileChange(uri: vscode.Uri): boolean {
        return /\.(?:txt|yml|gui|gfx|dds|tga|png)$/i.test(uri.path);
    }

    public dispose(): void {
        this.configurationHandler.dispose();
        super.dispose();
    }
}

export const decisionPreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'decision',
    canPreview: canPreviewDecision,
    createPreview: (uri, panel) => new DecisionPreview(uri, panel),
};
