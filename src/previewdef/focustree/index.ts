import * as vscode from 'vscode';
import { renderFocusTreeFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { FocusPositionEditMessage } from './positioneditcommon';
import { buildCreateFocusTemplateWorkspaceEdit, buildFocusLinkWorkspaceEdit, buildFocusPositionWorkspaceEdit } from './positioneditservice';
import { localize } from '../../util/i18n';

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
    private pendingLocalEditDocumentVersions = new Set<number>();

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

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        if (this.pendingLocalEditDocumentVersions.delete(document.version)) {
            return;
        }

        await super.onDocumentChange(document);
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        if (msg.command !== 'applyFocusPositionEdit'
            && msg.command !== 'createFocusTemplateAtPosition'
            && msg.command !== 'applyFocusLinkEdit') {
            return false;
        }

        const document = getDocumentByUri(this.uri);
        if (!document) {
            await vscode.window.showErrorMessage(localize('TODO', 'The source document is no longer open.'));
            return true;
        }

        if (msg.command === 'applyFocusPositionEdit') {
            const { edit, error } = buildFocusPositionWorkspaceEdit(document, msg.focusId, msg.targetLocalX, msg.targetLocalY);
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus position edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
            }
            await this.panel.webview.postMessage({
                command: 'focusPositionEditApplied',
                focusId: msg.focusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'applyFocusLinkEdit') {
            const { edit, error } = buildFocusLinkWorkspaceEdit(
                document,
                msg.parentFocusId,
                msg.childFocusId,
                msg.targetLocalX,
                msg.targetLocalY,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                await this.panel.webview.postMessage({
                    command: 'focusLinkEditApplied',
                    parentFocusId: msg.parentFocusId,
                    childFocusId: msg.childFocusId,
                    targetLocalX: msg.targetLocalX,
                    targetLocalY: msg.targetLocalY,
                    documentVersion: document.version,
                });
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus link edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
            }
            await this.panel.webview.postMessage({
                command: 'focusLinkEditApplied',
                parentFocusId: msg.parentFocusId,
                childFocusId: msg.childFocusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        const relativeFilePath = getRelativePathInWorkspace(this.uri);
        const { edit, error, placeholderRange } = buildCreateFocusTemplateWorkspaceEdit(
            document,
            relativeFilePath,
            msg.treeEditKey,
            msg.targetAbsoluteX,
            msg.targetAbsoluteY,
        );
        if (error) {
            await vscode.window.showErrorMessage(error);
            return true;
        }

        if (!edit) {
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus template insert.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        if (updatedDocument) {
            this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
            await super.onDocumentChange(updatedDocument);
            if (placeholderRange) {
                await vscode.window.showTextDocument(updatedDocument, {
                    selection: new vscode.Range(
                        updatedDocument.positionAt(placeholderRange.start),
                        updatedDocument.positionAt(placeholderRange.end),
                    ),
                    viewColumn: vscode.ViewColumn.One,
                });
            }
        }

        return true;
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
