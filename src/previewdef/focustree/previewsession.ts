import * as vscode from 'vscode';
import type {
    FocusTreeAssetStyleBatchHandler,
    FocusTreeAssetStylePatch,
    FocusTreeAssetStylePatchOptions,
    FocusTreeRenderBaseState,
} from './contentbuilder';
import {
    getFocusTreeAssetMaterialization,
    type FocusTreeRenderCache,
    type FocusTreeRenderPreparation,
} from './renderpayloadpatch';
import { FocusTreeStyleLedger } from './stylesync';
import { createEmptyFocusIconAssetResolution } from './focusicongfx';
import type { Focus } from './schema';
import { getDocumentByUri } from '../../util/vsccommon';
import { FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeAssetLoadMode, FocusTreeAssetScope, FocusTreeLoader } from './loader';
import { FocusTreeLoaderAdapter } from './loaderadapter';
import { FocusTreePatchPlanner } from './patchplanner';
import {
    beginFocusTreeRefresh,
    consumePendingReadyBaseState,
    consumePendingReadyBaseStatePromise,
    consumePendingLocalEditVersion,
    createFocusTreeRuntimeState,
    isCurrentFocusTreeRefresh,
    markFocusTreeWebviewReady,
    recordPendingLocalEditVersion,
    storePendingReadyBaseState,
    storePendingReadyBaseStatePromise,
    FocusTreeSnapshot,
    FocusTreeRuntimeState,
    resetFocusTreeRuntimeState,
} from './runtime';
import { FocusTreeSnapshotBuilder } from './snapshotbuilder';
import { debug } from '../../util/debug';
import { isPerfTraceEnabled, measureAsync, recordPerf } from '../../util/perf';
import { UserError } from '../../util/common';
import { isLocalisationIndexReady, whenLocalisationIndexReady } from '../../util/localisationIndex';
import { focusTreeProtocolVersion, toFocusTreeCatalogViews } from './viewmodel';
import { FocusTreeInvalidation } from './invalidation';
import {
    focusTreeAssetRequestLimits,
    getFocusTreeHostCommand,
    type FocusTreeAssetRequestMessage,
    type FocusTreeAssetStyleBatchMessage,
    type FocusTreeSceneAssetsMessage,
    type FocusTreeSceneAssetsStatus,
    type FocusTreeStyleSync,
    type FocusTreeStyleSyncMessage,
} from './webviewupdate';

export interface FocusTreeRefreshOptions {
    ignorePendingLocalEditDocumentVersion?: boolean;
    assetLoadMode?: FocusTreeAssetLoadMode;
    source?: FocusTreeRefreshSource;
    invalidation?: FocusTreeInvalidation;
    /**
     * The whole localisation index just became ready. Loaded states are re-rendered with it
     * instead of loaded again; edited localisation files do not set this.
     */
    localisationIndexBecameReady?: boolean;
}

type FocusTreeRefreshSource = 'document' | 'dependency' | 'hydration' | 'localEdit' | 'initialize' | 'webviewReady';

export interface FocusTreePreviewSessionOptions {
    uri: vscode.Uri;
    webview: vscode.Webview;
    focusTreeLoader: FocusTreeLoader;
    getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    updateDependencies: (dependencies: string[]) => void;
    getLatestDocument?: (uri: vscode.Uri) => vscode.TextDocument | undefined;
    runtimeState?: FocusTreeRuntimeState;
    snapshotBuilder?: FocusTreeSnapshotBuilderLike;
    deferredHydrationDelayMs?: number;
    isInitialFullLoadReady?: () => boolean;
}

export interface FocusTreeSnapshotBuilderLike {
    dispose?(): void;
    invalidate?(invalidation: FocusTreeInvalidation, options?: { reuseLoadedStates?: boolean }): void;
    setPriorityAssetKeys?(assetKeys: readonly string[]): void;
    renderShell(documentVersion: number): string;
    buildBaseState(document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred', isCancelled?: () => boolean, assetScope?: FocusTreeAssetScope): Promise<FocusTreeRenderBaseState>;
    createFullSnapshot(
        baseState: FocusTreeRenderBaseState,
        previousCache: FocusTreePreviewSession['runtimeState']['lastRenderCache'],
        isCancelled?: () => boolean,
        onAssetStyleBatch?: FocusTreeAssetStyleBatchHandler,
        prepared?: FocusTreeRenderPreparation,
        materializedFocusIds?: readonly string[],
        /** Rules of the loaded scenes a merged scene joins; its placeholders never replace them. */
        existingStyleRules?: ReadonlyMap<string, string>,
    ): Promise<FocusTreeSnapshot>;
    /** Decodes icon assets of focuses that the webview reveals after the scene was sent. */
    renderAssetPatch?(focuses: readonly Focus[], options: FocusTreeAssetStylePatchOptions): Promise<FocusTreeAssetStylePatch>;
}

/** Icon resolution of the loaded scenes for one document version, used by asset requests. */
interface FocusTreeAssetContext {
    documentVersion: number;
    /** Trees whose icon names the merged resolution covers. */
    treeIds: Set<string>;
    focusById: Record<string, Focus>;
    xGridSize: number;
    yGridSize: number;
    useNativeSize: boolean;
    gfxFileByIconName: Record<string, string>;
    unresolvedIconNames: Set<string>;
}

interface FocusTreeAssetRequest {
    assetRequestId: number;
    treeId: string;
    snapshotVersion: number;
    documentVersion: number;
    visibleFocusIds: string[];
    nearbyFocusIds: string[];
    styleResync: boolean;
}

/** Visible focus ids accepted from one first-paint acknowledgement. */
const maxAcknowledgedVisibleFocusIds = 512;

export class FocusTreePreviewSession {
    private static readonly defaultDeferredHydrationDelayMs = 1_000;
    private readonly uri: vscode.Uri;
    private readonly webview: vscode.Webview;
    private readonly getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    private readonly getLatestDocument: (uri: vscode.Uri) => vscode.TextDocument | undefined;
    private readonly snapshotBuilder: FocusTreeSnapshotBuilderLike;
    private readonly runtimeState: FocusTreeRuntimeState;
    private readonly deferredHydrationDelayMs: number;
    private readonly patchPlanner = new FocusTreePatchPlanner();
    private latestDocument: vscode.TextDocument | undefined;
    private readonly traceEvents: Array<Record<string, unknown>> = [];
    private deferredHydrationTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingDeferredHydration: {
        document: vscode.TextDocument;
        documentVersion: number;
        snapshotVersion: number;
    } | undefined;
    private pendingLocalisationRefreshDocumentVersion: number | undefined;
    /** Document whose localisation-ready refresh waits for in-flight hydration or refresh work. */
    private localisationRefreshAfterRenderWork: number | undefined;
    private preferredTreeId: string | undefined;
    private sceneRevision = 0;
    private disposed = false;
    /** On-screen focuses reported by the first paint; the next asset build decodes them first. */
    private pendingVisibleFocusIds: string[] = [];
    private firstScenePaintAcknowledged = false;
    private assetContext: FocusTreeAssetContext | undefined;
    /** Snapshot of the latest message that carried each materialized focus's asset rules. */
    private readonly materializedAtSnapshot = new Map<string, number>();
    private assetGeneration = 0;
    private queuedAssetRequest: FocusTreeAssetRequest | undefined;
    private assetWorkerRunning = false;
    /** Refreshes, hydrations, and scene requests in progress; asset requests wait for them. */
    private activeRenderWork = 0;
    /** Exactly the dynamic style rules posted to the webview's current document. */
    private readonly styleLedger = new FocusTreeStyleLedger();

    constructor(options: FocusTreePreviewSessionOptions) {
        this.uri = options.uri;
        this.webview = options.webview;
        this.getConditionPresetsByTree = options.getConditionPresetsByTree;
        this.getLatestDocument = options.getLatestDocument ?? getDocumentByUri;
        if (options.snapshotBuilder) {
            this.snapshotBuilder = options.snapshotBuilder;
        } else {
            const loaderAdapter = new FocusTreeLoaderAdapter({
                focusTreeLoader: options.focusTreeLoader,
                updateDependencies: options.updateDependencies,
            });
            this.snapshotBuilder = new FocusTreeSnapshotBuilder({
                uri: this.uri,
                webview: this.webview,
                loaderAdapter,
                getConditionPresetsByTree: this.getConditionPresetsByTree,
            });
        }
        this.runtimeState = options.runtimeState ?? createFocusTreeRuntimeState();
        this.deferredHydrationDelayMs = options.deferredHydrationDelayMs ?? FocusTreePreviewSession.defaultDeferredHydrationDelayMs;
    }

    public renderShell(documentVersion: number): string {
        this.runtimeState.lastRenderCache = undefined;
        // The shell is a new webview document with an empty dynamic stylesheet.
        this.styleLedger.clear();
        return this.snapshotBuilder.renderShell(documentVersion);
    }

    public getDebugState(): unknown {
        const cache = this.runtimeState.lastRenderCache;
        return {
            latestDocumentVersion: this.latestDocument?.version,
            webviewReady: this.runtimeState.webviewReady,
            latestRefreshRequestId: this.runtimeState.latestRefreshRequestId,
            assets: {
                deferred: cache?.deferredAssetLoad,
                materializedFocusCount: cache?.materializedFocusIds?.length,
                pendingVisibleFocusCount: this.pendingVisibleFocusIds.length,
                activeRenderWork: this.activeRenderWork,
                assetRequestQueued: this.queuedAssetRequest !== undefined,
                assetWorkerRunning: this.assetWorkerRunning,
                contextDocumentVersion: this.assetContext?.documentVersion,
            },
            style: this.styleLedger.state,
            traces: [...this.traceEvents],
        };
    }

    /**
     * Invalidates in-flight refreshes, hydration, scene and asset work when a refresh is scheduled,
     * including imported edits that keep the previewed document's version. Rendered caches and the
     * materialized asset set stay, so the following refresh reuses them. When the latest version
     * is a pending local edit, the scheduled refresh is skipped and its local-edit refresh is kept.
     */
    public cancelPendingRefresh(): void {
        if (this.disposed) {
            return;
        }

        const latestDocumentVersion = this.getLatestDocumentVersion();
        if (latestDocumentVersion !== undefined
            && this.runtimeState.pendingLocalEditDocumentVersions.has(latestDocumentVersion)) {
            return;
        }

        beginFocusTreeRefresh(this.runtimeState);
        this.cancelDeferredHydrationTimer();
        // A cancelled hydration of this version must be schedulable again by the next refresh.
        this.runtimeState.deferredHydrationDocumentVersion = undefined;
        storePendingReadyBaseState(this.runtimeState, undefined);
        storePendingReadyBaseStatePromise(this.runtimeState, undefined);
        this.cancelAssetWork();
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        beginFocusTreeRefresh(this.runtimeState);
        this.resetSessionState();
        this.runtimeState.pendingLocalEditDocumentVersions.clear();
        this.latestDocument = undefined;
        this.snapshotBuilder.dispose?.();
    }

    public async initializePanel(document: vscode.TextDocument): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.latestDocument = document;
        this.resetSessionState();
        this.webview.html = this.renderShell(document.version);
        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const initialAssetLoadMode: FocusTreeAssetLoadMode = 'deferred';
        this.trace('initializePanel', {
            requestId,
            documentVersion: document.version,
            htmlRefresh: 'shell-only',
            assetLoadMode: initialAssetLoadMode,
        });
        void this.trackRenderWork(() => this.safeRefreshWithSnapshot(document, requestId, document.version, initialAssetLoadMode, {
            source: 'initialize',
            allowDeferredHydration: initialAssetLoadMode === 'deferred',
        }));
    }

    public async refreshDocument(
        document: vscode.TextDocument,
        options?: FocusTreeRefreshOptions,
    ): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.latestDocument = document;
        if (!options?.ignorePendingLocalEditDocumentVersion
            && consumePendingLocalEditVersion(this.runtimeState, document.version)) {
            return;
        }

        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const requestDocumentVersion = document.version;
        const invalidation = options?.invalidation ?? FocusTreeInvalidation.All;
        this.snapshotBuilder.invalidate?.(invalidation, {
            reuseLoadedStates: options?.localisationIndexBecameReady === true && invalidation === FocusTreeInvalidation.Localisation,
        });
        if ((invalidation & (FocusTreeInvalidation.Layout | FocusTreeInvalidation.Presentation | FocusTreeInvalidation.Assets)) !== 0) {
            // Icon mappings or textures may have changed; asset requests wait for this refresh.
            this.assetContext = undefined;
        }
        const assetLoadMode = options?.assetLoadMode ?? this.resolveDefaultRefreshAssetLoadMode();
        this.trace('refreshDocument', {
            requestId,
            documentVersion: requestDocumentVersion,
            ignorePendingLocalEditDocumentVersion: !!options?.ignorePendingLocalEditDocumentVersion,
            assetLoadMode,
            source: options?.source ?? 'document',
            invalidation: options?.invalidation ?? FocusTreeInvalidation.All,
        });
        await this.trackRenderWork(() => this.safeRefreshWithSnapshot(document, requestId, requestDocumentVersion, assetLoadMode, {
            source: options?.source ?? 'document',
            allowDeferredHydration: assetLoadMode === 'deferred',
        }));
    }

    public handleWebviewReady(selectedTreeId?: string): void {
        if (this.disposed) {
            return;
        }

        markFocusTreeWebviewReady(this.runtimeState);
        // A ready webview is a new document: its first style sync must be a whole stylesheet.
        this.styleLedger.invalidateDelivery();
        this.preferredTreeId = selectedTreeId || this.preferredTreeId;
        this.trace('handleWebviewReady', {
            latestDocumentVersion: this.latestDocument?.version,
            latestRefreshRequestId: this.runtimeState.latestRefreshRequestId,
        });
        const latestDocument = this.latestDocument;
        if (!latestDocument) {
            return;
        }

        const pendingBaseState = consumePendingReadyBaseState(this.runtimeState, latestDocument.version);
        if (!pendingBaseState) {
            return;
        }

        void this.trackRenderWork(() => this.safeApplySnapshotUpdate(
            latestDocument,
            pendingBaseState,
            this.runtimeState.latestRefreshRequestId,
            latestDocument.version,
            pendingBaseState.deferredAssetLoad ? 'deferred' : 'full',
            {
                source: 'webviewReady',
                allowDeferredHydration: pendingBaseState.deferredAssetLoad,
            },
        ));
    }

    public async handleSceneRequest(treeId: string): Promise<void> {
        const cache = this.runtimeState.lastRenderCache;
        const tree = cache?.focusTrees.find(candidate => candidate.id === treeId);
        const document = this.latestDocument;
        if (this.disposed || !cache || !tree || !document || document.version !== cache.focusPositionDocumentVersion) {
            return;
        }

        await this.trackRenderWork(() => this.loadScene(treeId, cache, document));
    }

    /**
     * Sends a catalog scene. A tree without prepared assets gets its templates and placeholder icons;
     * the webview then requests the icons it shows, so a switch never decodes a whole tree.
     */
    private async loadScene(
        treeId: string,
        initialCache: FocusTreeRenderCache,
        document: vscode.TextDocument,
    ): Promise<void> {
        let cache = initialCache;
        let tree = cache.focusTrees.find(candidate => candidate.id === treeId);
        let builtBaseState: FocusTreeRenderBaseState | undefined;
        let sceneStyleRules: ReadonlyMap<string, string> | undefined;
        let sceneRawStyleCss: string | undefined;
        this.preferredTreeId = treeId;
        this.cancelDeferredHydrationTimer();
        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const isCancelled = this.createRefreshCancellationPredicate(requestId, document.version);
        if (cache.deferredAssetLoad || (cache.assetTreeIds && !cache.assetTreeIds.includes(treeId))) {
            try {
                const baseState = await this.snapshotBuilder.buildBaseState(document, 'full', isCancelled, {
                    treeId, treeIds: cache.deferredAssetLoad ? cache.assetTreeIds : undefined,
                });
                if (isCancelled()) { return; }
                // Focuses of different trees share icon rules by asset name. The new scene's
                // placeholders only fill names the webview's stylesheet lacks, so merging it never
                // turns an icon that a loaded scene materialized back into a placeholder.
                const snapshot = await this.snapshotBuilder.createFullSnapshot(
                    baseState,
                    cache,
                    isCancelled,
                    undefined,
                    undefined,
                    this.resolveMaterializedFocusIds(cache),
                    this.styleLedger.rules,
                );
                if (isCancelled()) { return; }
                const previousTrees = new Map(cache.focusTrees.map(value => [value.id, value]));
                sceneStyleRules = snapshot.cache.dynamicStyleRules;
                sceneRawStyleCss = snapshot.payload.dynamicStyleRawCss;
                cache = {
                    ...snapshot.cache,
                    focusTrees: snapshot.cache.focusTrees.map(value =>
                        snapshot.cache.assetTreeIds?.includes(value.id) ? value : previousTrees.get(value.id) ?? value),
                    assetTreeIds: Array.from(new Set([...(cache.assetTreeIds ?? []), ...(snapshot.cache.assetTreeIds ?? [treeId])])),
                    materializedFocusIds: mergeMaterializedFocusIds(cache, snapshot.cache),
                    focusTemplates: { ...cache.focusTemplates, ...snapshot.cache.focusTemplates },
                    focusTemplateKeyById: { ...cache.focusTemplateKeyById, ...snapshot.cache.focusTemplateKeyById },
                    focusRenderSignatures: { ...cache.focusRenderSignatures, ...snapshot.cache.focusRenderSignatures },
                    inlayRenderSignatures: { ...cache.inlayRenderSignatures, ...snapshot.cache.inlayRenderSignatures },
                    renderedInlayWindows: { ...cache.renderedInlayWindows, ...snapshot.cache.renderedInlayWindows },
                    dynamicStyleRules: cache.dynamicStyleRules,
                };
                builtBaseState = baseState;
                tree = cache.focusTrees.find(value => value.id === treeId);
                this.trace('sceneHydrated', { treeId, documentVersion: document.version, renderMetrics: snapshot.metrics });
            } catch (error) {
                if (error instanceof UserError || isCancelled()) { return; }
                throw error;
            }
        }
        if (isCancelled() || !tree) { return; }
        // Cached client-side switches send no host request. Keep those scenes selectable if
        // the user returns to one while this tree's hydration is still in flight.
        const loadedTreeIds = cache.assetTreeIds;
        const sceneTrees = loadedTreeIds ? cache.focusTrees.filter(value => loadedTreeIds.includes(value.id)) : [tree];
        const focusIds = new Set(sceneTrees.flatMap(value => Object.keys(value.focuses)));
        const inlayIds = new Set(sceneTrees.flatMap(value => value.inlayWindows.map(inlay => inlay.id)));
        // Commit before posting, with no await in between: a scene request arriving while this
        // scene is in transit builds on it instead of dropping a scene the webview has applied.
        // Only rules the webview's stylesheet lacks travel; it keeps every loaded scene's rules.
        const style = this.styleLedger.sync(sceneStyleRules ?? [], sceneRawStyleCss);
        cache.selectedTreeId = treeId;
        cache.dynamicStyleRules = this.styleLedger.rules;
        this.runtimeState.lastRenderCache = cache;
        if (builtBaseState) {
            this.captureAssetContext(builtBaseState, 'merge');
        }
        // The scene message replaces the webview's materialized set with every materialized focus.
        this.recordMaterializedSnapshot(cache, true);
        if (!cache.deferredAssetLoad) {
            this.pendingVisibleFocusIds = [];
        }
        await this.webview.postMessage({
            command: 'focusTreeScene',
            protocolVersion: focusTreeProtocolVersion,
            requestId,
            snapshotVersion: cache.snapshotVersion,
            documentVersion: cache.focusPositionDocumentVersion,
            sceneRevision: ++this.sceneRevision,
            treeId,
            sceneMode: 'merge',
            updateType: 'structure',
            selectedTreeId: treeId,
            catalog: toFocusTreeCatalogViews(cache.focusTrees),
            changedSlots: ['treeDefinitions', 'selector', 'warnings', 'treeBody', 'inlays', 'layout', 'styleDeps'],
            changedTreeIds: sceneTrees.map(value => value.id),
            structurallyChangedTreeIds: sceneTrees.map(value => value.id),
            changedFocusIds: [...focusIds],
            changedInlayWindowIds: [...inlayIds],
            focusTrees: sceneTrees,
            continuousFocusHtml: cache.continuousFocusHtml,
            ...pickFocusTemplates(cache.focusTemplates, cache.focusTemplateKeyById, focusIds),
            renderedInlayWindows: pickStringEntries(cache.renderedInlayWindows, inlayIds),
            gridBox: cache.gridBox,
            style,
            xGridSize: cache.xGridSize,
            yGridSize: cache.yGridSize,
            focusPositionActiveFile: cache.focusPositionActiveFile,
            assetMaterialization: getFocusTreeAssetMaterialization(cache),
        });
    }

    public handleContentApplied(
        snapshotVersion: number | undefined,
        documentVersion: number | undefined,
        stage: string | undefined,
        visibleFocusIds: readonly string[] = [],
        priorityAssetKeys: readonly string[] = [],
    ): void {
        if (this.disposed || stage !== 'firstScenePainted') {
            return;
        }

        this.firstScenePaintAcknowledged = true;
        if (documentVersion !== undefined && documentVersion === this.getLatestDocumentVersion()) {
            // The first asset build decodes exactly these on-screen focuses first; an in-flight
            // hydration picks them up when it renders its snapshot.
            this.pendingVisibleFocusIds = Array.from(new Set(
                (Array.isArray(visibleFocusIds) ? visibleFocusIds : [])
                    .filter((focusId): focusId is string => typeof focusId === 'string' && focusId.length > 0),
            )).slice(0, maxAcknowledgedVisibleFocusIds);
        }

        // A paint of an older structural snapshot of the same document still proves first paint.
        const pending = this.pendingDeferredHydration;
        if (!pending
            || snapshotVersion === undefined
            || snapshotVersion > pending.snapshotVersion
            || documentVersion !== pending.documentVersion) {
            return;
        }

        this.trace('deferredHydrationAcknowledged', {
            snapshotVersion,
            documentVersion,
            visibleFocusCount: this.pendingVisibleFocusIds.length,
            priorityAssetKeyCount: priorityAssetKeys.length,
        });
        this.snapshotBuilder.setPriorityAssetKeys?.(priorityAssetKeys);
        this.consumePendingDeferredHydration();
        void this.runDeferredHydration(pending.document, pending.documentVersion);
    }

    public reconcileAfterLocalEdit(updatedDocument: vscode.TextDocument | undefined): number | undefined {
        if (this.disposed || !updatedDocument) {
            return undefined;
        }

        this.latestDocument = updatedDocument;
        recordPendingLocalEditVersion(this.runtimeState, updatedDocument.version);
        void this.refreshDocument(updatedDocument, {
            ignorePendingLocalEditDocumentVersion: true,
            source: 'localEdit',
        });
        return updatedDocument.version;
    }

    public async reloadAfterStructuralEdit(updatedDocument: vscode.TextDocument | undefined): Promise<number | undefined> {
        if (this.disposed || !updatedDocument) {
            return undefined;
        }

        this.latestDocument = updatedDocument;
        recordPendingLocalEditVersion(this.runtimeState, updatedDocument.version);
        await this.refreshDocument(updatedDocument, {
            ignorePendingLocalEditDocumentVersion: true,
            assetLoadMode: 'full',
            source: 'localEdit',
        });
        return updatedDocument.version;
    }

    private async refreshWithSnapshot(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: FocusTreeRefreshSource;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.cancelDeferredHydrationTimer();
        storePendingReadyBaseStatePromise(this.runtimeState, undefined);
        const isCancelled = this.createRefreshCancellationPredicate(requestId, requestDocumentVersion);
        const baseState = await measureAsync('focustree.baseState', { mode: assetLoadMode, source: options.source }, () =>
            this.snapshotBuilder.buildBaseState(document, assetLoadMode, isCancelled, this.getRefreshAssetScope()));
        const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
        if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId)
            || (latestDocumentVersion !== undefined && latestDocumentVersion !== requestDocumentVersion)) {
            this.trace('refreshWithSnapshotSkipped', {
                requestId,
                requestDocumentVersion,
                latestDocumentVersion,
                assetLoadMode,
                staleRequest: !isCurrentFocusTreeRefresh(this.runtimeState, requestId),
            });
            return;
        }

        if (!this.runtimeState.webviewReady) {
            storePendingReadyBaseState(this.runtimeState, baseState);
            this.trace('refreshWithSnapshotPendingReady', {
                requestId,
                requestDocumentVersion,
                latestDocumentVersion,
                assetLoadMode,
                source: options.source,
            });
            return;
        }

        await this.applySnapshotUpdate(document, baseState, requestId, requestDocumentVersion, assetLoadMode, options);
    }

    private async safeRefreshWithSnapshot(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: FocusTreeRefreshSource;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        try {
            await this.refreshWithSnapshot(document, requestId, requestDocumentVersion, assetLoadMode, options);
        } catch (error) {
            if (!(error instanceof UserError)) {
                throw error;
            }

            this.trace('refreshWithSnapshotFailed', {
                requestId,
                requestDocumentVersion,
                latestDocumentVersion: this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version,
                assetLoadMode,
                source: options.source,
                message: error.message,
            });
        }
    }

    private async safeApplySnapshotUpdate(
        document: vscode.TextDocument,
        baseState: FocusTreeRenderBaseState,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: FocusTreeRefreshSource;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        try {
            await this.applySnapshotUpdate(
                document,
                baseState,
                requestId,
                requestDocumentVersion,
                assetLoadMode,
                options,
            );
        } catch (error) {
            if (!(error instanceof UserError)) {
                throw error;
            }

            this.trace('applySnapshotUpdateFailed', {
                requestId,
                requestDocumentVersion,
                assetLoadMode,
                source: options.source,
                message: error.message,
            });
        }
    }

    private async applySnapshotUpdate(
        document: vscode.TextDocument,
        baseState: FocusTreeRenderBaseState,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: FocusTreeRefreshSource;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        if (this.disposed) {
            return;
        }

        const isCancelled = this.createRefreshCancellationPredicate(requestId, requestDocumentVersion);
        const patchPlanStart = Date.now();
        const patchPlan = await this.patchPlanner.plan(this.runtimeState.lastRenderCache, baseState, isCancelled);
        const patchPlanDurationMs = Date.now() - patchPlanStart;
        recordPerf('focustree.patchPlan', patchPlanDurationMs, {
            source: options.source,
            mode: assetLoadMode,
            kind: patchPlan.kind,
            focusCount: baseState.allFocuses.length,
            inlayCount: baseState.allInlays.length,
        });
        const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
        if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId)
            || (latestDocumentVersion !== undefined && latestDocumentVersion !== requestDocumentVersion)) {
            this.trace('applySnapshotUpdateSkipped', {
                requestId,
                requestDocumentVersion,
                latestDocumentVersion,
                assetLoadMode,
                source: options.source,
                staleRequest: !isCurrentFocusTreeRefresh(this.runtimeState, requestId),
            });
            return;
        }

        let update: FocusTreeSnapshot['update'] | undefined;
        let cache: FocusTreeSnapshot['cache'] | undefined;
        let snapshotMetrics: FocusTreeSnapshot['metrics'] | undefined;
        let snapshotBuildDurationMs = 0;
        let fullStyleRules: ReadonlyMap<string, string> | undefined;
        let fullRawStyleCss: string | undefined;
        if (patchPlan.kind === 'full') {
            const snapshotBuildStart = Date.now();
            const onAssetStyleBatch: FocusTreeAssetStyleBatchHandler | undefined = baseState.deferredAssetLoad
                ? undefined
                : async batch => {
                    if (isCancelled()) {
                        return;
                    }
                    // Streamed icons are delivered once; the build's own update skips them.
                    const style = this.styleLedger.sync(batch.rules);
                    const committedCache = this.runtimeState.lastRenderCache;
                    if (committedCache) {
                        committedCache.dynamicStyleRules = this.styleLedger.rules;
                    }
                    if (!style) {
                        return;
                    }
                    const message: FocusTreeAssetStyleBatchMessage = {
                        command: 'focusTreeAssetBatch',
                        protocolVersion: focusTreeProtocolVersion,
                        batchKind: 'style',
                        requestId,
                        batchIndex: batch.batchIndex,
                        style,
                    };
                    await this.webview.postMessage(message);
                };
            const snapshot = await this.snapshotBuilder.createFullSnapshot(
                baseState,
                this.runtimeState.lastRenderCache,
                isCancelled,
                onAssetStyleBatch,
                patchPlan.prepared,
                this.resolveMaterializedFocusIds(this.runtimeState.lastRenderCache),
            );
            snapshotBuildDurationMs = Date.now() - snapshotBuildStart;
            recordPerf('focustree.snapshotBuild', snapshotBuildDurationMs, { source: options.source, mode: assetLoadMode });
            const snapshotLatestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
            if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId)
                || (snapshotLatestDocumentVersion !== undefined && snapshotLatestDocumentVersion !== requestDocumentVersion)) {
                this.trace('applySnapshotUpdateSkipped', {
                    requestId,
                    requestDocumentVersion,
                    latestDocumentVersion: snapshotLatestDocumentVersion,
                    assetLoadMode,
                    source: options.source,
                    staleRequest: !isCurrentFocusTreeRefresh(this.runtimeState, requestId),
                    duringSnapshotBuild: true,
                });
                return;
            }

            update = snapshot.update;
            cache = snapshot.cache;
            snapshotMetrics = snapshot.metrics;
            fullStyleRules = snapshot.payload.dynamicStyleRules ?? snapshot.cache.dynamicStyleRules;
            fullRawStyleCss = snapshot.payload.dynamicStyleRawCss;
        } else {
            update = patchPlan.update;
            cache = patchPlan.cache;
        }

        if (!update || !cache) {
            return;
        }

        if (isCancelled()) {
            return;
        }

        // From here to the post nothing awaits, so the ledger records exactly what is posted. A
        // full build states every rule of its scenes; only those the webview lacks travel.
        const style = this.styleLedger.sync(fullStyleRules ?? cache.dynamicStyleRules ?? [], fullRawStyleCss);
        const command = getFocusTreeHostCommand(update.updateType);
        const updateMessage: FocusTreeSnapshot['update'] & {
            command: 'focusTreeScene' | 'focusTreeAssetBatch' | 'focusTreeScenePatch';
            protocolVersion: typeof focusTreeProtocolVersion;
            requestId: number;
            sceneRevision: number;
            treeId: string;
        } = {
            command,
            protocolVersion: focusTreeProtocolVersion,
            requestId,
            sceneRevision: ++this.sceneRevision,
            treeId: update.selectedTreeId ?? update.focusTrees?.[0]?.id ?? '',
            ...update,
        };
        if (command === 'focusTreeScene' && updateMessage.focusTrees) {
            updateMessage.catalog = toFocusTreeCatalogViews(updateMessage.focusTrees);
            const allFocusTrees = updateMessage.focusTrees;
            const selectedTree = allFocusTrees.find(tree => tree.id === this.preferredTreeId)
                ?? allFocusTrees.find(tree => tree.id === updateMessage.selectedTreeId)
                ?? allFocusTrees[0];
            if (selectedTree) {
                const sceneTrees = baseState.assetTreeIds
                    ? allFocusTrees.filter(tree => baseState.assetTreeIds!.includes(tree.id))
                    : [selectedTree];
                const focusIds = new Set(sceneTrees.flatMap(tree => Object.keys(tree.focuses)));
                const inlayIds = new Set(sceneTrees.flatMap(tree => tree.inlayWindows.map(inlay => inlay.id)));
                updateMessage.sceneMode = 'replace';
                updateMessage.treeId = selectedTree.id;
                updateMessage.selectedTreeId = selectedTree.id;
                updateMessage.focusTrees = sceneTrees;
                updateMessage.changedTreeIds = sceneTrees.map(tree => tree.id);
                updateMessage.structurallyChangedTreeIds = sceneTrees.map(tree => tree.id);
                updateMessage.changedFocusIds = updateMessage.changedFocusIds?.filter(id => focusIds.has(id));
                updateMessage.changedInlayWindowIds = updateMessage.changedInlayWindowIds?.filter(id => inlayIds.has(id));
                if (updateMessage.focusTemplates && updateMessage.focusTemplateKeyById) {
                    Object.assign(updateMessage, pickFocusTemplates(
                        updateMessage.focusTemplates,
                        updateMessage.focusTemplateKeyById,
                        focusIds,
                    ));
                }
                if (updateMessage.renderedInlayWindows) {
                    updateMessage.renderedInlayWindows = pickStringEntries(updateMessage.renderedInlayWindows, inlayIds);
                }
            }
        }
        if (patchPlan.kind === 'full' && !updateMessage.assetMaterialization) {
            updateMessage.assetMaterialization = getFocusTreeAssetMaterialization(cache);
        }
        if (style) {
            updateMessage.style = style;
        }
        const payloadBytes = isPerfTraceEnabled() ? getApproximateJsonByteLength(updateMessage) : 0;
        updateMessage.perf = {
            source: options.source,
            assetLoadMode,
            updateKind: patchPlan.kind,
            changedSlotCount: update.changedSlots.length,
            payloadBytes,
            patchPlanDurationMs,
            snapshotBuildDurationMs,
            focusCount: snapshotMetrics?.focusCount ?? baseState.allFocuses.length,
            inlayCount: snapshotMetrics?.inlayCount ?? baseState.allInlays.length,
            deferredAssetLoad: baseState.deferredAssetLoad,
            renderedFocusCount: snapshotMetrics?.renderedFocusCount,
            renderedInlayCount: snapshotMetrics?.renderedInlayCount,
            materializedFocusCount: snapshotMetrics?.materializedFocusCount,
        };
        try {
            const postMessageStart = Date.now();
            await this.webview.postMessage(updateMessage);
            recordPerf('focustree.postMessage', Date.now() - postMessageStart, {
                source: options.source,
                kind: patchPlan.kind,
                changedSlotCount: update.changedSlots.length,
                mode: assetLoadMode,
                payloadBytes,
            });
        } catch (error) {
            recordPerf('focustree.postMessage', 0, { source: options.source, kind: patchPlan.kind }, false, error);
            const message = error instanceof Error ? error.message : String(error);
            if (message.toLowerCase().includes('disposed')) {
                this.trace('applySnapshotUpdate', {
                    requestId,
                    requestDocumentVersion,
                    latestDocumentVersion,
                    assetLoadMode,
                    source: options.source,
                    disposedSkip: true,
                });
                return;
            }

            throw error;
        }

        if (isCancelled()) {
            // The webview has these rules although the update is not committed.
            const committedCache = this.runtimeState.lastRenderCache;
            if (committedCache) {
                committedCache.dynamicStyleRules = this.styleLedger.rules;
            }
            return;
        }

        cache.dynamicStyleRules = this.styleLedger.rules;
        this.runtimeState.lastRenderCache = cache;
        if (!cache.deferredAssetLoad && !baseState.deferredAssetLoad) {
            // The refresh covered every loaded scene, so its icon resolution replaces the context.
            this.captureAssetContext(baseState, 'replace');
            this.recordMaterializedSnapshot(cache, patchPlan.kind === 'full');
            if (patchPlan.kind === 'full') {
                this.pendingVisibleFocusIds = [];
            }
        }
        this.trace('applySnapshotUpdate', {
            requestId,
            requestDocumentVersion,
            latestDocumentVersion,
            assetLoadMode,
            source: options.source,
            updateKind: patchPlan.kind,
            changedSlots: update.changedSlots,
            patchPlanDurationMs,
            snapshotBuildDurationMs,
            payloadBytes,
            renderMetrics: snapshotMetrics,
            changedTreeCount: patchPlan.kind === 'partial' ? patchPlan.changedTreeCount : update.changedTreeIds?.length,
            changedFocusCount: patchPlan.kind === 'partial' ? patchPlan.changedFocusCount : update.changedFocusIds?.length,
            changedInlayCount: patchPlan.kind === 'partial' ? patchPlan.changedInlayCount : update.changedInlayWindowIds?.length,
            disposedSkip: false,
        });

        if (options.allowDeferredHydration
            && baseState.deferredAssetLoad
            && this.latestDocument?.version === requestDocumentVersion
            && this.runtimeState.deferredHydrationDocumentVersion !== requestDocumentVersion) {
            this.scheduleDeferredHydration(document, requestDocumentVersion);
            this.scheduleLocalisationReadyRefresh(document, requestDocumentVersion);
        } else if (!baseState.deferredAssetLoad) {
            this.runtimeState.deferredHydrationDocumentVersion = undefined;
        }
    }

    private scheduleLocalisationReadyRefresh(
        document: vscode.TextDocument,
        requestDocumentVersion: number,
    ): void {
        if (this.disposed
            || isLocalisationIndexReady()
            || this.pendingLocalisationRefreshDocumentVersion === requestDocumentVersion) {
            return;
        }

        this.pendingLocalisationRefreshDocumentVersion = requestDocumentVersion;
        this.trace('deferLocalisationReadyRefresh', {
            documentVersion: requestDocumentVersion,
        });

        void whenLocalisationIndexReady({ showStatusBar: false }).then(() => {
            if (this.disposed || this.pendingLocalisationRefreshDocumentVersion !== requestDocumentVersion) {
                return;
            }

            this.pendingLocalisationRefreshDocumentVersion = undefined;
            if (this.activeRenderWork > 0 || this.pendingDeferredHydration) {
                // Cancelling a hydration or refresh of this document would repeat its whole load.
                // It resolves names with the ready index when it renders; refresh afterwards only
                // if the scene it produced was still built without the index.
                this.localisationRefreshAfterRenderWork = requestDocumentVersion;
                this.trace('localisationReadyRefreshDeferred', {
                    documentVersion: requestDocumentVersion,
                    activeRenderWork: this.activeRenderWork,
                });
                return;
            }
            this.runLocalisationReadyRefresh(requestDocumentVersion);
        }, error => {
            this.pendingLocalisationRefreshDocumentVersion = undefined;
            this.trace('localisationReadyRefreshFailed', {
                documentVersion: requestDocumentVersion,
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }

    /** Applies the ready localisation index to the shown scene unless it already uses it. */
    private runLocalisationReadyRefresh(documentVersion: number): void {
        if (this.disposed) {
            return;
        }

        const latestDocument = this.getLatestDocument(this.uri) ?? this.latestDocument;
        const latestDocumentVersion = latestDocument?.version;
        if (!latestDocument || latestDocumentVersion !== documentVersion) {
            this.trace('localisationReadyRefreshSkipped', {
                documentVersion,
                latestDocumentVersion,
            });
            return;
        }

        const cache = this.runtimeState.lastRenderCache;
        if (cache
            && !cache.deferredAssetLoad
            && cache.focusPositionDocumentVersion === documentVersion
            && cache.localisationIndexReady) {
            this.trace('localisationReadyRefreshSkipped', {
                documentVersion,
                latestDocumentVersion,
                alreadyLocalised: true,
            });
            return;
        }

        this.trace('localisationReadyRefresh', {
            documentVersion,
        });
        void this.refreshDocument(latestDocument, {
            assetLoadMode: 'full',
            source: 'dependency',
            invalidation: FocusTreeInvalidation.Localisation,
            localisationIndexBecameReady: true,
        });
    }

    /** Runs a localisation refresh that waited for in-flight render work of its document. */
    private flushDeferredLocalisationRefresh(): void {
        const documentVersion = this.localisationRefreshAfterRenderWork;
        if (documentVersion === undefined || this.disposed || this.activeRenderWork > 0 || this.pendingDeferredHydration) {
            return;
        }

        this.localisationRefreshAfterRenderWork = undefined;
        this.runLocalisationReadyRefresh(documentVersion);
    }

    private scheduleDeferredHydration(
        document: vscode.TextDocument,
        requestDocumentVersion: number,
    ): void {
        if (this.disposed) {
            return;
        }

        this.cancelDeferredHydrationTimer();
        this.runtimeState.deferredHydrationDocumentVersion = requestDocumentVersion;
        this.pendingDeferredHydration = {
            document,
            documentVersion: requestDocumentVersion,
            snapshotVersion: this.runtimeState.lastRenderCache?.snapshotVersion ?? 0,
        };
        // The webview acknowledges only its first paint. A hydration rescheduled after a cancelled
        // or superseded one must not wait for an acknowledgement that never comes again.
        const delayMs = this.firstScenePaintAcknowledged ? 0 : this.deferredHydrationDelayMs;
        this.trace('deferHydration', {
            documentVersion: requestDocumentVersion,
            delayMs,
        });

        this.deferredHydrationTimer = setTimeout(() => {
            const pending = this.pendingDeferredHydration;
            this.consumePendingDeferredHydration();
            if (this.disposed || !pending) {
                return;
            }

            const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
            if (latestDocumentVersion !== requestDocumentVersion) {
                this.trace('deferredHydrationSkipped', {
                    documentVersion: requestDocumentVersion,
                    latestDocumentVersion,
                });
                return;
            }

            void this.runDeferredHydration(pending.document, pending.documentVersion);
        }, delayMs);
        this.deferredHydrationTimer.unref?.();
    }

    private async runDeferredHydration(
        document: vscode.TextDocument,
        requestDocumentVersion: number,
    ): Promise<void> {
        if (this.disposed) {
            return;
        }

        await this.trackRenderWork(() => this.hydrateDeferredScene(document, requestDocumentVersion));
    }

    /** Decodes the selected scene's assets, starting with the on-screen focuses of the first paint. */
    private async hydrateDeferredScene(
        document: vscode.TextDocument,
        requestDocumentVersion: number,
    ): Promise<void> {
        const hydrationRequestId = beginFocusTreeRefresh(this.runtimeState);
        const pendingBaseStatePromise = consumePendingReadyBaseStatePromise(this.runtimeState, requestDocumentVersion);
        this.trace('scheduleDeferredHydration', {
            requestId: hydrationRequestId,
            documentVersion: requestDocumentVersion,
            strategy: pendingBaseStatePromise ? 'preloaded-refresh' : 'scheduled-refresh',
        });

        try {
            const isCancelled = this.createRefreshCancellationPredicate(hydrationRequestId, requestDocumentVersion);
            const baseState = pendingBaseStatePromise
                ? await pendingBaseStatePromise
                : await measureAsync('focustree.baseState', { mode: 'full', source: 'hydration' }, () =>
                    this.snapshotBuilder.buildBaseState(document, 'full', isCancelled, this.getRefreshAssetScope()));
            await this.applySnapshotUpdate(
                document,
                baseState,
                hydrationRequestId,
                requestDocumentVersion,
                'full',
                {
                    source: 'hydration',
                    allowDeferredHydration: false,
                },
            );
        } catch (error) {
            this.trace('deferredHydrationFailed', {
                requestId: hydrationRequestId,
                documentVersion: requestDocumentVersion,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private getRefreshAssetScope(): FocusTreeAssetScope {
        const cache = this.runtimeState.lastRenderCache;
        return { treeId: this.preferredTreeId, treeIds: cache?.deferredAssetLoad ? undefined : cache?.assetTreeIds };
    }

    private createRefreshCancellationPredicate(
        requestId: number,
        requestDocumentVersion: number,
    ): () => boolean {
        return () => {
            const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
            return this.disposed
                || !isCurrentFocusTreeRefresh(this.runtimeState, requestId)
                || (latestDocumentVersion !== undefined && latestDocumentVersion !== requestDocumentVersion);
        };
    }

    private resetSessionState(): void {
        this.cancelDeferredHydrationTimer();
        this.pendingLocalisationRefreshDocumentVersion = undefined;
        this.localisationRefreshAfterRenderWork = undefined;
        this.sceneRevision = 0;
        this.pendingVisibleFocusIds = [];
        this.firstScenePaintAcknowledged = false;
        this.assetContext = undefined;
        this.materializedAtSnapshot.clear();
        this.cancelAssetWork();
        this.styleLedger.clear();
        resetFocusTreeRuntimeState(this.runtimeState);
    }

    private getLatestDocumentVersion(): number | undefined {
        return this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
    }

    /** Runs a refresh, hydration, or scene request; queued asset requests run once none is active. */
    private async trackRenderWork<T>(work: () => Promise<T>): Promise<T> {
        this.activeRenderWork += 1;
        try {
            return await work();
        } finally {
            this.activeRenderWork -= 1;
            if (this.activeRenderWork === 0) {
                // A deferred localisation refresh starts first, so asset requests wait for it.
                this.flushDeferredLocalisationRefresh();
                this.drainAssetRequests();
            }
        }
    }

    /**
     * Focuses whose icons the next full build decodes: the first paint's on-screen focuses first,
     * then every focus the previous scene had materialized. The builder drops ids outside its trees.
     */
    private resolveMaterializedFocusIds(previousCache: FocusTreeRenderCache | undefined): string[] {
        const carried = previousCache && !previousCache.deferredAssetLoad
            ? previousCache.materializedFocusIds ?? getAssetTreeFocusIds(previousCache)
            : [];
        return Array.from(new Set([...this.pendingVisibleFocusIds, ...carried]));
    }

    private captureAssetContext(baseState: FocusTreeRenderBaseState, mode: 'replace' | 'merge'): void {
        if (baseState.deferredAssetLoad) {
            return;
        }

        const resolution = baseState.focusIconAssetResolution ?? createEmptyFocusIconAssetResolution();
        const previous = mode === 'merge' && this.assetContext?.documentVersion === baseState.focusPositionDocumentVersion
            ? this.assetContext
            : undefined;
        const gfxFileByIconName = { ...previous?.gfxFileByIconName, ...resolution.gfxFileByIconName };
        const unresolvedIconNames = new Set([...previous?.unresolvedIconNames ?? [], ...resolution.unresolvedIconNames]);
        Object.keys(resolution.gfxFileByIconName).forEach(iconName => unresolvedIconNames.delete(iconName));
        const treeIds = new Set(previous?.treeIds ?? []);
        (baseState.assetTreeIds ?? baseState.focusTrees.map(tree => tree.id)).forEach(treeId => treeIds.add(treeId));
        this.assetContext = {
            documentVersion: baseState.focusPositionDocumentVersion,
            treeIds,
            focusById: baseState.focusById,
            xGridSize: baseState.xGridSize,
            yGridSize: baseState.yGridSize,
            useNativeSize: !!baseState.presentation?.item,
            gfxFileByIconName,
            unresolvedIconNames,
        };
    }

    /**
     * Records the snapshot that carried each materialized focus's rules. `replacedAll` marks
     * messages whose stylesheet contained every materialized rule.
     */
    private recordMaterializedSnapshot(cache: FocusTreeRenderCache, replacedAll: boolean): void {
        const materialized = new Set(cache.materializedFocusIds ?? []);
        for (const focusId of Array.from(this.materializedAtSnapshot.keys())) {
            if (!materialized.has(focusId)) {
                this.materializedAtSnapshot.delete(focusId);
            }
        }
        if (replacedAll) {
            materialized.forEach(focusId => this.materializedAtSnapshot.set(focusId, cache.snapshotVersion));
        }
    }

    private cancelAssetWork(): void {
        this.assetGeneration += 1;
        this.queuedAssetRequest = undefined;
    }

    /**
     * Queues a webview request for icon assets of focuses it shows with placeholders. Only the
     * newest request waits; it starts when no refresh, hydration, or scene request is running.
     */
    public async handleAssetRequest(request: Partial<FocusTreeAssetRequestMessage>): Promise<void> {
        if (this.disposed) {
            return;
        }

        const normalized = normalizeFocusTreeAssetRequest(request);
        if (!normalized) {
            return;
        }

        if (normalized.styleResync) {
            // Posted ahead of any queued patch, so later deltas build on this whole stylesheet.
            await this.postStyleResync();
            if (normalized.visibleFocusIds.length === 0 && normalized.nearbyFocusIds.length === 0) {
                return;
            }
        }
        this.queuedAssetRequest = normalized;
        this.drainAssetRequests();
    }

    /** Sends every recorded rule to a webview whose stylesheet missed a delta. */
    private async postStyleResync(): Promise<void> {
        if (this.disposed || !this.runtimeState.webviewReady) {
            return;
        }
        const message: FocusTreeStyleSyncMessage = {
            command: 'focusTreeStyleSync',
            protocolVersion: focusTreeProtocolVersion,
            style: this.styleLedger.resync(),
        };
        this.trace('styleResync', { version: message.style.version });
        try {
            await this.webview.postMessage(message);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            if (!text.toLowerCase().includes('disposed')) {
                throw error;
            }
        }
    }

    private drainAssetRequests(): void {
        if (this.assetWorkerRunning || this.disposed || this.activeRenderWork > 0 || !this.queuedAssetRequest) {
            return;
        }

        this.assetWorkerRunning = true;
        void (async () => {
            try {
                while (!this.disposed && this.activeRenderWork === 0 && this.queuedAssetRequest) {
                    const request = this.queuedAssetRequest;
                    this.queuedAssetRequest = undefined;
                    try {
                        await this.processAssetRequest(request);
                    } catch (error) {
                        this.trace('assetRequestFailed', {
                            assetRequestId: request.assetRequestId,
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            } finally {
                this.assetWorkerRunning = false;
            }
        })();
    }

    private async processAssetRequest(request: FocusTreeAssetRequest): Promise<void> {
        const startedAt = Date.now();
        const generation = this.assetGeneration;
        const refreshRequestId = this.runtimeState.latestRefreshRequestId;
        const cache = this.runtimeState.lastRenderCache;
        const document = this.getLatestDocument(this.uri) ?? this.latestDocument;
        const tree = cache?.focusTrees.find(candidate => candidate.id === request.treeId);
        const renderAssetPatch = this.snapshotBuilder.renderAssetPatch?.bind(this.snapshotBuilder);
        const staleReason = !cache || !tree ? 'scene'
            : cache.deferredAssetLoad ? 'deferred'
            : !this.runtimeState.webviewReady ? 'webview'
            : !document
                || request.documentVersion !== cache.focusPositionDocumentVersion
                || document.version !== cache.focusPositionDocumentVersion ? 'document'
            : cache.assetTreeIds && !cache.assetTreeIds.includes(request.treeId) ? 'tree'
            : !renderAssetPatch ? 'renderer'
            : undefined;
        if (staleReason || !cache || !tree || !document || !renderAssetPatch) {
            this.trace('assetRequestStale', { assetRequestId: request.assetRequestId, treeId: request.treeId, reason: staleReason });
            await this.postSceneAssets(request, cache, 'stale', true);
            return;
        }

        if (!cache.materializedFocusIds) {
            // Every focus of the loaded scenes is already real.
            await this.postSceneAssets(request, cache, 'empty', true);
            return;
        }

        let expectedCache = cache;
        const isCancelled = () => this.disposed
            || this.assetGeneration !== generation
            || this.activeRenderWork > 0
            || this.runtimeState.latestRefreshRequestId !== refreshRequestId
            || this.runtimeState.lastRenderCache !== expectedCache
            || this.getLatestDocumentVersion() !== expectedCache.focusPositionDocumentVersion;
        let ensuredContext: FocusTreeAssetContext | undefined;
        try {
            ensuredContext = await this.ensureAssetContext(document, cache, request.treeId, isCancelled);
        } catch (error) {
            if (isCancelled()) {
                return;
            }
            this.trace('assetRequestFailed', {
                assetRequestId: request.assetRequestId,
                message: error instanceof Error ? error.message : String(error),
            });
            await this.postSceneAssets(request, cache, 'failed', true);
            return;
        }
        if (isCancelled()) {
            return;
        }
        if (!ensuredContext) {
            this.trace('assetRequestStale', { assetRequestId: request.assetRequestId, treeId: request.treeId, reason: 'context' });
            await this.postSceneAssets(request, cache, 'stale', true);
            return;
        }

        const context = ensuredContext;
        this.preferredTreeId = request.treeId;
        const materialized = new Set(cache.materializedFocusIds);
        const planned = new Set<string>();
        const resend = new Set<string>();
        const plan = (focusIds: readonly string[]) => focusIds.filter(focusId => {
            if (planned.has(focusId) || !tree.focuses[focusId] || !context.focusById[focusId]) {
                return false;
            }
            if (materialized.has(focusId)) {
                // The webview asks again only when a message it saw should have marked the focus
                // loaded; it is marked again, and its rules travel only if the webview lacks them.
                if (request.snapshotVersion < (this.materializedAtSnapshot.get(focusId) ?? 0)) {
                    return false;
                }
                resend.add(focusId);
            }
            planned.add(focusId);
            return true;
        });
        const chunks = [
            ...chunkFocusIds(plan(request.visibleFocusIds), 'visible'),
            ...chunkFocusIds(plan(request.nearbyFocusIds), 'nearby'),
        ];
        if (chunks.length === 0) {
            await this.postSceneAssets(request, cache, 'empty', true);
            return;
        }

        const resolution = {
            ...createEmptyFocusIconAssetResolution(),
            gfxFileByIconName: context.gfxFileByIconName,
            unresolvedIconNames: Array.from(context.unresolvedIconNames),
        };
        let appliedChunks = 0;
        let status: FocusTreeSceneAssetsStatus | 'cancelled' | 'superseded' = 'applied';
        try {
            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index];
                if (isCancelled()) {
                    status = 'cancelled';
                    return;
                }
                if (chunk.tier === 'nearby' && this.queuedAssetRequest) {
                    // A newer request recomputes what is still needed around the new viewport.
                    status = 'superseded';
                    return;
                }

                const patch = await renderAssetPatch(chunk.focusIds.map(focusId => context.focusById[focusId]), {
                    focusIconAssetResolution: resolution,
                    xGridSize: context.xGridSize,
                    yGridSize: context.yGridSize,
                    useNativeSize: context.useNativeSize,
                    existingStyleRules: this.styleLedger.rules,
                    resendFocusIds: resend,
                    isCancelled,
                });
                if (isCancelled()) {
                    status = 'cancelled';
                    return;
                }

                // Commit before posting with no await in between, so a refresh that starts later
                // plans against the cache this patch produced.
                const base = expectedCache;
                const style = this.styleLedger.sync(patch.rules);
                const next: FocusTreeRenderCache = {
                    ...base,
                    snapshotVersion: base.snapshotVersion + 1,
                    materializedFocusIds: Array.from(new Set([...base.materializedFocusIds ?? [], ...chunk.focusIds])),
                    dynamicStyleRules: this.styleLedger.rules,
                };
                this.runtimeState.lastRenderCache = next;
                expectedCache = next;
                chunk.focusIds.forEach(focusId => this.materializedAtSnapshot.set(focusId, next.snapshotVersion));
                appliedChunks += 1;
                await this.postSceneAssets(request, next, 'applied', index === chunks.length - 1, {
                    baseSnapshotVersion: base.snapshotVersion,
                    tier: chunk.tier,
                    materializedFocusIds: chunk.focusIds,
                    style,
                });
            }
        } catch (error) {
            if (isCancelled()) {
                status = 'cancelled';
                return;
            }
            status = 'failed';
            this.trace('assetRequestFailed', {
                assetRequestId: request.assetRequestId,
                message: error instanceof Error ? error.message : String(error),
            });
            await this.postSceneAssets(request, this.runtimeState.lastRenderCache ?? expectedCache, 'failed', true);
        } finally {
            recordPerf('focustree.assetRequest', Date.now() - startedAt, {
                status,
                treeId: request.treeId,
                visibleCount: request.visibleFocusIds.length,
                nearbyCount: request.nearbyFocusIds.length,
                plannedCount: planned.size,
                resendCount: resend.size,
                appliedChunks,
            });
        }
    }

    /**
     * Icon resolution covering `treeId` for the cache's document. Refreshes keep it current; when
     * a cancelled refresh left none, it is rebuilt from the loader for every loaded scene.
     */
    private async ensureAssetContext(
        document: vscode.TextDocument,
        cache: FocusTreeRenderCache,
        treeId: string,
        isCancelled: () => boolean,
    ): Promise<FocusTreeAssetContext | undefined> {
        const current = this.assetContext;
        if (current && current.documentVersion === cache.focusPositionDocumentVersion && current.treeIds.has(treeId)) {
            return current;
        }

        try {
            const baseState = await this.snapshotBuilder.buildBaseState(document, 'full', isCancelled, {
                treeId,
                treeIds: cache.assetTreeIds,
            });
            if (isCancelled()
                || baseState.deferredAssetLoad
                || baseState.focusPositionDocumentVersion !== cache.focusPositionDocumentVersion) {
                return undefined;
            }
            this.captureAssetContext(baseState, 'merge');
        } catch (error) {
            if (error instanceof UserError || isCancelled()) {
                return undefined;
            }
            throw error;
        }
        const rebuilt = this.assetContext;
        return rebuilt?.documentVersion === cache.focusPositionDocumentVersion && rebuilt.treeIds.has(treeId)
            ? rebuilt
            : undefined;
    }

    private async postSceneAssets(
        request: FocusTreeAssetRequest,
        cache: FocusTreeRenderCache | undefined,
        status: FocusTreeSceneAssetsStatus,
        final: boolean,
        patch?: Pick<FocusTreeSceneAssetsMessage, 'baseSnapshotVersion' | 'tier' | 'materializedFocusIds'> & { style?: FocusTreeStyleSync },
    ): Promise<void> {
        if (this.disposed) {
            return;
        }

        const snapshotVersion = cache?.snapshotVersion ?? 0;
        const { style, ...patchFields } = patch ?? {};
        const message: FocusTreeSceneAssetsMessage = {
            command: 'focusTreeSceneAssets',
            protocolVersion: focusTreeProtocolVersion,
            requestId: this.runtimeState.latestRefreshRequestId,
            assetRequestId: request.assetRequestId,
            treeId: request.treeId,
            documentVersion: cache?.focusPositionDocumentVersion ?? request.documentVersion,
            baseSnapshotVersion: patch?.baseSnapshotVersion ?? snapshotVersion,
            snapshotVersion,
            status,
            final,
            ...patchFields,
            ...(style ? { style } : {}),
        };
        try {
            await this.webview.postMessage(message);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            if (!text.toLowerCase().includes('disposed')) {
                throw error;
            }
        }
    }

    private cancelDeferredHydrationTimer(): void {
        if (this.deferredHydrationTimer) {
            clearTimeout(this.deferredHydrationTimer);
            this.deferredHydrationTimer = undefined;
        }
        this.pendingDeferredHydration = undefined;
    }

    private consumePendingDeferredHydration(): void {
        if (this.deferredHydrationTimer) {
            clearTimeout(this.deferredHydrationTimer);
            this.deferredHydrationTimer = undefined;
        }
        this.pendingDeferredHydration = undefined;
    }

    private resolveDefaultRefreshAssetLoadMode(): FocusTreeAssetLoadMode {
        return this.runtimeState.lastRenderCache && !this.runtimeState.lastRenderCache.deferredAssetLoad
            ? 'full'
            : 'deferred';
    }

    private trace(event: string, data: Record<string, unknown>): void {
        const entry = {
            event,
            uri: this.uri.toString(),
            ...data,
        };
        this.traceEvents.push(entry);
        if (this.traceEvents.length > 20) {
            this.traceEvents.splice(0, this.traceEvents.length - 20);
        }

        if (process.env.HOI4MU_FOCUSTREE_TRACE === '1') {
            debug('focustree.session', entry);
        }
    }
}

function getApproximateJsonByteLength(value: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
        return 0;
    }
}

function pickStringEntries(source: Readonly<Record<string, string>>, keys: ReadonlySet<string>): Record<string, string> {
    return Object.fromEntries(Object.entries(source).filter(([key]) => keys.has(key)));
}

/** Template keys of the given focuses and only the templates they use. */
function pickFocusTemplates(
    templates: Readonly<Record<string, string>>,
    keyById: Readonly<Record<string, string>>,
    focusIds: ReadonlySet<string>,
): { focusTemplates: Record<string, string>; focusTemplateKeyById: Record<string, string> } {
    const focusTemplateKeyById = pickStringEntries(keyById, focusIds);
    return {
        focusTemplates: pickStringEntries(templates, new Set(Object.values(focusTemplateKeyById))),
        focusTemplateKeyById,
    };
}

/** Every focus of the cache's asset trees, the meaning of an undefined materialized set. */
function getAssetTreeFocusIds(cache: Pick<FocusTreeRenderCache, 'focusTrees' | 'assetTreeIds'>): string[] {
    const assetTreeIds = cache.assetTreeIds;
    return cache.focusTrees
        .filter(tree => !assetTreeIds || assetTreeIds.includes(tree.id))
        .flatMap(tree => Object.keys(tree.focuses));
}

/** Materialized focuses after merging a newly loaded scene into the loaded ones. */
function mergeMaterializedFocusIds(previous: FocusTreeRenderCache, next: FocusTreeRenderCache): string[] | undefined {
    if (!previous.deferredAssetLoad && !next.deferredAssetLoad
        && previous.materializedFocusIds === undefined && next.materializedFocusIds === undefined) {
        return undefined;
    }
    const previousIds = previous.deferredAssetLoad ? [] : previous.materializedFocusIds ?? getAssetTreeFocusIds(previous);
    const nextIds = next.deferredAssetLoad ? [] : next.materializedFocusIds ?? getAssetTreeFocusIds(next);
    return Array.from(new Set([...previousIds, ...nextIds]));
}

function chunkFocusIds(focusIds: readonly string[], tier: 'visible' | 'nearby'): Array<{ tier: 'visible' | 'nearby'; focusIds: string[] }> {
    const chunks: Array<{ tier: 'visible' | 'nearby'; focusIds: string[] }> = [];
    for (let start = 0; start < focusIds.length; start += focusTreeAssetRequestLimits.chunk) {
        chunks.push({ tier, focusIds: focusIds.slice(start, start + focusTreeAssetRequestLimits.chunk) });
    }
    return chunks;
}

function normalizeFocusIdList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const result = new Set<string>();
    for (const item of value) {
        if (result.size >= limit) {
            break;
        }
        if (typeof item === 'string' && item.length > 0) {
            result.add(item);
        }
    }
    return Array.from(result);
}

/** Validates an untrusted webview request and bounds its size. */
export function normalizeFocusTreeAssetRequest(request: Partial<FocusTreeAssetRequestMessage> | undefined): FocusTreeAssetRequest | undefined {
    if (!request
        || typeof request.treeId !== 'string'
        || typeof request.assetRequestId !== 'number'
        || typeof request.documentVersion !== 'number'
        || typeof request.snapshotVersion !== 'number') {
        return undefined;
    }
    const visibleFocusIds = normalizeFocusIdList(request.visibleFocusIds, focusTreeAssetRequestLimits.visible);
    const visible = new Set(visibleFocusIds);
    return {
        assetRequestId: request.assetRequestId,
        treeId: request.treeId,
        documentVersion: request.documentVersion,
        snapshotVersion: request.snapshotVersion,
        visibleFocusIds,
        nearbyFocusIds: normalizeFocusIdList(request.nearbyFocusIds, focusTreeAssetRequestLimits.nearby)
            .filter(focusId => !visible.has(focusId)),
        styleResync: request.styleResync === true,
    };
}
