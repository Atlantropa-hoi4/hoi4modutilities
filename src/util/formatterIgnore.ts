import * as vscode from 'vscode';
import { isHoi4VanillaFileSkipped, matchesWorkspaceGlobs } from './vanillaFiles';

const formatterIgnoreSetting = 'formatter.ignoreFiles';

export function isHoi4FormatterIgnored(document: vscode.TextDocument): boolean {
    if (isHoi4VanillaFileSkipped(document)) {
        return true;
    }

    const configuredPatterns = vscode.workspace
        .getConfiguration('hoi4ModUtilities', document.uri)
        .get<unknown>(formatterIgnoreSetting, []);
    return Array.isArray(configuredPatterns) && matchesWorkspaceGlobs(document, configuredPatterns);
}
