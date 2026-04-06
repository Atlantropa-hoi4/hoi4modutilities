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
import { contextContainer } from '../../context';
import { FocusConditionPresetsByTree, normalizeConditionPresetsByTree } from './conditionpresets';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { error } from '../../util/debug';
import { createFocusTreeRenderPatch, FocusTreeRenderStateSnapshot } from './renderpayloadpatch';

const focusConditionPresetsStateKeyPrefix = 'focusTree.conditionPresets.v1:';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['common', 'national_focus', '*'])) {
        return 0;
    }

    return findDocumentRegexPreviewPriority(document, /(focus_tree|shared_focus|joint_focus)\s*=\s*{/);
}

export class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private relativeFilePath: string;
    private persistedConditionPresetsByTree: FocusConditionPresetsByTree;
    private pendingLocalEditDocumentVersions = new Set<number>();
    private webviewReady = false;
    private lastRenderStructure: { hasFocusSelector: boolean; hasWarningsButton: boolean } | undefined;
    private latestRefreshRequestId = 0;
    private lastRenderPayload: FocusTreeRenderStateSnapshot | undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        this.focusTreeLoader = new FocusTreeLoader(this.relativeFilePath);
        this.persistedConditionPresetsByTree = this.getStoredConditionPresetsByTree();
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        const loader = this.createSnapshotLoader(document.getText());
        const result = await renderFocusTreeFile(
            loader,
            document.uri,
            this.panel.webview,
            document.version,
            this.persistedConditionPresetsByTree,
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        return result;
    }

    public override getDocumentChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        await this.refreshDocument(document);
    }

    private async refreshDocument(
        document: vscode.TextDocument,
        options?: { ignorePendingLocalEditDocumentVersion?: boolean },
    ): Promise<void> {
        if (!options?.ignorePendingLocalEditDocumentVersion && this.pendingLocalEditDocumentVersions.delete(document.version)) {
            return;
        }

        const requestId = this.startRefreshRequest();
        const requestDocumentVersion = document.version;
        try {
            if (!this.webviewReady) {
                await this.applyFullRefresh(document, requestId, requestDocumentVersion);
                return;
            }

            const loader = this.createSnapshotLoader(document.getText());
            const payload = await buildFocusTreeRenderPayload(loader, document.version, this.persistedConditionPresetsByTree);
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
                this.lastRenderPayload = payload;
                this.webviewReady = false;
                await this.applyFullRefresh(document, requestId, requestDocumentVersion);
                return;
            }

            this.lastRenderStructure = nextStructure;
            const patch = createFocusTreeRenderPatch(this.lastRenderPayload, payload);
            this.lastRenderPayload = payload;
            await this.panel.webview.postMessage({
                command: 'focusTreeContentUpdated',
                ...patch,
            });
        } catch (e) {
            error(e);
            this.webviewReady = false;
            const content = await this.getContent(document);
            if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
                return;
            }

            this.panel.webview.html = content;
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

        if (command === 'persistFocusConditionPresets') {
            this.persistedConditionPresetsByTree = normalizeConditionPresetsByTree((msg as any).presetsByTree);
            await this.storeConditionPresetsByTree(this.persistedConditionPresetsByTree);
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
            const focusIds = msg.focusIds && msg.focusIds.length > 0 ? msg.focusIds : [msg.focusId];
            const { edit, error } = buildDeleteFocusWorkspaceEdit(document, focusIds);
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
                await this.panel.webview.postMessage({
                    command: 'deleteFocusApplied',
                    focusIds,
                    documentVersion: updatedDocument.version,
                });
                void this.refreshDocument(updatedDocument, { ignorePendingLocalEditDocumentVersion: true });
            }

            return true;
        }

        if (msg.command === 'createFocusTemplateAtPosition') {
            const { edit, error, placeholderFocusId, placeholderRange } = buildCreateFocusTemplateWorkspaceEdit(
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
                await this.panel.webview.postMessage({
                    command: 'createFocusTemplateApplied',
                    treeEditKey: msg.treeEditKey,
                    focusId: placeholderFocusId,
                    targetAbsoluteX: msg.targetAbsoluteX,
                    targetAbsoluteY: msg.targetAbsoluteY,
                    documentVersion: updatedDocument.version,
                });
                void this.refreshDocument(updatedDocument, { ignorePendingLocalEditDocumentVersion: true });
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

    private getConditionPresetsStateKey(): string {
        return `${focusConditionPresetsStateKeyPrefix}${this.relativeFilePath}`;
    }

    private getStoredConditionPresetsByTree(): FocusConditionPresetsByTree {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return {};
        }

        return normalizeConditionPresetsByTree(
            workspaceState.get(this.getConditionPresetsStateKey()) as FocusConditionPresetsByTree | undefined,
        );
    }

    private async storeConditionPresetsByTree(conditionPresetsByTree: FocusConditionPresetsByTree): Promise<void> {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return;
        }

        const hasEntries = Object.keys(conditionPresetsByTree).length > 0;
        await workspaceState.update(this.getConditionPresetsStateKey(), hasEntries ? conditionPresetsByTree : undefined);
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
