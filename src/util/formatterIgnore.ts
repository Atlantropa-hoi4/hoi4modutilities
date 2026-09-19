import * as vscode from 'vscode';
import { isHoi4InstallFile } from './hoi4InstallFile';

const formatterIgnoreSetting = 'formatter.ignoreFiles';

export function isHoi4FormatterIgnored(document: vscode.TextDocument): boolean {
    if (isHoi4InstallFile(document.uri)) {
        return true;
    }

    const configuredPatterns = vscode.workspace
        .getConfiguration('hoi4ModUtilities', document.uri)
        .get<unknown>(formatterIgnoreSetting, []);
    if (!Array.isArray(configuredPatterns)) {
        return false;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    return configuredPatterns.some(pattern => {
        if (typeof pattern !== 'string') {
            return false;
        }

        const normalizedPattern = pattern.trim();
        if (normalizedPattern === '') {
            return false;
        }

        const globPattern = workspaceFolder === undefined
            ? normalizedPattern
            : new vscode.RelativePattern(workspaceFolder, normalizedPattern);
        return vscode.languages.match({ pattern: globPattern }, document) > 0;
    });
}
