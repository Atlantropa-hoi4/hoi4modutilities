import * as vscode from 'vscode';
import { ConfigurationKey, Hoi4FsSchema } from '../constants';
import { getRelativePathWithinRoot } from './nodecommon';

// Vanilla originals, including DLC folders under the install path, must never be edited automatically.
export function isHoi4InstallFile(uri: vscode.Uri): boolean {
    if (uri.scheme === Hoi4FsSchema) {
        return true;
    }

    const installPath = vscode.workspace.getConfiguration(ConfigurationKey).get<unknown>('installPath', '');
    return uri.scheme === 'file'
        && typeof installPath === 'string'
        && installPath.trim() !== ''
        && getRelativePathWithinRoot(installPath.trim(), uri.fsPath, '') !== undefined;
}
