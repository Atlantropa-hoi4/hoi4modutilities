import * as vscode from 'vscode';
import { contextContainer } from '../../context';
import { localize } from '../../util/i18n';
import { matchPathEnd } from '../../util/nodecommon';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { PreviewDescriptor } from '../descriptor';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { PreviewBase } from '../previewbase';
import { normalizeConditionPresetsByTree, FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeLoader } from './loader';
import {
    ApplyContinuousFocusPositionEditMessage,
    ApplyFocusExclusiveLinkEditMessage,
    ApplyFocusLinkEditMessage,
    ApplyFocusPositionEditMessage,
    CreateFocusTemplateAtPositionMessage,
    DeleteFocusMessage,
    FocusPositionEditMessage,
} from './positioneditcommon';
import {
    buildContinuousFocusPositionWorkspaceEdit,
    buildCreateFocusTemplateWorkspaceEdit,
    buildDeleteFocusWorkspaceEdit,
    buildFocusExclusiveLinkWorkspaceEdit,
    buildFocusLinkWorkspaceEdit,
    buildFocusPositionWorkspaceEdit,
} from './positioneditservice';
import { FocusTreePreviewSession } from './previewsession';

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
    private readonly relativeFilePath: string;
    private readonly focusTreeLoader: FocusTreeLoader;
    private readonly session: FocusTreePreviewSession;
    private persistedConditionPresetsByTree: FocusConditionPresetsByTree;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        this.focusTreeLoader = new FocusTreeLoader(this.relativeFilePath);
        this.persistedConditionPresetsByTree = this.getStoredConditionPresetsByTree();
        this.session = new FocusTreePreviewSession({
            uri: this.uri,
            webview: this.panel.webview,
            focusTreeLoader: this.focusTreeLoader,
            getConditionPresetsByTree: () => this.persistedConditionPresetsByTree,
            updateDependencies: dependencies => this.updateDependencies(dependencies),
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        return this.session.renderShell(document.version);
    }

    public override async initializePanelContent(document: vscode.TextDocument): Promise<void> {
        this.session.initializePanel(document);
    }

    public override getDocumentChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        await this.session.refreshDocument(document);
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const command = (msg as { command?: string }).command;
        if (command === 'focusTreeWebviewReady') {
            this.session.handleWebviewReady();
            return true;
        }

        if (command === 'promptFocusConditionPresetName') {
            await this.resolveConditionPresetName((msg as { initialValue?: string }).initialValue);
            return true;
        }

        if (command === 'persistFocusConditionPresets') {
            await this.persistConditionPresets((msg as { presetsByTree: FocusConditionPresetsByTree }).presetsByTree);
            return true;
        }

        const document = getDocumentByUri(this.uri);
        if (!document) {
            await vscode.window.showErrorMessage(localize('TODO', 'The source document is no longer open.'));
            return true;
        }

        switch (command) {
            case 'applyFocusPositionEdit':
                return this.applyFocusPositionEdit(document, msg as ApplyFocusPositionEditMessage);
            case 'applyContinuousFocusPositionEdit':
                return this.applyContinuousFocusPositionEdit(document, msg as ApplyContinuousFocusPositionEditMessage);
            case 'applyFocusLinkEdit':
                return this.applyFocusLinkEdit(document, msg as ApplyFocusLinkEditMessage);
            case 'applyFocusExclusiveLinkEdit':
                return this.applyFocusExclusiveLinkEdit(document, msg as ApplyFocusExclusiveLinkEditMessage);
            case 'deleteFocus':
                return this.deleteFocus(document, msg as DeleteFocusMessage);
            case 'createFocusTemplateAtPosition':
                return this.createFocusTemplate(document, msg as CreateFocusTemplateAtPositionMessage);
            default:
                return false;
        }
    }

    private async resolveConditionPresetName(initialValue?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: localize('TODO', 'Preset name'),
            value: initialValue ?? '',
            ignoreFocusOut: true,
        });

        await this.panel.webview.postMessage({
            command: 'focusConditionPresetNameResolved',
            name,
        });
    }

    private async persistConditionPresets(presetsByTree: FocusConditionPresetsByTree): Promise<void> {
        this.persistedConditionPresetsByTree = normalizeConditionPresetsByTree(presetsByTree);
        await this.storeConditionPresetsByTree(this.persistedConditionPresetsByTree);
    }

    private async applyFocusPositionEdit(
        document: vscode.TextDocument,
        msg: ApplyFocusPositionEditMessage,
    ): Promise<boolean> {
        const { edit, error } = buildFocusPositionWorkspaceEdit(
            document,
            msg.focusId,
            msg.targetLocalX,
            msg.targetLocalY,
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
            await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus position edit.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        const updatedDocumentVersion = this.session.reconcileAfterLocalEdit(updatedDocument);
        await this.panel.webview.postMessage({
            command: 'focusPositionEditApplied',
            focusId: msg.focusId,
            targetLocalX: msg.targetLocalX,
            targetLocalY: msg.targetLocalY,
            documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
        });
        return true;
    }

    private async applyContinuousFocusPositionEdit(
        document: vscode.TextDocument,
        msg: ApplyContinuousFocusPositionEditMessage,
    ): Promise<boolean> {
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
        const updatedDocumentVersion = this.session.reconcileAfterLocalEdit(updatedDocument);
        await this.panel.webview.postMessage({
            command: 'continuousFocusPositionEditApplied',
            focusTreeEditKey: msg.focusTreeEditKey,
            targetX: msg.targetX,
            targetY: msg.targetY,
            documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
        });
        return true;
    }

    private async applyFocusLinkEdit(
        document: vscode.TextDocument,
        msg: ApplyFocusLinkEditMessage,
    ): Promise<boolean> {
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

        await this.session.reloadAfterStructuralEdit(getDocumentByUri(this.uri));
        return true;
    }

    private async applyFocusExclusiveLinkEdit(
        document: vscode.TextDocument,
        msg: ApplyFocusExclusiveLinkEditMessage,
    ): Promise<boolean> {
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

        await this.session.reloadAfterStructuralEdit(getDocumentByUri(this.uri));
        return true;
    }

    private async deleteFocus(
        document: vscode.TextDocument,
        msg: DeleteFocusMessage,
    ): Promise<boolean> {
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

        await this.session.reloadAfterStructuralEdit(getDocumentByUri(this.uri));
        return true;
    }

    private async createFocusTemplate(
        document: vscode.TextDocument,
        msg: CreateFocusTemplateAtPositionMessage,
    ): Promise<boolean> {
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
            await this.session.reloadAfterStructuralEdit(updatedDocument);
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

export const focusTreePreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    createPreview: (uri, panel) => new FocusTreePreview(uri, panel),
    panelOptions: {
        retainContextWhenHidden: true,
    },
};
