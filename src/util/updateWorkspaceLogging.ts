import * as vscode from 'vscode';
import { Commands } from '../constants';
import { getWorkspaceLoggingProfile, updateWorkspaceLogging } from '../hoiformat/workspaceLogging';
import { localizer } from '../services/localizer';
import { isHoi4VanillaInstallFileSkipped } from './vanillaFiles';

export function registerUpdateWorkspaceLogging(): vscode.Disposable {
    let running = false;
    return vscode.commands.registerCommand(Commands.UpdateWorkspaceLogging, async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await updateWorkspaceLoggingInWorkspace();
        } finally {
            running = false;
        }
    });
}

export async function updateWorkspaceLoggingInWorkspace(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showInformationMessage(localizer.t('Open a workspace folder to insert or update HOI4 logs.'));
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: localizer.t('Insert and Update Workspace Logs'),
        cancellable: true,
    }, async (progress, token) => {
        let changed = 0;
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let failed = 0;
        try {
            const uris = await vscode.workspace.findFiles('**/*.{txt,TXT}', undefined, undefined, token);
            const files = uris.filter(uri =>
                !isHoi4VanillaInstallFileSkipped(uri) && getWorkspaceLoggingProfile(uri.path) !== undefined);
            for (const uri of files) {
                if (token.isCancellationRequested) {
                    break;
                }
                progress.report({
                    message: vscode.workspace.asRelativePath(uri),
                    increment: files.length > 0 ? 100 / files.length : undefined,
                });
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    if (token.isCancellationRequested) {
                        break;
                    }
                    const text = document.getText();
                    const profile = getWorkspaceLoggingProfile(uri.path)!;
                    const result = updateWorkspaceLogging(text, uri.path, profile);
                    if (result.text === text) {
                        unchanged++;
                        continue;
                    }

                    // Apply immediately after reading so the edit uses the current document version.
                    // Documents stay unsaved, allowing review and one undo operation per changed file.
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), result.text);
                    if (await vscode.workspace.applyEdit(edit)) {
                        changed++;
                        inserted += result.inserted;
                        updated += result.updated;
                    } else {
                        failed++;
                    }
                } catch (error) {
                    failed++;
                    console.warn('Failed to insert or update workspace logging', uri.toString(), error);
                }
            }
        } catch (error) {
            if (!token.isCancellationRequested) {
                void vscode.window.showErrorMessage(localizer.t('Failed to find workspace HOI4 logging files: {0}', String(error)));
                return;
            }
        }

        const message = localizer.t(
            'Workspace logging: {0} files changed ({1} logs inserted, {2} updated), {3} unchanged, {4} failed. Changes are not saved automatically.',
            changed, inserted, updated, unchanged, failed,
        );
        const status = token.isCancellationRequested ? localizer.t('Logging update cancelled. {0}', message) : message;
        if (failed > 0) {
            void vscode.window.showWarningMessage(status);
        } else {
            void vscode.window.showInformationMessage(status);
        }
    });
}
