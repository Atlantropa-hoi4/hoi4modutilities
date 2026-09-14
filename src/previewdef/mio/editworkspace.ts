import * as vscode from 'vscode';
import type { MioEditMessage } from './editcommon';
import { buildMioTextEdit, MioTextEditResult } from './editservice';
import type { Mio } from './schema';

export function buildMioWorkspaceEdit(
    document: vscode.TextDocument,
    message: MioEditMessage,
    mio: Mio,
): MioTextEditResult & { edit?: vscode.WorkspaceEdit } {
    const originalContent = document.getText();
    const result = buildMioTextEdit(originalContent, message, mio);
    if (result.error || result.updatedContent === undefined || result.updatedContent === originalContent) {
        return result;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(originalContent.length)),
        result.updatedContent,
    );
    return { ...result, edit };
}
