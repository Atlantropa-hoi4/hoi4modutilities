import * as vscode from 'vscode';
import { localize } from '../util/i18n';
import { Commands, WebviewType, ContextName } from '../constants';
import { arrayToMap } from '../util/common';
import { debug } from '../util/debug';
import { contextContainer, setVscodeContext } from '../context';
import { basename, getDocumentByUri } from '../util/vsccommon';
import { sendEvent } from '../util/telemetry';
import { getWebviewPanelOptions } from '../util/webview';
import { UpdateScheduler } from '../services/updateScheduler';
import { PreviewProviderResolver } from './previewproviderresolver';
import { PreviewDependencyTracker } from './previewdependencytracker';
import type { PreviewBase } from './previewbase';
import type { PreviewDescriptor, StandardPreviewDescriptor } from './descriptor';

type PreviewUpdateScheduler = Pick<UpdateScheduler<string>, 'schedule' | 'dispose'>;

interface PreviewManagerOptions {
    previewProviders: PreviewDescriptor[];
    documentUpdateScheduler?: PreviewUpdateScheduler;
    dependencyUpdateScheduler?: PreviewUpdateScheduler;
}

export class PreviewManager implements vscode.WebviewPanelSerializer {
    private readonly previews: Record<string, PreviewBase> = {};
    private readonly previewProvidersMap: Record<string, PreviewDescriptor>;
    private readonly previewProviderResolver: PreviewProviderResolver;
    private readonly dependencyTracker = new PreviewDependencyTracker();
    private readonly documentUpdateScheduler: PreviewUpdateScheduler;
    private readonly dependencyUpdateScheduler: PreviewUpdateScheduler;

    constructor(
        private readonly options: PreviewManagerOptions,
    ) {
        this.previewProvidersMap = arrayToMap(options.previewProviders, 'type');
        this.previewProviderResolver = new PreviewProviderResolver(options.previewProviders);
        this.documentUpdateScheduler = options.documentUpdateScheduler ?? new UpdateScheduler<string>(key => key);
        this.dependencyUpdateScheduler = options.dependencyUpdateScheduler ?? new UpdateScheduler<string>(key => key);
    }

    public register(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];
        disposables.push(vscode.commands.registerCommand(Commands.Preview, this.showPreview, this));
        disposables.push(vscode.commands.registerCommand(Commands.DebugFocusTreePreviewState, this.getPreviewDebugState, this));
        disposables.push(vscode.workspace.onDidCloseTextDocument(this.onCloseTextDocument, this));
        disposables.push(vscode.workspace.onDidChangeTextDocument(this.onChangeTextDocument, this));
        disposables.push(vscode.window.onDidChangeActiveTextEditor(this.safeUpdateHoi4PreviewContextValue, this));
        disposables.push(vscode.window.onDidChangeVisibleTextEditors(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));
        disposables.push(vscode.workspace.onDidOpenTextDocument(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));
        disposables.push(vscode.window.registerWebviewPanelSerializer(WebviewType.Preview, this));
        disposables.push(new vscode.Disposable(() => this.documentUpdateScheduler.dispose()));
        disposables.push(new vscode.Disposable(() => this.dependencyUpdateScheduler.dispose()));

        this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor);

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
            await vscode.workspace.openTextDocument(uri);
            await this.showPreviewImpl(uri, panel);
        } catch (e) {
            panel.dispose();
            debug(`dispose panel ${uriStr} because reopen error`);
        }
    }

    private showPreview(uri?: vscode.Uri): Promise<void> {
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

    private updateHoi4PreviewContextValue(textEditor: vscode.TextEditor | undefined): void {
        let shouldShowPreviewButton = false;
        let hoi4PreviewType = '';
        if (textEditor) {
            const provider = this.previewProviderResolver.find(textEditor.document);
            if (provider) {
                shouldShowPreviewButton = true;
                hoi4PreviewType = provider.type;
            }
        }

        setVscodeContext(ContextName.ShouldShowHoi4Preview, shouldShowPreviewButton);
        setVscodeContext(ContextName.ShouldHideHoi4Preview, !shouldShowPreviewButton);
        setVscodeContext(ContextName.Hoi4PreviewType, hoi4PreviewType);
    }

    private safeUpdateHoi4PreviewContextValue(textEditor: vscode.TextEditor | undefined): void {
        try {
            this.updateHoi4PreviewContextValue(textEditor);
        } catch {
            debug(`Failed to update preview context for ${textEditor?.document.uri.toString() ?? '<no editor>'}`);
            setVscodeContext(ContextName.ShouldShowHoi4Preview, false);
            setVscodeContext(ContextName.ShouldHideHoi4Preview, false);
            setVscodeContext(ContextName.Hoi4PreviewType, '');
        }
    }

    private async showPreviewImpl(requestUri?: vscode.Uri, panel?: vscode.WebviewPanel): Promise<void> {
        const document = requestUri === undefined ? vscode.window.activeTextEditor?.document : getDocumentByUri(requestUri);

        if (document === undefined) {
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
            vscode.window.showInformationMessage(
                localize('preview.cantpreviewfile', "Can't preview this file.\nValid types: {0}.", Object.keys(this.previewProvidersMap).join(', ')));
            panel?.dispose();
            debug(`dispose panel ${uri} because no preview provider`);
            this.updateHoi4PreviewContextValue(undefined);
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

    private createPreviewItem(previewProvider: StandardPreviewDescriptor, uri: vscode.Uri, panel: vscode.WebviewPanel, key: string): PreviewBase {
        const previewItem = previewProvider.createPreview(uri, panel);
        debug('preview.create', { uri: key, provider: previewProvider.type, deserialized: !!panel });

        previewItem.onDispose(() => {
            const preview = this.previews[key];
            if (preview) {
                this.dependencyTracker.remove(preview);
                delete this.previews[key];
            }
        });

        previewItem.onDependencyChanged((newDependencies) => {
            this.dependencyTracker.remove(previewItem);
            this.dependencyTracker.add(previewItem, newDependencies);
        });

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
