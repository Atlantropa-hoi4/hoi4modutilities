import * as vscode from 'vscode';
import { FocusTreeRenderBaseState } from './contentbuilder';
import { getDocumentByUri } from '../../util/vsccommon';
import { FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeAssetLoadMode, FocusTreeLoader } from './loader';
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
import { measureAsync, recordPerf } from '../../util/perf';
import { UserError } from '../../util/common';
import { isLocalisationIndexReady, whenLocalisationIndexReady } from '../../util/localisationIndex';
import { isLocalisationIndexEnabled } from '../../util/featureflags';

export interface FocusTreeRefreshOptions {
    ignorePendingLocalEditDocumentVersion?: boolean;
    assetLoadMode?: FocusTreeAssetLoadMode;
    source?: FocusTreeRefreshSource;
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
}

export interface FocusTreeSnapshotBuilderLike {
    renderShell(documentVersion: number): string;
    renderDocument(document: vscode.TextDocument): Promise<string>;
    buildBaseState(document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred', isCancelled?: () => boolean): Promise<FocusTreeRenderBaseState>;
    createFullSnapshot(baseState: FocusTreeRenderBaseState, previousCache: FocusTreePreviewSession['runtimeState']['lastRenderCache']): Promise<FocusTreeSnapshot>;
}

export class FocusTreePreviewSession {
    private static readonly defaultDeferredHydrationDelayMs = 250;
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
    private pendingLocalisationRefreshDocumentVersion: number | undefined;

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
        return this.snapshotBuilder.renderShell(documentVersion);
    }

    public getDebugState(): unknown {
        return {
            latestDocumentVersion: this.latestDocument?.version,
            webviewReady: this.runtimeState.webviewReady,
            latestRefreshRequestId: this.runtimeState.latestRefreshRequestId,
            traces: [...this.traceEvents],
        };
    }

    public async initializePanel(document: vscode.TextDocument): Promise<void> {
        this.latestDocument = document;
        this.resetSessionState();
        this.webview.html = this.renderShell(document.version);
        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const initialAssetLoadMode: FocusTreeAssetLoadMode = isLocalisationIndexEnabled() && isLocalisationIndexReady()
            ? 'full'
            : 'deferred';
        this.trace('initializePanel', {
            requestId,
            documentVersion: document.version,
            htmlRefresh: 'shell-only',
            assetLoadMode: initialAssetLoadMode,
        });
        void this.safeRefreshWithSnapshot(document, requestId, document.version, initialAssetLoadMode, {
            source: 'initialize',
            allowDeferredHydration: initialAssetLoadMode === 'deferred',
        });
    }

    public async refreshDocument(
        document: vscode.TextDocument,
        options?: FocusTreeRefreshOptions,
    ): Promise<void> {
        this.latestDocument = document;
        if (!options?.ignorePendingLocalEditDocumentVersion
            && consumePendingLocalEditVersion(this.runtimeState, document.version)) {
            return;
        }

        const requestId = beginFocusTreeRefresh(this.runtimeState);
        const requestDocumentVersion = document.version;
        const assetLoadMode = options?.assetLoadMode ?? 'deferred';
        this.trace('refreshDocument', {
            requestId,
            documentVersion: requestDocumentVersion,
            ignorePendingLocalEditDocumentVersion: !!options?.ignorePendingLocalEditDocumentVersion,
            assetLoadMode,
            source: options?.source ?? 'document',
        });
        await this.safeRefreshWithSnapshot(document, requestId, requestDocumentVersion, assetLoadMode, {
            source: options?.source ?? 'document',
            allowDeferredHydration: assetLoadMode === 'deferred',
        });
    }

    public handleWebviewReady(): void {
        markFocusTreeWebviewReady(this.runtimeState);
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

        void this.applySnapshotUpdate(
            latestDocument,
            pendingBaseState,
            this.runtimeState.latestRefreshRequestId,
            latestDocument.version,
            pendingBaseState.deferredAssetLoad ? 'deferred' : 'full',
            {
                source: 'webviewReady',
                allowDeferredHydration: pendingBaseState.deferredAssetLoad,
            },
        );
    }

    public reconcileAfterLocalEdit(updatedDocument: vscode.TextDocument | undefined): number | undefined {
        if (!updatedDocument) {
            return undefined;
        }

        this.latestDocument = updatedDocument;
        recordPendingLocalEditVersion(this.runtimeState, updatedDocument.version);
        void this.refreshDocument(updatedDocument, {
            ignorePendingLocalEditDocumentVersion: true,
            assetLoadMode: 'deferred',
            source: 'localEdit',
        });
        return updatedDocument.version;
    }

    public async reloadAfterStructuralEdit(updatedDocument: vscode.TextDocument | undefined): Promise<number | undefined> {
        if (!updatedDocument) {
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
        this.cancelDeferredHydrationTimer();
        storePendingReadyBaseStatePromise(this.runtimeState, undefined);
        const isCancelled = this.createRefreshCancellationPredicate(requestId, requestDocumentVersion);
        const baseState = await measureAsync('focustree.baseState', { mode: assetLoadMode, source: options.source }, () =>
            this.snapshotBuilder.buildBaseState(document, assetLoadMode, isCancelled));
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
        const patchPlanStart = Date.now();
        const patchPlan = await this.patchPlanner.plan(this.runtimeState.lastRenderCache, baseState);
        const patchPlanDurationMs = Date.now() - patchPlanStart;
        recordPerf('focustree.patchPlan', patchPlanDurationMs, { source: options.source, mode: assetLoadMode, kind: patchPlan.kind });
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
        if (patchPlan.kind === 'full') {
            const snapshotBuildStart = Date.now();
            const snapshot = await this.snapshotBuilder.createFullSnapshot(baseState, this.runtimeState.lastRenderCache);
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
        } else {
            update = patchPlan.update;
            cache = patchPlan.cache;
        }

        if (!update || !cache) {
            return;
        }

        try {
            const postMessageStart = Date.now();
            await this.webview.postMessage({
                command: 'focusTreeContentUpdated',
                ...update,
            });
            recordPerf('focustree.postMessage', Date.now() - postMessageStart, {
                source: options.source,
                kind: patchPlan.kind,
                changedSlotCount: update.changedSlots.length,
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

        this.runtimeState.lastRenderCache = cache;
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
        if (isLocalisationIndexReady() || this.pendingLocalisationRefreshDocumentVersion === requestDocumentVersion) {
            return;
        }

        this.pendingLocalisationRefreshDocumentVersion = requestDocumentVersion;
        this.trace('deferLocalisationReadyRefresh', {
            documentVersion: requestDocumentVersion,
        });

        void whenLocalisationIndexReady({ showStatusBar: false }).then(() => {
            if (this.pendingLocalisationRefreshDocumentVersion !== requestDocumentVersion) {
                return;
            }

            this.pendingLocalisationRefreshDocumentVersion = undefined;
            const latestDocument = this.getLatestDocument(this.uri) ?? this.latestDocument;
            const latestDocumentVersion = latestDocument?.version;
            if (!latestDocument || latestDocumentVersion !== requestDocumentVersion) {
                this.trace('localisationReadyRefreshSkipped', {
                    documentVersion: requestDocumentVersion,
                    latestDocumentVersion,
                });
                return;
            }

            this.trace('localisationReadyRefresh', {
                documentVersion: requestDocumentVersion,
            });
            void this.refreshDocument(latestDocument, {
                assetLoadMode: 'full',
                source: 'dependency',
            });
        }, error => {
            this.pendingLocalisationRefreshDocumentVersion = undefined;
            this.trace('localisationReadyRefreshFailed', {
                documentVersion: requestDocumentVersion,
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }

    private scheduleDeferredHydration(
        document: vscode.TextDocument,
        requestDocumentVersion: number,
    ): void {
        this.cancelDeferredHydrationTimer();
        this.runtimeState.deferredHydrationDocumentVersion = requestDocumentVersion;
        this.trace('deferHydration', {
            documentVersion: requestDocumentVersion,
            delayMs: this.deferredHydrationDelayMs,
        });

        this.deferredHydrationTimer = setTimeout(() => {
            this.deferredHydrationTimer = undefined;
            const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
            if (latestDocumentVersion !== requestDocumentVersion) {
                this.trace('deferredHydrationSkipped', {
                    documentVersion: requestDocumentVersion,
                    latestDocumentVersion,
                });
                return;
            }

            void this.runDeferredHydration(document, requestDocumentVersion);
        }, this.deferredHydrationDelayMs);
        this.deferredHydrationTimer.unref?.();
    }

    private async runDeferredHydration(
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
                    this.snapshotBuilder.buildBaseState(document, 'full', isCancelled));
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

    private createRefreshCancellationPredicate(
        requestId: number,
        requestDocumentVersion: number,
    ): () => boolean {
        return () => {
            const latestDocumentVersion = this.getLatestDocument(this.uri)?.version ?? this.latestDocument?.version;
            return !isCurrentFocusTreeRefresh(this.runtimeState, requestId)
                || (latestDocumentVersion !== undefined && latestDocumentVersion !== requestDocumentVersion);
        };
    }

    private resetSessionState(): void {
        this.cancelDeferredHydrationTimer();
        this.pendingLocalisationRefreshDocumentVersion = undefined;
        resetFocusTreeRuntimeState(this.runtimeState);
    }

    private cancelDeferredHydrationTimer(): void {
        if (!this.deferredHydrationTimer) {
            return;
        }

        clearTimeout(this.deferredHydrationTimer);
        this.deferredHydrationTimer = undefined;
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
