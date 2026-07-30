import * as vscode from 'vscode';
import { localize } from '../../util/i18n';
import { forceError } from '../../util/common';
import { getDocumentByUri } from '../../util/vsccommon';
import {
    TechnologyEditMessage,
    TechnologyEditRenderContext,
} from './editcommon';
import {
    buildCreateChildTechnologyTextChanges,
    buildDeleteTechnologiesTextChanges,
    buildTechnologyPathTextChanges,
    buildTechnologyPositionTextChanges,
    buildTechnologyXorTextChanges,
    isValidTechnologyId,
} from './editservice';
import { buildTechnologyWorkspaceEdit } from './editworkspace';

interface TechnologyEditCommandHandlerOptions {
    uri: vscode.Uri;
    relativeFilePath: string;
    webview: vscode.Webview;
    getEditContext: () => TechnologyEditRenderContext;
    refreshDocument: (document: vscode.TextDocument) => Promise<void>;
    recordLocallyAppliedVersion?: (command: TechnologyEditMessage['command'], documentVersion: number) => void;
}

export class TechnologyEditCommandHandler {
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly options: TechnologyEditCommandHandlerOptions) {}

    public async handleMessage(message: TechnologyEditMessage): Promise<boolean> {
        if (!isTechnologyEditCommand(message.command)) {
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

    private async processMessage(message: TechnologyEditMessage): Promise<void> {
        const document = getDocumentByUri(this.options.uri);
        if (!document) {
            await this.reject(message, localize('TODO', 'The technology document is no longer open.'));
            return;
        }
        if (document.version !== message.documentVersion) {
            await this.reject(message, localize('TODO', 'The technology document changed before the edit could be applied.'));
            await this.options.refreshDocument(document);
            return;
        }

        if (message.command === 'createChildTechnologyAtPosition') {
            await this.createChild(document, message);
            return;
        }
        if (message.command === 'deleteTechnologies') {
            await this.deleteTechnologies(document, message);
            return;
        }

        const editContext = this.options.getEditContext();
        const result = message.command === 'applyTechnologyPositionEdits'
            ? buildTechnologyPositionTextChanges(
                document.getText(),
                this.options.relativeFilePath,
                message.folder,
                message.edits,
                editContext,
            )
            : message.command === 'toggleTechnologyPath'
                ? buildTechnologyPathTextChanges(
                    document.getText(),
                    this.options.relativeFilePath,
                    message.sourceTechnologyId,
                    message.targetTechnologyId,
                    message.folder,
                    editContext,
                )
                : buildTechnologyXorTextChanges(
                    document.getText(),
                    this.options.relativeFilePath,
                    message.sourceTechnologyId,
                    message.targetTechnologyId,
                    message.folder,
                );
        await this.applyResult(document, message, result);
    }

    private async createChild(
        document: vscode.TextDocument,
        message: Extract<TechnologyEditMessage, { command: 'createChildTechnologyAtPosition' }>,
    ): Promise<void> {
        const technologyId = await vscode.window.showInputBox({
            prompt: localize('TODO', 'Technology ID'),
            ignoreFocusOut: true,
            validateInput: value => isValidTechnologyId(value)
                ? undefined
                : localize('TODO', 'Enter a valid Clausewitz technology ID without whitespace or syntax characters.'),
        });
        if (technologyId === undefined) {
            await this.reject(message, localize('TODO', 'Technology creation was cancelled.'), true);
            return;
        }
        const latestDocument = getDocumentByUri(this.options.uri);
        if (!latestDocument || latestDocument.version !== document.version) {
            await this.reject(message, localize('TODO', 'The technology document changed while entering the new ID.'));
            if (latestDocument) {
                await this.options.refreshDocument(latestDocument);
            }
            return;
        }
        const result = buildCreateChildTechnologyTextChanges(
            latestDocument.getText(),
            this.options.relativeFilePath,
            message.parentTechnologyId,
            technologyId,
            message.folder,
            message.x,
            message.y,
            this.options.getEditContext(),
        );
        await this.applyResult(latestDocument, message, result, { technologyId });
    }

    private async deleteTechnologies(
        document: vscode.TextDocument,
        message: Extract<TechnologyEditMessage, { command: 'deleteTechnologies' }>,
    ): Promise<void> {
        const result = buildDeleteTechnologiesTextChanges(
            document.getText(),
            this.options.relativeFilePath,
            message.technologyIds,
            this.options.getEditContext(),
        );
        if (result.error) {
            await this.reportError(message, result.error);
            return;
        }
        const confirmation = await vscode.window.showWarningMessage(
            localize(
                'TODO',
                'Delete {0} technology block(s) and {1} reference(s) in this file? References in other files are not changed.',
                message.technologyIds.length,
                result.referenceCount ?? 0,
            ),
            { modal: true },
            localize('TODO', 'Delete'),
        );
        if (!confirmation) {
            await this.reject(message, localize('TODO', 'Technology deletion was cancelled.'), true);
            return;
        }
        const latestDocument = getDocumentByUri(this.options.uri);
        if (!latestDocument || latestDocument.version !== document.version) {
            await this.reject(message, localize('TODO', 'The technology document changed while confirming deletion.'));
            if (latestDocument) {
                await this.options.refreshDocument(latestDocument);
            }
            return;
        }
        await this.applyResult(latestDocument, message, result);
    }

    private async applyResult(
        document: vscode.TextDocument,
        message: TechnologyEditMessage,
        result: ReturnType<typeof buildTechnologyPositionTextChanges>,
        payload: Record<string, unknown> = {},
    ): Promise<void> {
        const workspaceResult = buildTechnologyWorkspaceEdit(document, result);
        if (workspaceResult.error) {
            await this.reportError(message, workspaceResult.error);
            return;
        }
        if (!workspaceResult.edit) {
            await this.applied(message, document.version, payload);
            return;
        }
        if (!await vscode.workspace.applyEdit(workspaceResult.edit)) {
            await this.reportError(message, localize('TODO', 'VS Code refused the technology edit.'));
            return;
        }
        const updatedDocument = getDocumentByUri(this.options.uri);
        const updatedVersion = updatedDocument?.version ?? document.version + 1;
        this.options.recordLocallyAppliedVersion?.(message.command, updatedVersion);
        await this.applied(message, updatedVersion, payload);
    }

    private async reportError(message: TechnologyEditMessage, reason: string): Promise<void> {
        await vscode.window.showErrorMessage(reason);
        await this.reject(message, reason);
    }

    private async applied(message: TechnologyEditMessage, documentVersion: number, payload: Record<string, unknown>): Promise<void> {
        await this.options.webview.postMessage({
            command: 'technologyEditApplied',
            requestId: message.requestId,
            documentVersion,
            ...payload,
        });
    }

    private async reject(message: TechnologyEditMessage, reason: string, cancelled = false): Promise<void> {
        await this.options.webview.postMessage({
            command: 'technologyEditRejected',
            requestId: message.requestId,
            documentVersion: getDocumentByUri(this.options.uri)?.version,
            reason,
            cancelled,
        });
    }
}

function isTechnologyEditCommand(command: string): command is TechnologyEditMessage['command'] {
    return command === 'applyTechnologyPositionEdits'
        || command === 'toggleTechnologyPath'
        || command === 'toggleTechnologyXor'
        || command === 'createChildTechnologyAtPosition'
        || command === 'deleteTechnologies';
}
