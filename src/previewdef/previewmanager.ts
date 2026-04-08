import * as vscode from 'vscode';
import { focusTreePreviewDef } from './focustree';
import { localize } from '../util/i18n';
import { gfxPreviewDef } from './gfx';
import { Commands, WebviewType, ContextName } from '../constants';
import { technologyPreviewDef } from './technology';
import { matchPathEnd } from '../util/nodecommon';
import { arrayToMap } from '../util/common';
import { debug, error } from '../util/debug';
import { PreviewBase } from './previewbase';
import { contextContainer, setVscodeContext } from '../context';
import { basename, getDocumentByUri } from '../util/vsccommon';
import { worldMapPreviewDef } from './worldmap';
import { eventPreviewDef } from './event';
import { sendEvent } from '../util/telemetry';
import { guiPreviewDef } from './gui';
import { mioPreviewDef } from './mio';
import { getWebviewPanelOptions } from '../util/webview';
import { PreviewDescriptor } from './descriptor';
import { UpdateScheduler } from '../services/updateScheduler';

interface DependencySubscription {
    segments: string[];
    preview: PreviewBase;
}

export class PreviewManager implements vscode.WebviewPanelSerializer {
    private readonly previews: Record<string, PreviewBase> = {};
    private readonly previewProviderCache = new Map<string, { version: number; providerType: string | undefined }>();
    private readonly documentUpdateScheduler = new UpdateScheduler<string>(key => key);
    private readonly dependencyUpdateScheduler = new UpdateScheduler<string>(key => key);

    private readonly previewProviders: PreviewDescriptor[] = [
        focusTreePreviewDef,
        gfxPreviewDef,
        technologyPreviewDef,
        worldMapPreviewDef,
        eventPreviewDef,
        guiPreviewDef,
        mioPreviewDef,
    ];
    private readonly previewProvidersMap: Record<string, PreviewDescriptor> = arrayToMap(this.previewProviders, 'type');
    private readonly dependencySubscriptions: DependencySubscription[] = [];

    public register(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];
        disposables.push(vscode.commands.registerCommand(Commands.Preview, this.showPreview, this));
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
            await vscode.workspace.openTextDocument(uri);
            await this.showPreviewImpl(uri, panel);
        } catch (e) {
            error(e);
            panel.dispose();
            debug(`dispose panel ${uriStr} because reopen error`);
        }
    }

    private showPreview(uri?: vscode.Uri): Promise<void> {
        return this.showPreviewImpl(uri);
    }

    private onCloseTextDocument(document: vscode.TextDocument): void {
        this.previewProviderCache.delete(document.uri.toString());
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
            const provider = this.findPreviewProvider(textEditor.document);
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
        } catch (e) {
            error(e);
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
            this.previews[key].panel.reveal();
            panel?.dispose();
            debug(`dispose panel ${uri} because preview already open`);
            return;
        }

        const previewProvider = this.findPreviewProvider(document);
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

        const previewItem = previewProvider.createPreview(uri, panel);
        this.previews[key] = previewItem;

        previewItem.onDispose(() => {
            const preview = this.previews[key];
            if (preview) {
                this.removePreviewFromSubscription(preview);
                delete this.previews[key];
            }
        });

        previewItem.onDependencyChanged((newDependencies) => {
            this.removePreviewFromSubscription(previewItem);
            this.addPreviewToSubscription(previewItem, newDependencies);
        });

        await previewItem.initializePanelContent(document);
    }

    private findPreviewProvider(document: vscode.TextDocument): PreviewDescriptor | undefined {
        const cacheKey = document.uri.toString();
        const cached = this.previewProviderCache.get(cacheKey);
        if (cached?.version === document.version) {
            return cached.providerType ? this.previewProvidersMap[cached.providerType] : undefined;
        }

        let bestProvider: PreviewDescriptor | undefined;
        let bestPriority: number | undefined;

        for (const provider of this.previewProviders) {
            const priority = this.safeCanPreview(provider, document);
            if (priority === undefined) {
                continue;
            }

            if (bestPriority === undefined || priority < bestPriority) {
                bestProvider = provider;
                bestPriority = priority;
            }
        }

        this.previewProviderCache.set(cacheKey, {
            version: document.version,
            providerType: bestProvider?.type,
        });
        return bestProvider;
    }

    private safeCanPreview(provider: PreviewDescriptor, document: vscode.TextDocument): number | undefined {
        try {
            return provider.canPreview(document);
        } catch (e) {
            error(e);
            debug(`Preview provider ${provider.type} failed for ${document.uri.toString()}`);
            return undefined;
        }
    }

    private addPreviewToSubscription(previewItem: PreviewBase, dependencies: string[]): void {
        for (const dependency of dependencies) {
            this.dependencySubscriptions.push({
                segments: dependency.split('/').filter(Boolean),
                preview: previewItem,
            });
        }
    }

    private removePreviewFromSubscription(previewItem: PreviewBase): void {
        for (let i = this.dependencySubscriptions.length - 1; i >= 0; i--) {
            if (this.dependencySubscriptions[i].preview === previewItem) {
                this.dependencySubscriptions.splice(i, 1);
            }
        }
    }

    private getPreviewItemsNeedsUpdate(uri: string): PreviewBase[] {
        const previews = new Set<PreviewBase>();
        for (const subscription of this.dependencySubscriptions) {
            if (matchPathEnd(uri, subscription.segments)) {
                previews.add(subscription.preview);
            }
        }

        return [...previews];
    }

    private updatePreviewItemsInSubscription(uri: vscode.Uri): void {
        this.dependencyUpdateScheduler.schedule(uri.toString(), 1000, async () => {
            for (const otherPreview of this.getPreviewItemsNeedsUpdate(uri.toString())) {
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

export const previewManager = new PreviewManager();
