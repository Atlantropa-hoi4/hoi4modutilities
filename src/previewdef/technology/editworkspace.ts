import * as vscode from 'vscode';
import type { TechnologyTextChangeResult } from './editservice';

export function buildTechnologyWorkspaceEdit(
    document: vscode.TextDocument,
    result: TechnologyTextChangeResult,
): { edit?: vscode.WorkspaceEdit; error?: string; referenceCount?: number } {
    if (result.error) {
        return { error: result.error };
    }
    if (!result.changes || result.changes.length === 0) {
        return { referenceCount: result.referenceCount };
    }
    const edit = new vscode.WorkspaceEdit();
    for (const change of result.changes) {
        edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(change.range.start), document.positionAt(change.range.end)),
            change.text,
        );
    }
    return { edit, referenceCount: result.referenceCount };
}
