import * as vscode from 'vscode';
import { FocusTreeRenderBaseState } from './contentbuilder';
import { debug, error } from '../../util/debug';
import { getDocumentByUri } from '../../util/vsccommon';
import { FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeAssetLoadMode, FocusTreeLoader } from './loader';
import { FocusTreeLoaderAdapter } from './loaderadapter';
import { FocusTreePatchPlanner } from './patchplanner';
import {
    beginFocusTreeRefresh,
    clearFocusTreeWebviewReady,
    consumePendingLocalEditVersion,
    consumePendingReadyBaseState,
    consumePendingReadyBaseStatePromise,
    createFocusTreeRuntimeState,
    isCurrentFocusTreeRefresh,
    markFocusTreeWebviewReady,
    recordPendingLocalEditVersion,
    resetFocusTreeRuntimeState,
    storePendingReadyBaseState,
    storePendingReadyBaseStatePromise,
    FocusTreeRuntimeState,
    FocusTreeSnapshot,
    FocusTreePatchPlan,
} from './runtime';
import { FocusTreeSnapshotBuilder } from './snapshotbuilder';

export interface FocusTreeRefreshOptions {
    ignorePendingLocalEditDocumentVersion?: boolean;
    forceFullAssetLoad?: boolean;
    forceFullSnapshot?: boolean;
}

export interface FocusTreePreviewSessionOptions {
    uri: vscode.Uri;
    webview: vscode.Webview;
    focusTreeLoader: FocusTreeLoader;
    getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    updateDependencies: (dependencies: string[]) => void;
    getLatestDocument?: (uri: vscode.Uri) => vscode.TextDocument | undefined;
    runtimeState?: FocusTreeRuntimeState;
    snapshotBuilder?: FocusTreeSnapshotBuilderLike;
    patchPlanner?: FocusTreePatchPlannerLike;
}

export interface FocusTreeSnapshotBuilderLike {
    renderShell(documentVersion: number): string;
    renderDocument(document: vscode.TextDocument): Promise<string>;
    buildBaseState(document: vscode.TextDocument, assetLoadMode: FocusTreeAssetLoadMode): Promise<FocusTreeRenderBaseState>;
    createFullSnapshot(baseState: FocusTreeRenderBaseState, previousCache: FocusTreePreviewSession['runtimeState']['lastRenderCache']): Promise<FocusTreeSnapshot>;
}

export interface FocusTreePatchPlannerLike {
    plan(previousCache: FocusTreePreviewSession['runtimeState']['lastRenderCache'], baseState: FocusTreeRenderBaseState): Promise<FocusTreePatchPlan>;
}

export class FocusTreePreviewSession {
    private readonly uri: vscode.Uri;
    private readonly webview: vscode.Webview;
    private readonly getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    private readonly getLatestDocument: (uri: vscode.Uri) => vscode.TextDocument | undefined;
    private readonly loaderAdapter: FocusTreeLoaderAdapter;
    private readonly snapshotBuilder: FocusTreeSnapshotBuilderLike;
    private readonly patchPlanner: FocusTreePatchPlannerLike;
    private readonly runtimeState: FocusTreeRuntimeState;

    constructor(options: FocusTreePreviewSessionOptions) {
        this.uri = options.uri;
        this.webview = options.webview;
        this.getConditionPresetsByTree = options.getConditionPresetsByTree;
        this.getLatestDocument = options.getLatestDocument ?? getDocumentByUri;
        this.loaderAdapter = new FocusTreeLoaderAdapter({
            focusTreeLoader: options.focusTreeLoader,
            updateDependencies: options.updateDependencies,
        });
        this.snapshotBuilder = options.snapshotBuilder ?? new FocusTreeSnapshotBuilder({
            uri: this.uri,
            webview: this.webview,
            loaderAdapter: this.loaderAdapter,
            getConditionPresetsByTree: this.getConditionPresetsByTree,
        });
        this.patchPlanner = options.patchPlanner ?? new FocusTreePatchPlanner();
        this.runtimeState = options.runtimeState ?? createFocusTreeRuntimeState();
    }

    public renderShell(documentVersion: number): string {
        this.runtimeState.lastRenderCache = undefined;
        return this.snapshotBuilder.renderShell(documentVersion);
    }

    public initializePanel(document: vscode.TextDocument): void {
        this.resetSessionState();
        this.webview.html = this.renderShell(document.version);
        this.primeDeferredInitialBaseState(document);
    }

    public async refreshDocument(
        document: vscode.TextDocument,
        options?: FocusTreeRefreshOptions,
    ): Promise<void> {
        if (!options?.ignorePendingLocalEditDocumentVersion
            && consumePendingLocalEditVersion(this.runtimeState, document.version)) {
            return;
        }

        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const requestDocumentVersion = document.version;
        const refreshStartedAt = Date.now();
        try {
            const baseState = await this.resolveBaseState(document, requestId, options);
            if (!baseState) {
                return;
            }

            if (!this.runtimeState.webviewReady) {
                storePendingReadyBaseState(this.runtimeState, baseState);
                await this.replaceWithShell(document, requestId, requestDocumentVersion);
                return;
            }

            const diffStartedAt = Date.now();
            const updatePlan = options?.forceFullSnapshot
                ? { kind: 'full' as const }
                : await this.patchPlanner.plan(this.runtimeState.lastRenderCache, baseState);
            const diffDurationMs = Date.now() - diffStartedAt;

            if (updatePlan.kind === 'full') {
                await this.postFullSnapshot(baseState, diffDurationMs, refreshStartedAt);
            } else {
                await this.postPartialSnapshot(updatePlan, baseState, diffDurationMs, refreshStartedAt);
            }

            if (baseState.deferredAssetLoad && !options?.forceFullAssetLoad) {
                this.scheduleDeferredHydrationRefresh(document);
            }
        } catch (e) {
            error(e);
            this.resetSessionState();
            const content = this.renderShell(document.version);
            if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId) || document.version !== requestDocumentVersion) {
                return;
            }

            this.webview.html = content;
        }
    }

    public handleWebviewReady(): void {
        markFocusTreeWebviewReady(this.runtimeState);
        const document = this.getLatestDocument(this.uri);
        if (document) {
            void this.refreshDocument(document);
        }
    }

    public reconcileAfterLocalEdit(updatedDocument: vscode.TextDocument | undefined): number | undefined {
        if (!updatedDocument) {
            return undefined;
        }

        recordPendingLocalEditVersion(this.runtimeState, updatedDocument.version);
        void this.refreshDocument(updatedDocument, {
            ignorePendingLocalEditDocumentVersion: true,
            forceFullAssetLoad: true,
            forceFullSnapshot: true,
        });
        return updatedDocument.version;
    }

    public async reloadAfterStructuralEdit(updatedDocument: vscode.TextDocument | undefined): Promise<number | undefined> {
        if (!updatedDocument) {
            return undefined;
        }

        recordPendingLocalEditVersion(this.runtimeState, updatedDocument.version);
        const requestId = beginFocusTreeRefresh(this.runtimeState);
        this.resetSessionState();

        const content = await this.snapshotBuilder.renderDocument(updatedDocument);

        const latestDocumentVersion = this.getLatestDocument(this.uri)?.version;
        if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId) || latestDocumentVersion !== updatedDocument.version) {
            return updatedDocument.version;
        }

        this.webview.html = content;
        return updatedDocument.version;
    }

    private async resolveBaseState(
        document: vscode.TextDocument,
        requestId: number,
        options?: FocusTreeRefreshOptions,
    ): Promise<FocusTreeRenderBaseState | undefined> {
        const cachedBaseState = !options?.forceFullAssetLoad && this.runtimeState.webviewReady
            ? consumePendingReadyBaseState(this.runtimeState, document.version)
            : undefined;
        if (cachedBaseState) {
            return cachedBaseState;
        }

        const pendingBaseStatePromise = !options?.forceFullAssetLoad && this.runtimeState.webviewReady
            ? consumePendingReadyBaseStatePromise(this.runtimeState, document.version)
            : undefined;
        if (pendingBaseStatePromise) {
            const baseState = await pendingBaseStatePromise;
            if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId)) {
                return undefined;
            }

            return baseState;
        }

        const assetLoadMode: FocusTreeAssetLoadMode = options?.forceFullAssetLoad
            ? 'full'
            : this.runtimeState.webviewReady ? 'full' : 'deferred';
        const baseState = await this.snapshotBuilder.buildBaseState(document, assetLoadMode);
        if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId)) {
            return undefined;
        }

        return baseState;
    }

    private async postFullSnapshot(
        baseState: FocusTreeRenderBaseState,
        diffDurationMs: number,
        refreshStartedAt: number,
    ): Promise<void> {
        const htmlBuildStartedAt = Date.now();
        const snapshot = await this.snapshotBuilder.createFullSnapshot(baseState, this.runtimeState.lastRenderCache);
        this.runtimeState.lastRenderCache = snapshot.cache;

        const postMessageStartedAt = Date.now();
        await this.webview.postMessage({
            command: 'focusTreeContentUpdated',
            ...snapshot.update,
        });

        debug('[focustree] refresh timings', {
            documentVersion: snapshot.payload.focusPositionDocumentVersion,
            snapshotVersion: snapshot.update.snapshotVersion,
            loadMs: baseState.loadDurationMs,
            diffMs: diffDurationMs,
            htmlBuildMs: Date.now() - htmlBuildStartedAt,
            focusRenderMs: snapshot.metrics.focusRenderDurationMs,
            inlayRenderMs: snapshot.metrics.inlayRenderDurationMs,
            postMessageMs: Date.now() - postMessageStartedAt,
            changedSlots: snapshot.update.changedSlots,
            deferredAssetLoad: baseState.deferredAssetLoad,
            totalMs: Date.now() - refreshStartedAt,
        });
    }

    private async postPartialSnapshot(
        updatePlan: Exclude<Awaited<ReturnType<FocusTreePatchPlanner['plan']>>, { kind: 'full' }>,
        baseState: FocusTreeRenderBaseState,
        diffDurationMs: number,
        refreshStartedAt: number,
    ): Promise<void> {
        if (!updatePlan.update || !updatePlan.cache) {
            throw new Error('Partial focustree patch plan requires update and cache.');
        }

        this.runtimeState.lastRenderCache = updatePlan.cache;
        const update = updatePlan.update;

        const postMessageStartedAt = Date.now();
        await this.webview.postMessage({
            command: 'focusTreeContentUpdated',
            ...update,
        });

        debug('[focustree] refresh timings', {
            documentVersion: update.documentVersion,
            snapshotVersion: update.snapshotVersion,
            loadMs: baseState.loadDurationMs,
            diffMs: diffDurationMs,
            changedTreeCount: updatePlan.changedTreeCount,
            changedFocusCount: updatePlan.changedFocusCount,
            changedInlayCount: updatePlan.changedInlayCount,
            changedSlots: update.changedSlots,
            deferredAssetLoad: baseState.deferredAssetLoad,
            postMessageMs: Date.now() - postMessageStartedAt,
            totalMs: Date.now() - refreshStartedAt,
        });
    }

    private primeDeferredInitialBaseState(document: vscode.TextDocument): void {
        const promise = this.snapshotBuilder.buildBaseState(document, 'deferred')
            .then(baseState => {
            if (document.version === baseState.focusPositionDocumentVersion) {
                storePendingReadyBaseState(this.runtimeState, baseState);
            }
            return baseState;
        }).catch(e => {
            error(e);
            throw e;
        });

        storePendingReadyBaseStatePromise(this.runtimeState, {
            documentVersion: document.version,
            promise,
        });
    }

    private scheduleDeferredHydrationRefresh(document: vscode.TextDocument): void {
        if (this.runtimeState.deferredHydrationDocumentVersion === document.version) {
            return;
        }

        this.runtimeState.deferredHydrationDocumentVersion = document.version;
        setTimeout(() => {
            void (async () => {
                try {
                    const latestDocument = this.getLatestDocument(this.uri);
                    if (!latestDocument || latestDocument.version !== document.version) {
                        return;
                    }

                    await this.refreshDocument(latestDocument, { forceFullAssetLoad: true });
                } finally {
                    if (this.runtimeState.deferredHydrationDocumentVersion === document.version) {
                        this.runtimeState.deferredHydrationDocumentVersion = undefined;
                    }
                }
            })();
        }, 0);
    }

    private async replaceWithShell(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
    ): Promise<void> {
        clearFocusTreeWebviewReady(this.runtimeState);
        this.runtimeState.lastRenderCache = undefined;
        const content = this.renderShell(document.version);
        if (!isCurrentFocusTreeRefresh(this.runtimeState, requestId) || document.version !== requestDocumentVersion) {
            return;
        }

        this.webview.html = content;
    }

    private resetSessionState(): void {
        resetFocusTreeRuntimeState(this.runtimeState);
    }
}
