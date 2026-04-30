import * as vscode from 'vscode';
import { localize } from '../util/i18n';
import { error, debug } from '../util/debug';
import { dirUri, getDocumentByUri } from '../util/vsccommon';
import { isEqual, minBy } from 'lodash';
import { getFilePathFromMod, getHoiOpenedFileOriginalUri, readFileFromModOrHOI4 } from '../util/fileloader';
import { mkdirs, writeFile } from '../util/vsccommon';
import { sendByMessage } from '../util/telemetry';
import { forceError } from '../util/common';

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveFocusIdSelection(
    document: vscode.TextDocument,
    start: number | undefined,
    end: number | undefined,
    focusId: string | undefined,
    useStartAsHint: boolean = true,
): vscode.Range | undefined {
    if (focusId) {
        const text = document.getText();
        const escapedFocusId = escapeRegExp(focusId);
        const pattern = new RegExp(`\\bid\\s*=\\s*(?:"${escapedFocusId}"|'${escapedFocusId}'|${escapedFocusId})(?![\\w-])`, 'g');
        const matches: Array<{ index: number; length: number }> = [];
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            matches.push({ index: match.index, length: match[0].length });
        }

        if (matches.length > 0) {
            const chosen = useStartAsHint && start !== undefined
                ? minBy(matches, m => Math.abs(m.index - start))!
                : matches[0];
            return new vscode.Range(
                document.positionAt(chosen.index),
                document.positionAt(chosen.index + chosen.length),
            );
        }
    }

    if (start === undefined || end === undefined) {
        return undefined;
    }

    return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function collapseSelectionWhenRequested(range: vscode.Range | undefined, select: boolean | undefined): vscode.Range | undefined {
    if (select !== false || range === undefined) {
        return range;
    }

    return new vscode.Range(range.start, range.start);
}

function shouldUseNavigateStartAsHint(document: vscode.TextDocument, documentVersion: number | undefined): boolean {
    return documentVersion === undefined || documentVersion === document.version;
}

export abstract class PreviewBase {
    private cachedDependencies: string[] | undefined = undefined;

    private dependencyChangedEmitter = new vscode.EventEmitter<string[]>();
    public onDependencyChanged = this.dependencyChangedEmitter.event;

    private disposeEmitter = new vscode.EventEmitter<undefined>();
    public onDispose = this.disposeEmitter.event;

    private disposed = false;

    constructor(
        readonly uri: vscode.Uri,
        readonly panel: vscode.WebviewPanel,
    ) {
        this.registerEvents(panel);
    }

    public async onDocumentChange(
        document: vscode.TextDocument,
        _options?: { source?: 'document' | 'dependency' },
    ): Promise<void> {
        try {
            this.panel.webview.html = await this.getContent(document);
        } catch(e) {
            error(e);
        }
    }

    public getDocumentChangeDebounceMs(): number {
        return 250;
    }

    public getDebugState(): unknown {
        return undefined;
    }

    public shouldRefreshOnExternalFileChange(_uri: vscode.Uri, _changeKind: 'change' | 'create' | 'delete'): boolean {
        return false;
    }
    
    public dispose(): void {
        this.dependencyChangedEmitter.dispose();
        this.disposed = true;
        this.disposeEmitter.fire(undefined);
        this.disposeEmitter.dispose();
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    public async initializePanelContent(document: vscode.TextDocument): Promise<void> {
        this.panel.webview.html = localize('loading', 'Loading...');
        await this.onDocumentChange(document);
    }

    protected registerEvents(panel: vscode.WebviewPanel): void {
        panel.webview.onDidReceiveMessage((msg) => {
            void this.handleMessage(msg);
        });
        
        panel.onDidDispose(() => {
            this.dispose();
        });
    }

    protected async onDidReceiveMessage(_msg: any): Promise<boolean> {
        return false;
    }
    
    protected updateDependencies(dependencies: string[]): void {
        if (this.cachedDependencies === undefined || !isEqual(this.cachedDependencies, dependencies)) {
            this.dependencyChangedEmitter.fire(dependencies);
            debug("dependencies: ", this.uri.toString(), JSON.stringify(dependencies));
        }

        this.cachedDependencies = dependencies;
    }

    protected async openOrCopyFile(
        file: string,
        start: number | undefined,
        end: number | undefined,
        focusId?: string,
        select?: boolean,
        documentVersion?: number,
    ): Promise<void> {
        const filePathInMod = await getFilePathFromMod(file);
        if (filePathInMod !== undefined) {
            const filePathInModWithoutOpened = getHoiOpenedFileOriginalUri(filePathInMod);
            const document = getDocumentByUri(filePathInModWithoutOpened) ?? await vscode.workspace.openTextDocument(filePathInModWithoutOpened);
            const resolvedRange = collapseSelectionWhenRequested(
                resolveFocusIdSelection(document, start, end, focusId, shouldUseNavigateStartAsHint(document, documentVersion)),
                select,
            );
            await vscode.window.showTextDocument(document, {
                selection: resolvedRange,
                viewColumn: vscode.ViewColumn.One,
            });
            return;
        }
        
        if (!vscode.workspace.workspaceFolders?.length) {
            await vscode.window.showErrorMessage(localize('preview.mustopenafolder', 'Must open a folder before opening "{0}".', file));
            return;
        }

        let targetFolderUri = vscode.workspace.workspaceFolders[0].uri;
        if (vscode.workspace.workspaceFolders.length >= 1) {
            const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: localize('preview.selectafolder', 'Select a folder to copy "{0}"', file) });
            if (!folder) {
                return;
            }

            targetFolderUri = folder.uri;
        }

        try {
            const targetFolder = targetFolderUri;
            const [buffer] = await readFileFromModOrHOI4(file);
            const targetPath = vscode.Uri.joinPath(targetFolder, file);
            await mkdirs(dirUri(targetPath));
            await writeFile(targetPath, buffer);

            const document = await vscode.workspace.openTextDocument(targetPath);
            const resolvedRange = collapseSelectionWhenRequested(
                resolveFocusIdSelection(document, start, end, focusId, shouldUseNavigateStartAsHint(document, documentVersion)),
                select,
            );
            await vscode.window.showTextDocument(document, {
                selection: resolvedRange,
                viewColumn: vscode.ViewColumn.One,
            });

        } catch (e) {
            await vscode.window.showErrorMessage(localize('preview.failedtoopen', 'Failed to open file "{0}": {1}.', file, forceError(e).toString()));
        }
    }

    protected reload() {        
        const document = getDocumentByUri(this.uri);
        if (document === undefined) {
            return;
        }

        this.onDocumentChange(document);
    }

    protected abstract getContent(document: vscode.TextDocument): Promise<string>;

    private async handleMessage(msg: any): Promise<void> {
        try {
            if (await this.onDidReceiveMessage(msg)) {
                return;
            }

            switch (msg.command) {
                case 'navigate':
                    if (msg.start !== undefined) {
                        if (msg.file === undefined) {
                            const document = getDocumentByUri(this.uri);
                            if (document === undefined) {
                                return;
                            }

                            const resolvedRange = collapseSelectionWhenRequested(
                                resolveFocusIdSelection(
                                    document,
                                    msg.start,
                                    msg.end,
                                    msg.focusId,
                                    shouldUseNavigateStartAsHint(document, msg.documentVersion),
                                ),
                                msg.select,
                            );
                            await vscode.window.showTextDocument(this.uri, {
                                selection: resolvedRange,
                                viewColumn: vscode.ViewColumn.One
                            });
                        } else {
                            await this.openOrCopyFile(msg.file, msg.start, msg.end, msg.focusId, msg.select, msg.documentVersion);
                        }
                    }
                    break;
                case 'telemetry':
                    sendByMessage(msg);
                    break;
                case 'reload':
                    this.reload();
                    break;
            }
        } catch (e) {
            error(e);
        }
    }
}
