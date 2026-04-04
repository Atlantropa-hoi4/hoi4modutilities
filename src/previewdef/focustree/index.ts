import * as vscode from 'vscode';
import { buildFocusTreeRenderPayload, renderFocusTreeFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { FocusPositionEditMessage } from './positioneditcommon';
import { buildContinuousFocusPositionWorkspaceEdit, buildCreateFocusTemplateWorkspaceEdit, buildDeleteFocusWorkspaceEdit, buildFocusExclusiveLinkWorkspaceEdit, buildFocusLinkWorkspaceEdit, buildFocusPositionWorkspaceEdit } from './positioneditservice';
import { localize } from '../../util/i18n';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'national_focus', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    const text = document.getText();
    return /(focus_tree|shared_focus|joint_focus)\s*=\s*{/.exec(text)?.index;
}

export class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private relativeFilePath: string;
    private pendingLocalEditDocumentVersions = new Set<number>();
    private webviewReady = false;
    private lastRenderStructure: { hasFocusSelector: boolean; hasWarningsButton: boolean } | undefined;
    private latestRefreshRequestId = 0;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        this.focusTreeLoader = new FocusTreeLoader(this.relativeFilePath);
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        const loader = this.createSnapshotLoader(document.getText());
        const result = await renderFocusTreeFile(loader, document.uri, this.panel.webview, document.version);
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        return result;
    }

    public override getDocumentChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        if (this.pendingLocalEditDocumentVersions.delete(document.version)) {
            return;
        }

        const requestId = this.startRefreshRequest();
        const requestDocumentVersion = document.version;
        if (!this.webviewReady) {
            await this.applyFullRefresh(document, requestId, requestDocumentVersion);
            return;
        }

        try {
            const loader = this.createSnapshotLoader(document.getText());
            const payload = await buildFocusTreeRenderPayload(loader, document.version);
            this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
            if (!this.isRefreshRequestCurrent(requestId)) {
                return;
            }

            const nextStructure = {
                hasFocusSelector: payload.hasFocusSelector,
                hasWarningsButton: payload.hasWarningsButton,
            };
            const structureChanged = !this.lastRenderStructure
                || this.lastRenderStructure.hasFocusSelector !== nextStructure.hasFocusSelector
                || this.lastRenderStructure.hasWarningsButton !== nextStructure.hasWarningsButton
                || payload.focusTrees.length === 0;
            if (structureChanged) {
                this.lastRenderStructure = nextStructure;
                this.webviewReady = false;
                await this.applyFullRefresh(document, requestId, requestDocumentVersion);
                return;
            }

            this.lastRenderStructure = nextStructure;
            await this.panel.webview.postMessage({
                command: 'focusTreeContentUpdated',
                ...payload,
            });
        } catch {
            this.webviewReady = false;
            await this.applyFullRefresh(document, requestId, requestDocumentVersion);
        }
    }

    private createSnapshotLoader(content: string): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(() => Promise.resolve(content));
        loader.onLoadDone(r => this.updateDependencies(r.dependencies));
        return loader;
    }

    private startRefreshRequest(): number {
        this.latestRefreshRequestId += 1;
        return this.latestRefreshRequestId;
    }

    private isRefreshRequestCurrent(requestId: number): boolean {
        return requestId === this.latestRefreshRequestId;
    }

    private async applyFullRefresh(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
    ): Promise<void> {
        const content = await this.getContent(document);
        if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
            return;
        }

        this.panel.webview.html = content;
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const command = (msg as any).command as string | undefined;
        if (command === 'focusTreeWebviewReady') {
            this.webviewReady = true;
            return true;
        }

        if (command === 'promptFocusConditionPresetName') {
            const name = await vscode.window.showInputBox({
                prompt: localize('TODO', 'Preset name'),
                value: (msg as any).initialValue ?? '',
                ignoreFocusOut: true,
            });
            await this.panel.webview.postMessage({
                command: 'focusConditionPresetNameResolved',
                name,
            });
            return true;
        }

        if (command !== 'applyFocusPositionEdit'
            && command !== 'applyContinuousFocusPositionEdit'
            && command !== 'createFocusTemplateAtPosition'
            && command !== 'applyFocusLinkEdit'
            && command !== 'applyFocusExclusiveLinkEdit'
            && command !== 'deleteFocus') {
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

        if (msg.command === 'applyContinuousFocusPositionEdit') {
            const { edit, error } = buildContinuousFocusPositionWorkspaceEdit(
                document,
                this.relativeFilePath,
                msg.focusTreeEditKey,
                msg.targetX,
                msg.targetY,
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
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the continuous focus position edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
            }
            await this.panel.webview.postMessage({
                command: 'continuousFocusPositionEditApplied',
                focusTreeEditKey: msg.focusTreeEditKey,
                targetX: msg.targetX,
                targetY: msg.targetY,
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
                msg.parentFocusIds,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                await this.panel.webview.postMessage({
                    command: 'focusLinkEditApplied',
                    parentFocusId: msg.parentFocusId,
                    parentFocusIds: msg.parentFocusIds,
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
                parentFocusIds: msg.parentFocusIds,
                childFocusId: msg.childFocusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'applyFocusExclusiveLinkEdit') {
            const { edit, error } = buildFocusExclusiveLinkWorkspaceEdit(
                document,
                msg.sourceFocusId,
                msg.targetFocusId,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                await this.panel.webview.postMessage({
                    command: 'focusExclusiveLinkEditApplied',
                    sourceFocusId: msg.sourceFocusId,
                    targetFocusId: msg.targetFocusId,
                    documentVersion: document.version,
                });
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the mutually exclusive focus link edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
            }
            await this.panel.webview.postMessage({
                command: 'focusExclusiveLinkEditApplied',
                sourceFocusId: msg.sourceFocusId,
                targetFocusId: msg.targetFocusId,
                documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'deleteFocus') {
            const { edit, error } = buildDeleteFocusWorkspaceEdit(document, msg.focusId);
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus delete edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
                await super.onDocumentChange(updatedDocument);
            }

            return true;
        }

        if (msg.command === 'createFocusTemplateAtPosition') {
            const { edit, error, placeholderRange } = buildCreateFocusTemplateWorkspaceEdit(
                document,
                this.relativeFilePath,
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

        return false;
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
