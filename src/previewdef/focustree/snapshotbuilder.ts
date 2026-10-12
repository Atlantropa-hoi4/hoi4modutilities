import * as vscode from 'vscode';
import {
    buildFocusTreeRenderPayloadFromBaseState,
    FocusTreeAssetStyleBatchHandler,
    FocusTreeAssetStylePatch,
    FocusTreeAssetStylePatchOptions,
    FocusTreeRenderBaseState,
    renderFocusAssetStylePatch,
} from "./contentbuilder";
import type { Focus } from './schema';
import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeLoaderAdapter } from "./loaderadapter";
import {
    createFullFocusTreeRenderUpdateWithCancellation,
    FocusTreeRenderCache,
    FocusTreeRenderPreparation,
} from "./renderpayloadpatch";
import { FocusTreeAssetLoadMode, FocusTreeAssetScope } from "./loader";
import { FocusTreeSnapshot } from "./runtime";
import { FocusTreeInvalidation } from './invalidation';

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

    public async buildBaseState(
        document: vscode.TextDocument,
        assetLoadMode: FocusTreeAssetLoadMode,
        isCancelled?: () => boolean,
        assetScope?: FocusTreeAssetScope,
    ): Promise<FocusTreeRenderBaseState> {
        return this.loaderAdapter.buildBaseState(
            document.getText(),
            document.version,
            this.getConditionPresetsByTree(),
            assetLoadMode,
            isCancelled,
            assetScope,
        );
    }

    public async createFullSnapshot(
        baseState: FocusTreeRenderBaseState,
        previousCache?: FocusTreeRenderCache,
        isCancelled?: () => boolean,
        onAssetStyleBatch?: FocusTreeAssetStyleBatchHandler,
        prepared?: FocusTreeRenderPreparation,
        materializedFocusIds?: readonly string[],
        existingStyleRules?: ReadonlyMap<string, string>,
    ): Promise<FocusTreeSnapshot> {
        const { payload, metrics } = await buildFocusTreeRenderPayloadFromBaseState(
            baseState,
            isCancelled,
            onAssetStyleBatch,
            prepared?.views,
            materializedFocusIds,
            existingStyleRules,
        );
        const { update, cache } = await createFullFocusTreeRenderUpdateWithCancellation(
            payload,
            previousCache,
            isCancelled,
            prepared?.metadata,
        );
        return {
            payload,
            update,
            cache,
            metrics,
        };
    }

    public renderAssetPatch(
        focuses: readonly Focus[],
        options: FocusTreeAssetStylePatchOptions,
    ): Promise<FocusTreeAssetStylePatch> {
        return renderFocusAssetStylePatch(focuses, options);
    }

    public invalidate(invalidation: FocusTreeInvalidation, options?: { reuseLoadedStates?: boolean }): void {
        this.loaderAdapter.invalidate(invalidation, options);
    }

    public setPriorityAssetKeys(assetKeys: readonly string[]): void {
        this.loaderAdapter.setPriorityAssetKeys(assetKeys);
    }

    public dispose(): void {
        this.loaderAdapter.dispose();
    }
}
