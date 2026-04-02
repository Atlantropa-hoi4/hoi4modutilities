import * as vscode from 'vscode';
import { renderFocusTreeFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { FocusLayoutApplyResultMessage, FocusLayoutDraft, FocusLayoutMessage } from './layouteditcommon';
import { buildFocusLayoutWorkspaceEdit } from './layouteditservice';
import { localize } from '../../util/i18n';
import { forceError } from '../../util/common';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'national_focus', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    const text = document.getText();
    return /(focus_tree|shared_focus|joint_focus)\s*=\s*{/.exec(text)?.index;
}

class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private content: string | undefined;
    private layoutDraft: FocusLayoutDraft | undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.focusTreeLoader = new FocusTreeLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const result = await renderFocusTreeFile(this.focusTreeLoader, document.uri, this.panel.webview, document.version);
        this.content = undefined;
        return result;
    }

    protected async onDidReceiveMessage(msg: FocusLayoutMessage): Promise<boolean> {
        switch (msg.command) {
            case 'focusLayoutDraftChange':
                this.layoutDraft = msg.draft;
                return true;
            case 'focusLayoutDiscard':
                this.layoutDraft = undefined;
                return true;
            case 'focusLayoutReload':
                this.layoutDraft = undefined;
                this.reload();
                return true;
            case 'focusLayoutApply':
                await this.applyLayoutDraft(msg.draft);
                return true;
            default:
                return false;
        }
    }

    private async applyLayoutDraft(draft: FocusLayoutDraft): Promise<void> {
        const document = getDocumentByUri(this.uri);
        if (document === undefined) {
            await this.postLayoutResult({
                command: 'focusLayoutApplyResult',
                ok: false,
                message: localize('TODO', 'The source document is no longer open.'),
            });
            return;
        }

        if (document.version !== draft.baseVersion) {
            await this.postLayoutResult({
                command: 'focusLayoutApplyResult',
                ok: false,
                stale: true,
                message: localize('TODO', 'The source document changed while you were editing. Reload or discard the draft first.'),
            });
            return;
        }

        try {
            const filePath = getRelativePathInWorkspace(this.uri);
            const edit = buildFocusLayoutWorkspaceEdit(document, draft, filePath);
            if (!edit) {
                this.layoutDraft = undefined;
                await this.postLayoutResult({
                    command: 'focusLayoutApplyResult',
                    ok: true,
                    message: localize('TODO', 'No layout changes to apply.'),
                });
                return;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await this.postLayoutResult({
                    command: 'focusLayoutApplyResult',
                    ok: false,
                    message: localize('TODO', 'VS Code refused the layout edit.'),
                });
                return;
            }

            this.layoutDraft = undefined;
            await this.postLayoutResult({
                command: 'focusLayoutApplyResult',
                ok: true,
            });
        } catch (e) {
            await this.postLayoutResult({
                command: 'focusLayoutApplyResult',
                ok: false,
                message: forceError(e).message,
            });
        }
    }

    private async postLayoutResult(message: FocusLayoutApplyResultMessage): Promise<void> {
        await this.panel.webview.postMessage(message);
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
