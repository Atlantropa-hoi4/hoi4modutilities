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
    consumePendingLocalEditVersion,
    createFocusTreeRuntimeState,
    isCurrentFocusTreeRefresh,
    markFocusTreeWebviewReady,
    recordPendingLocalEditVersion,
    storePendingReadyBaseState,
    FocusTreeSnapshot,
    FocusTreeRuntimeState,
    resetFocusTreeRuntimeState,
} from './runtime';
import { FocusTreeSnapshotBuilder } from './snapshotbuilder';
import { debug } from '../../util/debug';

export interface FocusTreeRefreshOptions {
    ignorePendingLocalEditDocumentVersion?: boolean;
    assetLoadMode?: FocusTreeAssetLoadMode;
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
}

export interface FocusTreeSnapshotBuilderLike {
    renderShell(documentVersion: number): string;
    renderDocument(document: vscode.TextDocument): Promise<string>;
    buildBaseState(document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred'): Promise<FocusTreeRenderBaseState>;
    createFullSnapshot(baseState: FocusTreeRenderBaseState, previousCache: FocusTreePreviewSession['runtimeState']['lastRenderCache']): Promise<FocusTreeSnapshot>;
}

export class FocusTreePreviewSession {
    private readonly uri: vscode.Uri;
    private readonly webview: vscode.Webview;
    private readonly getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    private readonly getLatestDocument: (uri: vscode.Uri) => vscode.TextDocument | undefined;
    private readonly snapshotBuilder: FocusTreeSnapshotBuilderLike;
    private readonly runtimeState: FocusTreeRuntimeState;
    private readonly patchPlanner = new FocusTreePatchPlanner();
    private latestDocument: vscode.TextDocument | undefined;
    private readonly traceEvents: Array<Record<string, unknown>> = [];

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
        this.trace('initializePanel', {
            requestId,
            documentVersion: document.version,
            htmlRefresh: 'shell-only',
        });
        void this.refreshWithSnapshot(document, requestId, document.version, 'deferred', {
            source: 'initializePanel',
            allowDeferredHydration: true,
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
        const assetLoadMode = options?.assetLoadMode ?? 'full';
        this.trace('refreshDocument', {
            requestId,
            documentVersion: requestDocumentVersion,
            ignorePendingLocalEditDocumentVersion: !!options?.ignorePendingLocalEditDocumentVersion,
            assetLoadMode,
        });
        await this.refreshWithSnapshot(document, requestId, requestDocumentVersion, assetLoadMode, {
            source: 'refreshDocument',
            allowDeferredHydration: false,
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
                source: 'handleWebviewReady',
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
            assetLoadMode: 'full',
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
        });
        return updatedDocument.version;
    }

    private async refreshWithSnapshot(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: string;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        const baseState = await this.snapshotBuilder.buildBaseState(document, assetLoadMode);
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

    private async applySnapshotUpdate(
        document: vscode.TextDocument,
        baseState: FocusTreeRenderBaseState,
        requestId: number,
        requestDocumentVersion: number,
        assetLoadMode: FocusTreeAssetLoadMode,
        options: {
            source: string;
            allowDeferredHydration: boolean;
        },
    ): Promise<void> {
        const patchPlan = await this.patchPlanner.plan(this.runtimeState.lastRenderCache, baseState);
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
        if (patchPlan.kind === 'full') {
            const snapshot = await this.snapshotBuilder.createFullSnapshot(baseState, this.runtimeState.lastRenderCache);
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
        } else {
            update = patchPlan.update;
            cache = patchPlan.cache;
        }

        if (!update || !cache) {
            return;
        }

        try {
            await this.webview.postMessage({
                command: 'focusTreeContentUpdated',
                ...update,
            });
        } catch (error) {
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
            disposedSkip: false,
        });

        if (options.allowDeferredHydration
            && baseState.deferredAssetLoad
            && this.latestDocument?.version === requestDocumentVersion
            && this.runtimeState.deferredHydrationDocumentVersion !== requestDocumentVersion) {
            this.runtimeState.deferredHydrationDocumentVersion = requestDocumentVersion;
            const hydrationRequestId = beginFocusTreeRefresh(this.runtimeState);
            this.trace('scheduleDeferredHydration', {
                requestId: hydrationRequestId,
                documentVersion: requestDocumentVersion,
            });
            void this.refreshWithSnapshot(document, hydrationRequestId, requestDocumentVersion, 'full', {
                source: 'deferredHydration',
                allowDeferredHydration: false,
            });
        } else if (!baseState.deferredAssetLoad) {
            this.runtimeState.deferredHydrationDocumentVersion = undefined;
        }
    }

    private resetSessionState(): void {
        resetFocusTreeRuntimeState(this.runtimeState);
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
