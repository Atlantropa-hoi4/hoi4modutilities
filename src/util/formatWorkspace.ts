import * as vscode from 'vscode';
import { Commands } from '../constants';
import { formatHoi4Text, getHoi4FormatterProfile } from '../hoiformat/formatter';
import { localizer } from '../services/localizer';
import { isHoi4FormatterIgnored } from './formatterIgnore';
import { isHoi4VanillaInstallFileSkipped } from './vanillaFiles';

export function registerFormatWorkspace(): vscode.Disposable {
    let running = false;
    return vscode.commands.registerCommand(Commands.FormatWorkspace, async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await formatWorkspace();
        } finally {
            running = false;
        }
    });
}

export async function formatWorkspace(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showInformationMessage(localizer.t('Open a workspace folder to format HOI4 files.'));
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: localizer.t('Format Workspace HOI4 Files'),
        cancellable: true,
    }, async (progress, token) => {
        let formatted = 0;
        let unchanged = 0;
        let failed = 0;
        try {
            const uris = await vscode.workspace.findFiles('**/*.{txt,gfx,gui,TXT,GFX,GUI}', undefined, undefined, token);
            const files = uris.filter(uri => !isHoi4VanillaInstallFileSkipped(uri) && getHoi4FormatterProfile(uri.path) !== undefined);
            for (const uri of files) {
                if (token.isCancellationRequested) {
                    break;
                }
                progress.report({ message: vscode.workspace.asRelativePath(uri), increment: 100 / files.length });
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    if (token.isCancellationRequested) {
                        break;
                    }
                    if (isHoi4FormatterIgnored(document)) {
                        continue;
                    }
                    const text = document.getText();
                    const profile = getHoi4FormatterProfile(uri.path)!;
                    const result = formatHoi4Text(text, { profile, filePath: uri.path });
                    if (result === text) {
                        unchanged++;
                        continue;
                    }
                    // Apply immediately after reading so the edit uses the current document version.
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), result);
                    if (await vscode.workspace.applyEdit(edit)) {
                        formatted++;
                    } else {
                        failed++;
                    }
                } catch (error) {
                    failed++;
                    console.warn('Failed to format workspace file', uri.toString(), error);
                }
            }
        } catch (error) {
            if (!token.isCancellationRequested) {
                void vscode.window.showErrorMessage(localizer.t('Failed to find workspace HOI4 files: {0}', String(error)));
                return;
            }
        }

        const message = localizer.t(
            'Workspace formatting: {0} changed, {1} unchanged, {2} failed. Changes are not saved automatically.',
            formatted, unchanged, failed,
        );
        const status = token.isCancellationRequested ? localizer.t('Formatting cancelled. {0}', message) : message;
        if (failed > 0) {
            void vscode.window.showWarningMessage(status);
        } else {
            void vscode.window.showInformationMessage(status);
        }
    });
}
