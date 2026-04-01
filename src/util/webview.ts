import * as vscode from 'vscode';
import { contextContainer } from '../context';

export function getStaticResourceRoots(): vscode.Uri[] {
    if (!contextContainer.current) {
        return [];
    }

    return [vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static')];
}

export function getWebviewPanelOptions(options: Partial<vscode.WebviewOptions & vscode.WebviewPanelOptions> = {}): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        enableScripts: true,
        localResourceRoots: getStaticResourceRoots(),
        ...options,
    };
}
