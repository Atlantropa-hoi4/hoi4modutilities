import * as vscode from 'vscode';

export interface WorkspaceLocalisationIndexCommit {
    files: readonly vscode.Uri[];
    revision: number;
}

let committed: vscode.EventEmitter<WorkspaceLocalisationIndexCommit> | undefined;
let revision = 0;

/** Subscribe without loading the parser, file resolver, or index service. */
export const onDidCommitWorkspaceLocalisationIndex: vscode.Event<WorkspaceLocalisationIndexCommit> =
    (listener, thisArgs, disposables) => {
        committed ??= new vscode.EventEmitter<WorkspaceLocalisationIndexCommit>();
        return committed.event(listener, thisArgs, disposables);
    };

/** The caller owns the immutable file list and has already published the current index. */
export function notifyWorkspaceLocalisationIndexCommitted(files: readonly vscode.Uri[]): void {
    if (files.length > 0) {
        committed?.fire({ files, revision: ++revision });
    }
}
