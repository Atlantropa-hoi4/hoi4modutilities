import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { StyleTable } from './styletable';
import { forceError, randomString } from './common';
import { localize } from './i18n';

export { htmlAttributeEscape, htmlTextEscape } from './htmlescape';

export interface DynamicScript {
    content: string;
    id?: string;
}

export interface NonceOnly {
    nonce: string;
}

export function previewedFileUriScript(uri: vscode.Uri): DynamicScript {
    return { content: `window.previewedFileUri = ${JSON.stringify(uri.toString())};` };
}

export function html(webview: vscode.Webview, body: string, scripts: (string | DynamicScript)[], styles?: (string | StyleTable | DynamicScript | NonceOnly)[]): string {
    const preparedScripts = scripts.map<[string, string]>(script => {
        if (typeof script === 'string') {
            const uri = contextContainer.current ?
                webview.asWebviewUri(vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/' + script)) :
                "";
            return [
                `<script src="${uri}"></script>`,
                '',
            ];
        } else {
            const nonce = randomString(32);
            return [
                `<script nonce="${nonce}">${script.content}</script>`,
                `'nonce-${nonce}'`,
            ];
        }
    });

    const preparedStyles = styles === undefined ? [['', `'unsafe-inline'`] as [string, string]] :
        styles.map<[string, string]>(style => {
            const nonce = randomString(32);
            if (style instanceof StyleTable) {
                return [
                    style.toStyleElement(nonce),
                    `'nonce-${nonce}'`
                ];
            } else if (typeof style === 'object') {
                if ('nonce' in style) {
                    return [
                        '',
                        `'nonce-${style.nonce}'`,
                    ];
                } else {
                    return [
                        `<style nonce="${nonce}"${style.id ? ` id="${style.id}"` : ''}>${style.content}</style>`,
                        `'nonce-${nonce}'`,
                    ];
                }
            } else {
                const uri = contextContainer.current ?
                    webview.asWebviewUri(vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/' + style)) :
                    "";
                return [
                    `<link rel="stylesheet" href="${uri}"/>`,
                    ''
                ];
            }
        });

    return `
<!DOCTYPE html>
<html lang="${vscode.env.language}">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            style-src ${preparedStyles.map(v => v[1]).join(' ')} ${webview.cspSource};
            script-src ${preparedScripts.map(v => v[1]).filter(v => v.length > 0).join(' ')} ${webview.cspSource};
            img-src data: ${webview.cspSource};
            font-src ${webview.cspSource};
        ">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${preparedScripts.map(v => v[0]).join('')}
        ${preparedStyles.map(v => v[0]).join('')}
    </head>
    <body class="vscode-body" data-extension-id="${contextContainer.current?.extension.id ?? ''}">${body.replace(/\s\s+/g, ' ')}</body>
</html>
`;
}

export function htmlEscape(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;")
         .replace(/\n/g, "&#13;")
         .replace(/ /g, "&nbsp;");
}

export function errorPageContent(cause: unknown): string {
    return `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(cause).toString())}</pre>`;
}

export function errorPage(webview: vscode.Webview, uri: vscode.Uri, cause: unknown): string {
    return html(webview, errorPageContent(cause), [previewedFileUriScript(uri)], []);
}
