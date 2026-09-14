import * as vscode from 'vscode';
import { forceError } from '../../util/common';
import { localize } from '../../util/i18n';
import { getDocumentByUri } from '../../util/vsccommon';
import type { MioEditMessage } from './editcommon';
import { buildMioWorkspaceEdit } from './editworkspace';
import type { Mio } from './schema';

interface MioEditCommandHandlerOptions {
    uri: vscode.Uri;
    webview: vscode.Webview;
    getMios: () => readonly Mio[];
    recordLocallyAppliedVersion: (version: number) => () => void;
    refreshAfterEdit: (message: MioEditMessage, document: vscode.TextDocument) => Promise<void>;
}

export class MioEditCommandHandler {
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly options: MioEditCommandHandlerOptions) {}

    public async handleMessage(message: MioEditMessage): Promise<boolean> {
        if (!isMioEditCommand(message.command)) {
            return false;
        }
        this.queue = this.queue
            .catch(() => undefined)
            .then(async () => {
                try {
                    await this.processMessage(message);
                } catch (error) {
                    await this.reportError(message, forceError(error).message);
                }
            });
        await this.queue;
        return true;
    }

    private async processMessage(message: MioEditMessage): Promise<void> {
        const document = getDocumentByUri(this.options.uri);
        if (!document) {
            await this.reject(message, localize('miopreview.edit.documentclosed', 'The MIO source document is no longer open.'));
            return;
        }
        if (document.version !== message.documentVersion) {
            await this.reject(message, localize('miopreview.edit.stale', 'The MIO document changed before the edit could be applied.'));
            await this.options.refreshAfterEdit(message, document);
            return;
        }
        const mio = this.options.getMios().find(item => item.id === message.mioId);
        if (!mio) {
            await this.reject(message, localize('miopreview.edit.missingmio', 'The selected MIO is no longer available.'));
            await this.options.refreshAfterEdit(message, document);
            return;
        }

        const result = buildMioWorkspaceEdit(document, message, mio);
        if (result.error) {
            await this.reportError(message, result.error);
            return;
        }
        if (!result.edit) {
            await this.applied(message, document.version, result);
            return;
        }

        const expectedVersion = document.version + 1;
        const discardRecordedVersion = this.options.recordLocallyAppliedVersion(expectedVersion);
        let applied: boolean;
        try {
            applied = await vscode.workspace.applyEdit(result.edit);
        } catch (error) {
            discardRecordedVersion();
            throw error;
        }
        if (!applied) {
            discardRecordedVersion();
            await this.reportError(message, localize('miopreview.edit.refused', 'VS Code refused the MIO edit.'));
            return;
        }
        const updatedDocument = getDocumentByUri(this.options.uri);
        if (!updatedDocument) {
            await this.reject(message, localize('miopreview.edit.closedafterapply', 'The MIO document closed after the edit was applied.'));
            return;
        }

        await this.applied(message, updatedDocument.version, result);
        await this.options.refreshAfterEdit(message, updatedDocument);
        if (message.command === 'createMioTraitAtPosition' && result.placeholderRange) {
            await vscode.window.showTextDocument(updatedDocument, {
                selection: new vscode.Range(
                    updatedDocument.positionAt(result.placeholderRange.start),
                    updatedDocument.positionAt(result.placeholderRange.end),
                ),
                viewColumn: vscode.ViewColumn.One,
            });
        }
    }

    private async applied(
        message: MioEditMessage,
        documentVersion: number,
        result: { createdTraitId?: string },
    ): Promise<void> {
        await this.options.webview.postMessage({
            command: 'mioEditApplied',
            requestId: message.requestId,
            editCommand: message.command,
            documentVersion,
            createdTraitId: result.createdTraitId,
        });
    }

    private async reportError(message: MioEditMessage, reason: string): Promise<void> {
        void vscode.window.showErrorMessage(reason);
        await this.reject(message, reason);
    }

    private async reject(message: MioEditMessage, reason: string): Promise<void> {
        await this.options.webview.postMessage({
            command: 'mioEditRejected',
            requestId: message.requestId,
            documentVersion: getDocumentByUri(this.options.uri)?.version,
            reason,
        });
    }
}

function isMioEditCommand(command: string): command is MioEditMessage['command'] {
    return command === 'applyMioPositionEdits'
        || command === 'toggleMioParentLink'
        || command === 'toggleMioExclusiveLink'
        || command === 'createMioTraitAtPosition'
        || command === 'deleteMioTraits';
}
