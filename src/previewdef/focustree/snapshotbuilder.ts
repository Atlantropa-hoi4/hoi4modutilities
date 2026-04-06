import * as vscode from 'vscode';
import { buildFocusTreeRenderPayloadFromBaseState, FocusTreeRenderBaseState } from "./contentbuilder";
import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeLoaderAdapter } from "./loaderadapter";
import { createFullFocusTreeRenderUpdate, FocusTreeRenderCache } from "./renderpayloadpatch";
import { FocusTreeAssetLoadMode } from "./loader";
import { FocusTreeSnapshot } from "./runtime";

export interface FocusTreeSnapshotBuilderOptions {
    uri: vscode.Uri;
    webview: vscode.Webview;
    loaderAdapter: FocusTreeLoaderAdapter;
    getConditionPresetsByTree: () => FocusConditionPresetsByTree;
}

export class FocusTreeSnapshotBuilder {
    private readonly uri: vscode.Uri;
    private readonly webview: vscode.Webview;
    private readonly loaderAdapter: FocusTreeLoaderAdapter;
    private readonly getConditionPresetsByTree: () => FocusConditionPresetsByTree;

    constructor(options: FocusTreeSnapshotBuilderOptions) {
        this.uri = options.uri;
        this.webview = options.webview;
        this.loaderAdapter = options.loaderAdapter;
        this.getConditionPresetsByTree = options.getConditionPresetsByTree;
    }

    public renderShell(documentVersion: number): string {
        return this.loaderAdapter.renderShell(
            this.uri,
            this.webview,
            documentVersion,
            this.getConditionPresetsByTree(),
        );
    }

    public async renderDocument(document: vscode.TextDocument): Promise<string> {
        return this.loaderAdapter.renderDocument(
            document,
            this.webview,
            this.getConditionPresetsByTree(),
        );
    }

    public async buildBaseState(
        document: vscode.TextDocument,
        assetLoadMode: FocusTreeAssetLoadMode,
    ): Promise<FocusTreeRenderBaseState> {
        return this.loaderAdapter.buildBaseState(
            document.getText(),
            document.version,
            this.getConditionPresetsByTree(),
            assetLoadMode,
        );
    }

    public async createFullSnapshot(
        baseState: FocusTreeRenderBaseState,
        previousCache?: FocusTreeRenderCache,
    ): Promise<FocusTreeSnapshot> {
        const { payload, metrics } = await buildFocusTreeRenderPayloadFromBaseState(baseState);
        const { update, cache } = createFullFocusTreeRenderUpdate(payload, previousCache);
        return {
            payload,
            update,
            cache,
            metrics,
        };
    }
}
