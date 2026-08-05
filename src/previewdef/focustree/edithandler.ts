import * as vscode from 'vscode';
import { forceError } from "../../util/common";
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
import type { FocusTreeLocalEditResult } from "./runtime";
import type { FocusTreePreviewSession } from "./previewsession";

type FocusTreeEditRequest = Exclude<FocusPositionEditMessage,
    { command: 'promptFocusConditionPresetName' | 'persistFocusConditionPresets' }>;

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
    private queue: Promise<void> = Promise.resolve();

    constructor(options: FocusTreeEditCommandHandlerOptions) {
        this.uri = options.uri;
        this.relativeFilePath = options.relativeFilePath;
        this.webview = options.webview;
        this.session = options.session;
    }

    public async handleMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        if (!isFocusTreeEditCommand(msg.command)) {
            return false;
        }
        const editMessage = msg as FocusTreeEditRequest;
        this.queue = this.queue
            .catch(() => undefined)
            .then(async () => {
                try {
                    await this.processMessage(editMessage);
                } catch (error) {
                    await this.reportError(editMessage, forceError(error).message);
                }
            });
        await this.queue;
        return true;
    }

    private async processMessage(msg: FocusTreeEditRequest): Promise<void> {
        const document = getDocumentByUri(this.uri);
        if (!document) {
            await this.reportError(msg, localize('TODO', 'The source document is no longer open.'));
            return;
        }

        if ('documentVersion' in msg && document.version !== msg.documentVersion) {
            await this.reject(msg, localize('TODO', 'The focus document changed before the edit could be applied.'));
            await this.session.refreshDocument(document, { source: 'document' });
            return;
        }

        switch (msg.command) {
            case 'applyFocusPositionEdit':
                await this.applyFocusPositionEdit(document, msg);
                return;
            case 'applyContinuousFocusPositionEdit':
                await this.applyContinuousFocusPositionEdit(document, msg);
                return;
            case 'applyFocusLinkEdit':
                await this.applyFocusLinkEdit(document, msg);
                return;
            case 'applyFocusExclusiveLinkEdit':
                await this.applyFocusExclusiveLinkEdit(document, msg);
                return;
            case 'deleteFocus':
                await this.deleteFocus(document, msg);
                return;
            case 'createFocusTemplateAtPosition':
                await this.createFocusTemplate(document, msg);
                return;
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
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.webview.postMessage({
                command: 'focusPositionEditApplied',
                requestId: msg.requestId,
                focusId: msg.focusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: document.version,
            });
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await this.reportError(msg, localize('TODO', 'VS Code refused the focus position edit.'));
            return true;
        }

        const result = this.reconcileLocalEdit(getDocumentByUri(this.uri));
        await this.webview.postMessage({
            command: 'focusPositionEditApplied',
            requestId: msg.requestId,
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
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.webview.postMessage({
                command: 'continuousFocusPositionEditApplied',
                requestId: msg.requestId,
                focusTreeEditKey: msg.focusTreeEditKey,
                targetX: msg.targetX,
                targetY: msg.targetY,
                documentVersion: document.version,
            });
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await this.reportError(msg, localize('TODO', 'VS Code refused the continuous focus position edit.'));
            return true;
        }

        const result = this.reconcileLocalEdit(getDocumentByUri(this.uri));
        await this.webview.postMessage({
            command: 'continuousFocusPositionEditApplied',
            requestId: msg.requestId,
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
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.webview.postMessage({
                command: 'focusLinkEditApplied',
                requestId: msg.requestId,
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
            await this.reportError(msg, localize('TODO', 'VS Code refused the focus link edit.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        await this.webview.postMessage({
            command: 'focusLinkEditApplied',
            requestId: msg.requestId,
            parentFocusId: msg.parentFocusId,
            parentFocusIds: msg.parentFocusIds,
            childFocusId: msg.childFocusId,
            targetLocalX: msg.targetLocalX,
            targetLocalY: msg.targetLocalY,
            documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
        });
        void this.reloadStructuralEdit(updatedDocument);
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
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.webview.postMessage({
                command: 'focusExclusiveLinkEditApplied',
                requestId: msg.requestId,
                sourceFocusId: msg.sourceFocusId,
                targetFocusId: msg.targetFocusId,
                documentVersion: document.version,
            });
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await this.reportError(msg, localize('TODO', 'VS Code refused the mutually exclusive focus link edit.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        await this.webview.postMessage({
            command: 'focusExclusiveLinkEditApplied',
            requestId: msg.requestId,
            sourceFocusId: msg.sourceFocusId,
            targetFocusId: msg.targetFocusId,
            documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
        });
        void this.reloadStructuralEdit(updatedDocument);
        return true;
    }

    private async deleteFocus(
        document: vscode.TextDocument,
        msg: DeleteFocusMessage,
    ): Promise<boolean> {
        const focusIds = msg.focusIds && msg.focusIds.length > 0 ? msg.focusIds : [msg.focusId];
        const { edit, error } = buildDeleteFocusWorkspaceEdit(document, focusIds);
        if (error) {
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.webview.postMessage({
                command: 'deleteFocusApplied',
                requestId: msg.requestId,
                focusIds,
                documentVersion: document.version,
            });
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await this.reportError(msg, localize('TODO', 'VS Code refused the focus delete edit.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        await this.webview.postMessage({
            command: 'deleteFocusApplied',
            requestId: msg.requestId,
            focusIds,
            documentVersion: updatedDocument?.version ?? Math.max(document.version, msg.documentVersion) + 1,
        });
        void this.reloadStructuralEdit(updatedDocument);
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
            await this.reportError(msg, error);
            return true;
        }

        if (!edit) {
            await this.reject(msg, localize('TODO', 'The focus template did not produce an editable source change.'));
            return true;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            await this.reportError(msg, localize('TODO', 'VS Code refused the focus template insert.'));
            return true;
        }

        const updatedDocument = getDocumentByUri(this.uri);
        const createdFocusId = updatedDocument && placeholderRange
            ? updatedDocument.getText().slice(placeholderRange.start, placeholderRange.end)
            : undefined;
        if (!updatedDocument) {
            await this.reject(msg, localize('TODO', 'The focus document closed after the template was inserted.'));
            return true;
        }
        await this.webview.postMessage({
            command: 'createFocusTemplateApplied',
            requestId: msg.requestId,
            treeEditKey: msg.treeEditKey,
            focusId: createdFocusId,
            targetAbsoluteX: msg.targetAbsoluteX,
            targetAbsoluteY: msg.targetAbsoluteY,
            documentVersion: updatedDocument.version,
        });
        void this.reloadStructuralEdit(updatedDocument);
        if (placeholderRange) {
            await vscode.window.showTextDocument(updatedDocument, {
                selection: new vscode.Range(
                    updatedDocument.positionAt(placeholderRange.start),
                    updatedDocument.positionAt(placeholderRange.end),
                ),
                viewColumn: vscode.ViewColumn.One,
            });
        }
        return true;
    }

    private async reportError(msg: FocusTreeEditRequest, reason: string): Promise<void> {
        void vscode.window.showErrorMessage(reason);
        await this.reject(msg, reason);
    }

    private async reject(msg: FocusTreeEditRequest, reason: string): Promise<void> {
        await this.webview.postMessage({
            command: 'focusEditRejected',
            requestId: msg.requestId,
            documentVersion: getDocumentByUri(this.uri)?.version,
            reason,
        });
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

function isFocusTreeEditCommand(command: string): command is FocusTreeEditRequest['command'] {
    return command === 'applyFocusPositionEdit'
        || command === 'applyContinuousFocusPositionEdit'
        || command === 'applyFocusLinkEdit'
        || command === 'applyFocusExclusiveLinkEdit'
        || command === 'deleteFocus'
        || command === 'createFocusTemplateAtPosition';
}
