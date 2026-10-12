import * as vscode from 'vscode';
import {
    buildFocusTreeRenderBaseState,
    FocusTreeRenderBaseState,
    renderFocusTreeShellHtml,
} from "./contentbuilder";
import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeAssetLoadMode, FocusTreeAssetScope, FocusTreeLoader } from "./loader";
import { FocusTreeInvalidation } from './invalidation';
import { isLocalisationIndexReady } from '../../util/localisationIndex';

export interface FocusTreeSessionSnapshot {
    documentVersion: number;
    sourceText: string;
    structureState?: FocusTreeRenderBaseState;
    assetState?: FocusTreeRenderBaseState;
    assetScopeKey?: string;
    treeCatalog: Array<{ id: string; focusCount: number }>;
    assetReferences: string[];
}

export interface FocusTreeLoaderAdapterOptions {
    focusTreeLoader: FocusTreeLoader;
    updateDependencies: (dependencies: string[]) => void;
}

/**
 * Cache key of the trees an asset scope prepares. The loader prepares the selected tree plus
 * `treeIds`, so `{ treeId: 'A' }` and `{ treeId: 'A', treeIds: ['A'] }` share one key; a refresh
 * after hydration then reuses the hydrated state instead of loading it again.
 */
export function getFocusTreeAssetScopeKey(assetScope: FocusTreeAssetScope | undefined): string {
    if (!assetScope) {
        return '*';
    }
    const additionalTreeIds = Array.from(new Set(assetScope.treeIds ?? []))
        .filter(treeId => treeId !== assetScope.treeId)
        .sort();
    return JSON.stringify([assetScope.treeId ?? null, additionalTreeIds]);
}

export class FocusTreeLoaderAdapter {
    private readonly focusTreeLoader: FocusTreeLoader;
    private readonly updateDependencies: (dependencies: string[]) => void;
    private sessionSnapshot: FocusTreeSessionSnapshot | undefined;
    private dependencies: string[] = [];
    private dependencyAssetTreeIds: string[] = [];
    private replaceDependenciesOnAssetLoad = false;
    private generation = 0;

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

    public async buildBaseState(
        content: string,
        documentVersion: number,
        conditionPresetsByTree: FocusConditionPresetsByTree,
        assetLoadMode: FocusTreeAssetLoadMode,
        isCancelled?: () => boolean,
        assetScope?: FocusTreeAssetScope,
    ): Promise<FocusTreeRenderBaseState> {
        if (this.sessionSnapshot?.documentVersion !== documentVersion
            || this.sessionSnapshot.sourceText !== content) {
            this.generation++;
            this.replaceDependenciesOnAssetLoad = true;
            this.sessionSnapshot = {
                documentVersion,
                sourceText: content,
                treeCatalog: [],
                assetReferences: [],
            };
        }
        const sessionSnapshot = this.sessionSnapshot;
        const scopeKey = getFocusTreeAssetScopeKey(assetScope);
        const cachedState = assetLoadMode === 'deferred'
            ? sessionSnapshot.structureState
            : sessionSnapshot.assetScopeKey === scopeKey ? sessionSnapshot.assetState : undefined;
        if (cachedState) {
            return cachedState;
        }

        const generation = this.generation;
        const loader = this.createSnapshotLoader(content, assetLoadMode, documentVersion, assetScope, isCancelled);
        const baseState = await buildFocusTreeRenderBaseState(
            loader,
            documentVersion,
            conditionPresetsByTree,
            isCancelled,
        );
        if (!isCancelled?.() && this.sessionSnapshot === sessionSnapshot && this.generation === generation) {
            this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
            if (assetLoadMode === 'deferred') {
                sessionSnapshot.structureState = baseState;
            } else {
                sessionSnapshot.assetState = baseState;
                sessionSnapshot.assetScopeKey = scopeKey;
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

    /**
     * `reuseLoadedStates` keeps loaded states for a localisation-only invalidation. It is safe
     * only when the whole index just became ready: loaded trees, icons, and watchers never depend
     * on localisation, and rendering resolves names from the complete index. Edited localisation
     * files keep reloading, because their index update may still be in progress.
     */
    public invalidate(invalidation: FocusTreeInvalidation, options?: { reuseLoadedStates?: boolean }): void {
        this.generation++;
        if (invalidation !== FocusTreeInvalidation.None) {
            this.replaceDependenciesOnAssetLoad = true;
        }
        if ((invalidation & (FocusTreeInvalidation.Layout
            | FocusTreeInvalidation.Presentation
            | FocusTreeInvalidation.Assets)) !== 0) {
            this.focusTreeLoader.clearIconAssetResolution();
        }
        if (!this.sessionSnapshot) {
            return;
        }
        if ((invalidation & FocusTreeInvalidation.Structure) !== 0) {
            this.sessionSnapshot = undefined;
            this.focusTreeLoader.clearSourceSnapshot();
            return;
        }
        if (invalidation === FocusTreeInvalidation.Localisation && options?.reuseLoadedStates) {
            // Rendering resolves display names, filter labels, and token warnings again.
            const localisationIndexReady = isLocalisationIndexReady();
            for (const state of [this.sessionSnapshot.structureState, this.sessionSnapshot.assetState]) {
                if (state) {
                    state.focusDisplayNameById = undefined;
                    state.localisationIndexReady = localisationIndexReady;
                }
            }
        } else if ((invalidation & (FocusTreeInvalidation.Layout
            | FocusTreeInvalidation.Presentation
            | FocusTreeInvalidation.Assets
            | FocusTreeInvalidation.Localisation)) !== 0) {
            this.sessionSnapshot.assetState = undefined;
            this.sessionSnapshot.assetScopeKey = undefined;
        }
    }

    public setPriorityAssetKeys(assetKeys: readonly string[]): void {
        this.focusTreeLoader.setPriorityIconNames(assetKeys);
    }

    private createSnapshotLoader(
        content: string,
        assetLoadMode: FocusTreeAssetLoadMode,
        documentVersion: number,
        assetScope?: FocusTreeAssetScope,
        isCancelled?: () => boolean,
    ): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(
            () => Promise.resolve(content),
            assetLoadMode,
            String(documentVersion),
            assetScope,
        );
        const generation = this.generation;
        loader.onLoadDone(result => {
            if (generation !== this.generation || isCancelled?.()) { return; }
            const catalogTreeIds = new Set(result.result.focusTrees.map(tree => tree.id));
            const liveLoadedTreeIds = this.dependencyAssetTreeIds.filter(id => catalogTreeIds.has(id));
            const assetTreeIds = result.result.assetTreeIds ?? Array.from(catalogTreeIds);
            if (assetLoadMode === 'full' && this.replaceDependenciesOnAssetLoad
                && liveLoadedTreeIds.every(id => assetTreeIds.includes(id))) {
                // The refresh covers every still-loaded scene; its manifest replaces obsolete paths.
                this.dependencies = result.dependencies;
                this.dependencyAssetTreeIds = assetTreeIds;
                this.replaceDependenciesOnAssetLoad = false;
            } else {
                this.dependencies = Array.from(new Set([...this.dependencies, ...result.dependencies]));
                if (assetLoadMode === 'full') {
                    this.dependencyAssetTreeIds = Array.from(new Set([...liveLoadedTreeIds, ...assetTreeIds]));
                }
            }
            this.updateDependencies(this.dependencies);
        });
        return loader;
    }

    public dispose(): void {
        this.generation++;
        this.dependencies = [];
        this.dependencyAssetTreeIds = [];
        this.replaceDependenciesOnAssetLoad = false;
        this.sessionSnapshot = undefined;
        this.focusTreeLoader.clearSourceSnapshot();
        this.focusTreeLoader.clearIconAssetResolution();
    }
}
