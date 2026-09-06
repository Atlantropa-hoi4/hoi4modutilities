import * as vscode from 'vscode';
import { Loader } from '../util/loader/loader';
import { getRelativePathInWorkspace } from '../util/vsccommon';
import { PreviewBase } from './previewbase';

export interface RenderContentOptions {
    dependencyChanged: boolean;
}

export interface LoaderRender {
    html: string;
    update?: {
        styleCss?: string;
        data: Record<string, unknown>;
    };
}

/** Loader-backed preview with deterministic no-op skipping and in-place webview updates. */
export abstract class LoaderPreview<TLoader extends Loader<unknown, unknown>> extends PreviewBase {
    private readonly loader: TLoader;
    private content: string | undefined;
    private pendingRender: LoaderRender | undefined;
    private previousUpdate: string | undefined;
    private hasLoadedPage = false;
    private dependencyChanged = false;

    constructor(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        createLoader: (file: string, contentProvider: () => Promise<string>) => TLoader,
        private readonly render: (loader: TLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions) => Promise<LoaderRender>,
    ) {
        super(uri, panel);
        this.loader = createLoader(getRelativePathInWorkspace(uri), () => Promise.resolve(this.content ?? ''));
        this.loader.onLoadDone(result => this.updateDependencies(result.dependencies));
    }

    public override async onDocumentChange(document: vscode.TextDocument, options?: { source?: 'document' | 'dependency' }): Promise<void> {
        this.dependencyChanged ||= options?.source === 'dependency';
        await super.onDocumentChange(document, options);
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        try {
            const dependencyChanged = this.dependencyChanged;
            this.dependencyChanged = false;
            this.pendingRender = await this.render(this.loader, document.uri, this.panel.webview, { dependencyChanged });
            return this.pendingRender.html;
        } finally {
            this.content = undefined;
        }
    }

    protected async applyContent(content: string): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        const render = this.pendingRender;
        this.pendingRender = undefined;
        const serializedUpdate = render?.update ? JSON.stringify(render.update) : undefined;

        if (this.hasLoadedPage && render?.update && serializedUpdate === this.previousUpdate) {
            return;
        }
        if (this.hasLoadedPage && render?.update && this.panel.visible) {
            const accepted = await this.panel.webview.postMessage({ command: 'updateBody', ...render.update });
            if (accepted) {
                this.previousUpdate = serializedUpdate;
                return;
            }
        }

        if (this.isDisposed) {
            return;
        }
        this.panel.webview.html = content;
        this.hasLoadedPage = true;
        this.previousUpdate = serializedUpdate;
    }
}
