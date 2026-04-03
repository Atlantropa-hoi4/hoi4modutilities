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

type FocusConditionPresetPromptMessage = {
    command: 'promptFocusConditionPresetName';
    initialValue?: string;
};

type FocusConditionPresetWarningMessage = {
    command: 'showFocusConditionPresetWarning';
    message: string;
};

export type FocusConditionPresetTestAction =
    | 'snapshot'
    | 'selectConditions'
    | 'savePreset'
    | 'applyPreset'
    | 'deletePreset';

type FocusConditionPresetTestRequestMessage = {
    command: 'focusConditionPresetTest';
    requestId: string;
    action: FocusConditionPresetTestAction;
    name?: string;
    presetId?: string;
    exprKeys?: string[];
};

export type FocusConditionPresetTestSnapshot = {
    treeId: string;
    availableExprKeys: string[];
    selectedExprKeys: string[];
    selectedPresetId?: string;
    presets: Array<{
        id: string;
        name: string;
        exprKeys: string[];
    }>;
};

type FocusConditionPresetTestResponseMessage = {
    command: 'focusConditionPresetTestResponse';
    requestId: string;
    snapshot?: FocusConditionPresetTestSnapshot;
    error?: string;
};

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
    private pendingConditionPresetTestRequests = new Map<string, {
        resolve: (snapshot: FocusConditionPresetTestSnapshot) => void;
        reject: (error: Error) => void;
        timeoutHandle: NodeJS.Timeout;
    }>();

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

    public async runConditionPresetTestAction(
        action: FocusConditionPresetTestAction,
        options?: {
            name?: string;
            presetId?: string;
            exprKeys?: string[];
        },
    ): Promise<FocusConditionPresetTestSnapshot> {
        await this.waitForWebviewReady();

        const requestId = `condition-preset-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const message: FocusConditionPresetTestRequestMessage = {
            command: 'focusConditionPresetTest',
            requestId,
            action,
            name: options?.name,
            presetId: options?.presetId,
            exprKeys: options?.exprKeys,
        };

        return await new Promise<FocusConditionPresetTestSnapshot>(async (resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.pendingConditionPresetTestRequests.delete(requestId);
                reject(new Error(`Timed out waiting for condition preset test action "${action}".`));
            }, 15000);

            this.pendingConditionPresetTestRequests.set(requestId, {
                resolve: snapshot => {
                    clearTimeout(timeoutHandle);
                    resolve(snapshot);
                },
                reject: error => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                },
                timeoutHandle,
            });

            const posted = await this.panel.webview.postMessage(message);
            if (!posted) {
                const pending = this.pendingConditionPresetTestRequests.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeoutHandle);
                    this.pendingConditionPresetTestRequests.delete(requestId);
                }
                reject(new Error(`Failed to post condition preset test action "${action}" to the focus preview.`));
            }
        });
    }

    public override dispose(): void {
        for (const pending of this.pendingConditionPresetTestRequests.values()) {
            clearTimeout(pending.timeoutHandle);
            pending.reject(new Error('Focus preview disposed before the condition preset test action completed.'));
        }
        this.pendingConditionPresetTestRequests.clear();
        super.dispose();
    }

    private async waitForWebviewReady(timeoutMs: number = 15000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!this.webviewReady) {
            if (Date.now() >= deadline) {
                throw new Error('Timed out waiting for the focus preview webview to become ready.');
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const command = (msg as any).command as string | undefined;
        if (command === 'focusTreeWebviewReady') {
            this.webviewReady = true;
            return true;
        }

        if (command === 'focusConditionPresetTestResponse') {
            const response = msg as unknown as FocusConditionPresetTestResponseMessage;
            const pending = this.pendingConditionPresetTestRequests.get(response.requestId);
            if (!pending) {
                return true;
            }

            this.pendingConditionPresetTestRequests.delete(response.requestId);
            if (response.error) {
                pending.reject(new Error(response.error));
                return true;
            }

            if (!response.snapshot) {
                pending.reject(new Error('Condition preset test response did not include a snapshot.'));
                return true;
            }

            pending.resolve(response.snapshot);
            return true;
        }

        if (command === 'promptFocusConditionPresetName') {
            const promptMessage = msg as unknown as FocusConditionPresetPromptMessage;
            const name = await vscode.window.showInputBox({
                title: localize('TODO', 'Save focus condition preset'),
                prompt: localize('TODO', 'Enter a name for the current focus condition preset.'),
                value: promptMessage.initialValue ?? '',
                ignoreFocusOut: true,
            });
            await this.panel.webview.postMessage({
                command: 'focusConditionPresetNameResolved',
                name,
            });
            return true;
        }

        if (command === 'showFocusConditionPresetWarning') {
            const warningMessage = msg as unknown as FocusConditionPresetWarningMessage;
            await vscode.window.showWarningMessage(warningMessage.message);
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
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
