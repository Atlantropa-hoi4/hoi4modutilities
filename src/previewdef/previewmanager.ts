import * as vscode from 'vscode';
import { localize } from '../util/i18n';
import { Commands, WebviewType, ContextName } from '../constants';
import { arrayToMap } from '../util/common';
import { debug } from '../util/debug';
import { contextContainer } from '../context';
import { basename, getDocumentByUri } from '../util/vsccommon';
import { sendEvent } from '../util/telemetry';
import { getWebviewPanelOptions } from '../util/webview';
import { UpdateScheduler } from '../services/updateScheduler';
import { PreviewProviderResolver } from './previewproviderresolver';
import { PreviewDependencyTracker } from './previewdependencytracker';
import { PreviewContextService } from './previewcontextservice';
import { PreviewSessionStore } from './previewsessionstore';
import type { PreviewBase } from './previewbase';
import type { PreviewDescriptor, StandardPreviewDescriptor } from './descriptor';

type PreviewUpdateScheduler = Pick<UpdateScheduler<string>, 'schedule' | 'dispose'>;
const previewAssetWatcherGlob = '**/*.{dds,tga,png}';

interface PreviewManagerOptions {
    previewProviders: PreviewDescriptor[];
    documentUpdateScheduler?: PreviewUpdateScheduler;
    dependencyUpdateScheduler?: PreviewUpdateScheduler;
}

export class PreviewManager implements vscode.WebviewPanelSerializer {
    private readonly previewProvidersMap: Record<string, PreviewDescriptor>;
    private readonly previewProviderResolver: PreviewProviderResolver;
    private readonly dependencyTracker = new PreviewDependencyTracker();
    private readonly previewContextService: PreviewContextService;
    private readonly previewSessionStore: PreviewSessionStore;
    private readonly previews: Record<string, PreviewBase>;
    private readonly documentUpdateScheduler: PreviewUpdateScheduler;
    private readonly dependencyUpdateScheduler: PreviewUpdateScheduler;

    constructor(
        private readonly options: PreviewManagerOptions,
    ) {
        this.previewProvidersMap = arrayToMap(options.previewProviders, 'type');
        this.previewProviderResolver = new PreviewProviderResolver(options.previewProviders);
        this.previewContextService = new PreviewContextService(this.previewProviderResolver);
        this.previewSessionStore = new PreviewSessionStore(this.dependencyTracker);
        this.previews = this.previewSessionStore.items;
        this.documentUpdateScheduler = options.documentUpdateScheduler ?? new UpdateScheduler<string>(key => key);
        this.dependencyUpdateScheduler = options.dependencyUpdateScheduler ?? new UpdateScheduler<string>(key => key);
    }

    public register(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];
        disposables.push(vscode.commands.registerCommand(Commands.Preview, this.showPreview, this));
        disposables.push(vscode.commands.registerCommand(Commands.DebugFocusTreePreviewState, this.getPreviewDebugState, this));
        disposables.push(vscode.workspace.onDidCloseTextDocument(this.onCloseTextDocument, this));
        disposables.push(vscode.workspace.onDidChangeTextDocument(this.onChangeTextDocument, this));
        const assetWatcher = vscode.workspace.createFileSystemWatcher(previewAssetWatcherGlob);
        disposables.push(assetWatcher);
        disposables.push(assetWatcher.onDidChange(this.onDidChangeWatchedAsset, this));
        disposables.push(assetWatcher.onDidCreate(this.onDidChangeWatchedAsset, this));
        disposables.push(assetWatcher.onDidDelete(this.onDidChangeWatchedAsset, this));
        disposables.push(this.previewContextService.register());
        disposables.push(vscode.window.registerWebviewPanelSerializer(WebviewType.Preview, this));
        disposables.push(new vscode.Disposable(() => this.documentUpdateScheduler.dispose()));
        disposables.push(new vscode.Disposable(() => this.dependencyUpdateScheduler.dispose()));

        return vscode.Disposable.from(...disposables);
    }

    public async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        const uriStr = (state as { uri?: string } | undefined)?.uri;
        if (!uriStr) {
            panel.dispose();
            debug('dispose panel ??? because uri not exist');
            return;
        }

        try {
            const uri = vscode.Uri.parse(uriStr, true);
            debug('preview.deserialize', { uri: uriStr, viewType: panel.viewType });
            await this.showPreviewImpl(uri, panel);
        } catch (e) {
            panel.dispose();
            debug(`dispose panel ${uriStr} because reopen error`);
        }
    }

    private showPreview(uri?: vscode.Uri): Promise<void> {
        this.previewContextService.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor);
        return this.showPreviewImpl(uri);
    }

    private onCloseTextDocument(document: vscode.TextDocument): void {
        this.previewProviderResolver.clear(document.uri);
        if (!vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === document.uri.toString())) {
            const key = document.uri.toString();
            this.previews[key]?.panel.dispose();
            debug(`dispose panel ${key} because text document closed`);
        }

        this.updatePreviewItemsInSubscription(document.uri);
    }

    private onChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        const document = e.document;
        const key = document.uri.toString();
        const preview = this.previews[key];
        if (preview !== undefined) {
            this.updatePreviewItem(preview, document);
        }

        this.updatePreviewItemsInSubscription(document.uri);
    }

    private onDidChangeWatchedAsset(uri: vscode.Uri): void {
        this.updatePreviewItemsInSubscription(uri);
    }

    private safeUpdateHoi4PreviewContextValue(textEditor: vscode.TextEditor | undefined): void {
        this.previewContextService.safeUpdateHoi4PreviewContextValue(textEditor);
    }

    private async showPreviewImpl(requestUri?: vscode.Uri, panel?: vscode.WebviewPanel): Promise<void> {
        const document = await this.resolveRequestedDocument(requestUri);

        if (document === undefined) {
            if (requestUri && !this.canResolvePreviewDocument(requestUri)) {
                panel?.dispose();
                debug(`dispose panel ${requestUri.toString()} because uri scheme is not previewable`);
                return;
            }

            if (requestUri === undefined) {
                vscode.window.showErrorMessage(localize('preview.noactivedoc', 'No active document.'));
            } else {
                vscode.window.showErrorMessage(localize('preview.cantfinddoc', "Can't find opened document {0}.", requestUri?.toString()));
            }
            panel?.dispose();
            debug(`dispose panel ${requestUri} because document not opened`);
            return;
        }

        const uri = document.uri;
        const key = uri.toString();
        if (key in this.previews) {
            debug('preview.reveal-existing', { uri: key, panelProvided: !!panel });
            this.previews[key].panel.reveal();
            panel?.dispose();
            debug(`dispose panel ${uri} because preview already open`);
            return;
        }

        const previewProvider = this.previewProviderResolver.find(document);
        if (!previewProvider) {
            panel?.dispose();
            debug(`dispose panel ${uri} because no preview provider`);
            this.previewContextService.clearPreviewContext();
            return;
        }

        if (previewProvider.kind === 'alternative') {
            return previewProvider.onPreview(document);
        }

        if (!panel) {
            sendEvent('preview.show.' + previewProvider.type);
        }

        const filename = basename(uri);
        panel = panel ?? vscode.window.createWebviewPanel(
            WebviewType.Preview,
            localize('preview.viewtitle', 'HOI4: {0}', filename),
            vscode.ViewColumn.Beside,
            getWebviewPanelOptions(previewProvider.panelOptions),
        );

        if (contextContainer.current) {
            panel.iconPath = {
                light: vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/preview-right-light.svg'),
                dark: vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/preview-right-dark.svg'),
            };
        }

        this.previews[key] = this.createPreviewItem(previewProvider, uri, panel, key);
        await this.previews[key].initializePanelContent(document);
    }

    private async resolveRequestedDocument(requestUri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
        if (requestUri === undefined) {
            return vscode.window.activeTextEditor?.document;
        }

        const existingDocument = getDocumentByUri(requestUri);
        if (existingDocument) {
            return existingDocument;
        }

        if (!this.canResolvePreviewDocument(requestUri)) {
            return undefined;
        }

        try {
            return await vscode.workspace.openTextDocument(requestUri);
        } catch {
            return undefined;
        }
    }

    private canResolvePreviewDocument(uri: vscode.Uri): boolean {
        return uri.scheme === 'file' || uri.scheme === 'untitled';
    }

    private createPreviewItem(previewProvider: StandardPreviewDescriptor, uri: vscode.Uri, panel: vscode.WebviewPanel, key: string): PreviewBase {
        const previewItem = previewProvider.createPreview(uri, panel);
        debug('preview.create', { uri: key, provider: previewProvider.type, deserialized: !!panel });
        this.previewSessionStore.bind(key, previewItem);
        return previewItem;
    }

    private getPreviewDebugState(uri?: vscode.Uri | string): unknown {
        const resolvedUri = typeof uri === 'string'
            ? vscode.Uri.parse(uri, true)
            : uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!resolvedUri) {
            return undefined;
        }

        return this.previews[resolvedUri.toString()]?.getDebugState();
    }

    private updatePreviewItemsInSubscription(uri: vscode.Uri): void {
        this.dependencyUpdateScheduler.schedule(uri.toString(), 1000, async () => {
            for (const otherPreview of this.dependencyTracker.getAffected(uri.toString())) {
                if (uri.toString() === otherPreview.uri.toString()) {
                    continue;
                }
                const otherDocument = getDocumentByUri(otherPreview.uri);
                if (otherDocument) {
                    await otherPreview.onDocumentChange(otherDocument);
                }
            }
        });
    }

    private updatePreviewItem(previewItem: PreviewBase, document: vscode.TextDocument): void {
        const key = previewItem.uri.toString();
        this.documentUpdateScheduler.schedule(key, previewItem.getDocumentChangeDebounceMs(), async () => {
            if (!previewItem.isDisposed) {
                await previewItem.onDocumentChange(document);
            }
        });
    }
}
