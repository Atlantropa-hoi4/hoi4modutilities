import * as vscode from 'vscode';
import {
    buildFocusTreeRenderBaseState,
    FocusTreeRenderBaseState,
    renderFocusTreeFile,
    renderFocusTreeShellHtml,
} from "./contentbuilder";
import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeAssetLoadMode, FocusTreeLoader } from "./loader";

export interface FocusTreeLoaderAdapterOptions {
    focusTreeLoader: FocusTreeLoader;
    updateDependencies: (dependencies: string[]) => void;
}

export class FocusTreeLoaderAdapter {
    private readonly focusTreeLoader: FocusTreeLoader;
    private readonly updateDependencies: (dependencies: string[]) => void;

    constructor(options: FocusTreeLoaderAdapterOptions) {
        this.focusTreeLoader = options.focusTreeLoader;
        this.updateDependencies = options.updateDependencies;
    }

    public renderShell(
        uri: vscode.Uri,
        webview: vscode.Webview,
        documentVersion: number,
        conditionPresetsByTree: FocusConditionPresetsByTree,
    ): string {
        return renderFocusTreeShellHtml(uri, webview, documentVersion, conditionPresetsByTree);
    }

    public async renderDocument(
        document: vscode.TextDocument,
        webview: vscode.Webview,
        conditionPresetsByTree: FocusConditionPresetsByTree,
    ): Promise<string> {
        const loader = this.createSnapshotLoader(document.getText(), 'full');
        const content = await renderFocusTreeFile(
            loader,
            document.uri,
            webview,
            document.version,
            conditionPresetsByTree,
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        return content;
    }

    public async buildBaseState(
        content: string,
        documentVersion: number,
        conditionPresetsByTree: FocusConditionPresetsByTree,
        assetLoadMode: FocusTreeAssetLoadMode,
    ): Promise<FocusTreeRenderBaseState> {
        const loader = this.createSnapshotLoader(content, assetLoadMode);
        const baseState = await buildFocusTreeRenderBaseState(
            loader,
            documentVersion,
            conditionPresetsByTree,
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        return baseState;
    }

    private createSnapshotLoader(
        content: string,
        assetLoadMode: FocusTreeAssetLoadMode,
    ): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(() => Promise.resolve(content), assetLoadMode);
        loader.onLoadDone(result => this.updateDependencies(result.dependencies));
        return loader;
    }
}
