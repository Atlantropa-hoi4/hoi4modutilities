import * as vscode from 'vscode';
import {
    buildFocusTreeRenderBaseState,
    FocusTreeRenderBaseState,
    renderFocusTreeFile,
    renderFocusTreeShellHtml,
} from "./contentbuilder";
import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeAssetLoadMode, FocusTreeLoader } from "./loader";
import { FocusTreeInvalidation } from './invalidation';

export interface FocusTreeSessionSnapshot {
    documentVersion: number;
    sourceText: string;
    structureState?: FocusTreeRenderBaseState;
    assetState?: FocusTreeRenderBaseState;
    treeCatalog: Array<{ id: string; focusCount: number }>;
    assetReferences: string[];
}

export interface FocusTreeLoaderAdapterOptions {
    focusTreeLoader: FocusTreeLoader;
    updateDependencies: (dependencies: string[]) => void;
}

export class FocusTreeLoaderAdapter {
    private readonly focusTreeLoader: FocusTreeLoader;
    private readonly updateDependencies: (dependencies: string[]) => void;
    private sessionSnapshot: FocusTreeSessionSnapshot | undefined;

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
        const loader = this.createSnapshotLoader(document.getText(), 'full', document.version);
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
        isCancelled?: () => boolean,
    ): Promise<FocusTreeRenderBaseState> {
        if (this.sessionSnapshot?.documentVersion !== documentVersion
            || this.sessionSnapshot.sourceText !== content) {
            this.sessionSnapshot = {
                documentVersion,
                sourceText: content,
                treeCatalog: [],
                assetReferences: [],
            };
        }
        const sessionSnapshot = this.sessionSnapshot;
        const cachedState = assetLoadMode === 'deferred'
            ? sessionSnapshot.structureState
            : sessionSnapshot.assetState;
        if (cachedState) {
            return cachedState;
        }

        const loader = this.createSnapshotLoader(content, assetLoadMode, documentVersion);
        const baseState = await buildFocusTreeRenderBaseState(
            loader,
            documentVersion,
            conditionPresetsByTree,
            isCancelled,
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        if (!isCancelled?.() && this.sessionSnapshot === sessionSnapshot) {
            if (assetLoadMode === 'deferred') {
                sessionSnapshot.structureState = baseState;
            } else {
                sessionSnapshot.assetState = baseState;
            }
            sessionSnapshot.treeCatalog = baseState.focusTrees.map(tree => ({
                id: tree.id,
                focusCount: Object.keys(tree.focuses).length,
            }));
            sessionSnapshot.assetReferences = Array.from(new Set(baseState.allFocuses.flatMap(focus => [
                ...focus.icon.map(option => option.icon).filter((icon): icon is string => !!icon),
                ...(focus.overlay ? [focus.overlay] : []),
            ])));
        }
        return baseState;
    }

    public invalidate(invalidation: FocusTreeInvalidation): void {
        if (!this.sessionSnapshot) {
            return;
        }
        if ((invalidation & FocusTreeInvalidation.Structure) !== 0) {
            this.sessionSnapshot = undefined;
            this.focusTreeLoader.clearSourceSnapshot();
            return;
        }
        if ((invalidation & (FocusTreeInvalidation.Layout
            | FocusTreeInvalidation.Presentation
            | FocusTreeInvalidation.Assets
            | FocusTreeInvalidation.Localisation)) !== 0) {
            this.sessionSnapshot.assetState = undefined;
        }
    }

    public setPriorityAssetKeys(assetKeys: readonly string[]): void {
        this.focusTreeLoader.setPriorityIconNames(assetKeys);
    }

    private createSnapshotLoader(
        content: string,
        assetLoadMode: FocusTreeAssetLoadMode,
        documentVersion: number,
    ): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(
            () => Promise.resolve(content),
            assetLoadMode,
            String(documentVersion),
        );
        loader.onLoadDone(result => this.updateDependencies(result.dependencies));
        return loader;
    }

    public dispose(): void {
        this.sessionSnapshot = undefined;
        this.focusTreeLoader.clearSourceSnapshot();
    }
}
