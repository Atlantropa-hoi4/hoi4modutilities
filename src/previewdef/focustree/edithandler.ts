import * as vscode from 'vscode';
import { localize } from "../../util/i18n";
import { getDocumentByUri } from "../../util/vsccommon";
import {
    ApplyContinuousFocusPositionEditMessage,
    ApplyFocusExclusiveLinkEditMessage,
    ApplyFocusLinkEditMessage,
    ApplyFocusPositionEditMessage,
    CreateFocusTemplateAtPositionMessage,
    DeleteFocusMessage,
    FocusPositionEditMessage,
} from "./positioneditcommon";
import {
    buildContinuousFocusPositionWorkspaceEdit,
    buildCreateFocusTemplateWorkspaceEdit,
    buildDeleteFocusWorkspaceEdit,
    buildFocusExclusiveLinkWorkspaceEdit,
    buildFocusLinkWorkspaceEdit,
    buildFocusPositionWorkspaceEdit,
} from "./positioneditservice";
import { FocusTreeLocalEditResult } from "./runtime";
import { FocusTreePreviewSession } from "./previewsession";

export interface FocusTreeEditCommandHandlerOptions {
    uri: vscode.Uri;
    relativeFilePath: string;
    webview: vscode.Webview;
    session: FocusTreePreviewSession;
}

export class FocusTreeEditCommandHandler {
    private readonly uri: vscode.Uri;
    private readonly relativeFilePath: string;
    private readonly webview: vscode.Webview;
    private readonly session: FocusTreePreviewSession;

    constructor(options: FocusTreeEditCommandHandlerOptions) {
        this.uri = options.uri;
        this.relativeFilePath = options.relativeFilePath;
        this.webview = options.webview;
        this.session = options.session;
    }

    public async handleMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const document = getDocumentByUri(this.uri);
        if (!document) {
            await vscode.window.showErrorMessage(localize('TODO', 'The source document is no longer open.'));
            return true;
        }

        switch (msg.command) {
            case 'applyFocusPositionEdit':
                return this.applyFocusPositionEdit(document, msg);
            case 'applyContinuousFocusPositionEdit':
                return this.applyContinuousFocusPositionEdit(document, msg);
            case 'applyFocusLinkEdit':
                return this.applyFocusLinkEdit(document, msg);
            case 'applyFocusExclusiveLinkEdit':
                return this.applyFocusExclusiveLinkEdit(document, msg);
            case 'deleteFocus':
                return this.deleteFocus(document, msg);
            case 'createFocusTemplateAtPosition':
                return this.createFocusTemplate(document, msg);
            default:
                return false;
        }
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

        const result = this.reconcileLocalEdit(getDocumentByUri(this.uri));
        await this.webview.postMessage({
            command: 'focusPositionEditApplied',
            focusId: msg.focusId,
            targetLocalX: msg.targetLocalX,
            targetLocalY: msg.targetLocalY,
            documentVersion: result.updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
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

        const result = this.reconcileLocalEdit(getDocumentByUri(this.uri));
        await this.webview.postMessage({
            command: 'continuousFocusPositionEditApplied',
            focusTreeEditKey: msg.focusTreeEditKey,
            targetX: msg.targetX,
            targetY: msg.targetY,
            documentVersion: result.updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
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
            await this.webview.postMessage({
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

        await this.reloadStructuralEdit(getDocumentByUri(this.uri));
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
            await this.webview.postMessage({
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

        await this.reloadStructuralEdit(getDocumentByUri(this.uri));
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

        await this.reloadStructuralEdit(getDocumentByUri(this.uri));
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
            await this.reloadStructuralEdit(updatedDocument);
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

    private reconcileLocalEdit(updatedDocument: vscode.TextDocument | undefined): FocusTreeLocalEditResult {
        return {
            kind: updatedDocument ? 'optimistic' : 'noop',
            updatedDocumentVersion: this.session.reconcileAfterLocalEdit(updatedDocument),
        };
    }

    private async reloadStructuralEdit(updatedDocument: vscode.TextDocument | undefined): Promise<FocusTreeLocalEditResult> {
        return {
            kind: updatedDocument ? 'structural' : 'noop',
            updatedDocumentVersion: await this.session.reloadAfterStructuralEdit(updatedDocument),
        };
    }
}
