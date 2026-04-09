import * as vscode from 'vscode';
import {
    buildFocusTreeRenderBaseState,
    buildFocusTreeRenderPayloadFromBaseState,
    FocusTreeRenderBaseState,
    renderFocusTreeFile,
    renderFocusTreeShellHtml,
} from './contentbuilder';
import { debug, error } from '../../util/debug';
import { getDocumentByUri } from '../../util/vsccommon';
import { FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeAssetLoadMode, FocusTreeLoader } from './loader';
import {
    createFocusTreeRenderUpdate,
    createFullFocusTreeRenderUpdate,
    FocusTreeRenderCache,
} from './renderpayloadpatch';

export interface FocusTreeRefreshOptions {
    ignorePendingLocalEditDocumentVersion?: boolean;
    forceFullAssetLoad?: boolean;
    forceFullSnapshot?: boolean;
}

interface PendingBaseStatePromise {
    documentVersion: number;
    promise: Promise<FocusTreeRenderBaseState>;
}

export interface FocusTreePreviewSessionOptions {
    uri: vscode.Uri;
    webview: vscode.Webview;
    focusTreeLoader: FocusTreeLoader;
    getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    updateDependencies: (dependencies: string[]) => void;
}

export class FocusTreePreviewSession {
    private readonly uri: vscode.Uri;
    private readonly webview: vscode.Webview;
    private readonly focusTreeLoader: FocusTreeLoader;
    private readonly getConditionPresetsByTree: () => FocusConditionPresetsByTree;
    private readonly updateDependencies: (dependencies: string[]) => void;

    private pendingLocalEditDocumentVersions = new Set<number>();
    private webviewReady = false;
    private latestRefreshRequestId = 0;
    private lastRenderCache: FocusTreeRenderCache | undefined;
    private pendingReadyBaseState: FocusTreeRenderBaseState | undefined;
    private pendingReadyBaseStatePromise: PendingBaseStatePromise | undefined;
    private deferredHydrationDocumentVersion: number | undefined;

    constructor(options: FocusTreePreviewSessionOptions) {
        this.uri = options.uri;
        this.webview = options.webview;
        this.focusTreeLoader = options.focusTreeLoader;
        this.getConditionPresetsByTree = options.getConditionPresetsByTree;
        this.updateDependencies = options.updateDependencies;
    }

    public renderShell(documentVersion: number): string {
        this.lastRenderCache = undefined;
        return renderFocusTreeShellHtml(
            this.uri,
            this.webview,
            documentVersion,
            this.getConditionPresetsByTree(),
        );
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
        if (!options?.ignorePendingLocalEditDocumentVersion && this.pendingLocalEditDocumentVersions.delete(document.version)) {
            return;
        }

        const requestId = this.startRefreshRequest();
        const requestDocumentVersion = document.version;
        const refreshStartedAt = Date.now();
        try {
            const baseState = await this.resolveBaseState(document, requestId, options);
            if (!baseState) {
                return;
            }

            if (!this.webviewReady) {
                this.pendingReadyBaseState = baseState;
                await this.replaceWithShell(document, requestId, requestDocumentVersion);
                return;
            }

            const diffStartedAt = Date.now();
            const updatePlan = options?.forceFullSnapshot
                ? { kind: 'full' as const }
                : await createFocusTreeRenderUpdate(this.lastRenderCache, baseState);
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
            if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
                return;
            }

            this.webview.html = content;
        }
    }

    public handleWebviewReady(): void {
        this.webviewReady = true;
        const document = getDocumentByUri(this.uri);
        if (document) {
            void this.refreshDocument(document);
        }
    }

    public reconcileAfterLocalEdit(updatedDocument: vscode.TextDocument | undefined): number | undefined {
        if (!updatedDocument) {
            return undefined;
        }

        this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
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

        this.pendingLocalEditDocumentVersions.add(updatedDocument.version);
        const requestId = this.startRefreshRequest();
        this.resetSessionState();

        const loader = this.createSnapshotLoader(updatedDocument.getText(), 'full');
        const content = await renderFocusTreeFile(
            loader,
            updatedDocument.uri,
            this.webview,
            updatedDocument.version,
            this.getConditionPresetsByTree(),
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);

        const latestDocumentVersion = getDocumentByUri(this.uri)?.version;
        if (!this.isRefreshRequestCurrent(requestId) || latestDocumentVersion !== updatedDocument.version) {
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
        const cachedBaseState = !options?.forceFullAssetLoad && this.webviewReady
            && this.pendingReadyBaseState?.focusPositionDocumentVersion === document.version
            ? this.pendingReadyBaseState
            : undefined;
        if (cachedBaseState) {
            this.pendingReadyBaseState = undefined;
            return cachedBaseState;
        }

        const pendingBaseStatePromise = !options?.forceFullAssetLoad && this.webviewReady
            && this.pendingReadyBaseStatePromise?.documentVersion === document.version
            ? this.pendingReadyBaseStatePromise.promise
            : undefined;
        if (pendingBaseStatePromise) {
            const baseState = await pendingBaseStatePromise;
            if (!this.isRefreshRequestCurrent(requestId)) {
                return undefined;
            }

            this.pendingReadyBaseStatePromise = undefined;
            return baseState;
        }

        const assetLoadMode: FocusTreeAssetLoadMode = options?.forceFullAssetLoad
            ? 'full'
            : this.webviewReady ? 'full' : 'deferred';
        const loader = this.createSnapshotLoader(document.getText(), assetLoadMode);
        const baseState = await buildFocusTreeRenderBaseState(
            loader,
            document.version,
            this.getConditionPresetsByTree(),
        );
        this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
        if (!this.isRefreshRequestCurrent(requestId)) {
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
        const { payload, metrics } = await buildFocusTreeRenderPayloadFromBaseState(baseState);
        const { update, cache } = createFullFocusTreeRenderUpdate(payload, this.lastRenderCache);
        this.lastRenderCache = cache;

        const postMessageStartedAt = Date.now();
        await this.webview.postMessage({
            command: 'focusTreeContentUpdated',
            ...update,
        });

        debug('[focustree] refresh timings', {
            documentVersion: payload.focusPositionDocumentVersion,
            snapshotVersion: update.snapshotVersion,
            loadMs: baseState.loadDurationMs,
            diffMs: diffDurationMs,
            htmlBuildMs: Date.now() - htmlBuildStartedAt,
            focusRenderMs: metrics.focusRenderDurationMs,
            inlayRenderMs: metrics.inlayRenderDurationMs,
            postMessageMs: Date.now() - postMessageStartedAt,
            changedSlots: update.changedSlots,
            deferredAssetLoad: baseState.deferredAssetLoad,
            totalMs: Date.now() - refreshStartedAt,
        });
    }

    private async postPartialSnapshot(
        updatePlan: Exclude<Awaited<ReturnType<typeof createFocusTreeRenderUpdate>>, { kind: 'full' }>,
        baseState: FocusTreeRenderBaseState,
        diffDurationMs: number,
        refreshStartedAt: number,
    ): Promise<void> {
        this.lastRenderCache = updatePlan.cache;

        const postMessageStartedAt = Date.now();
        await this.webview.postMessage({
            command: 'focusTreeContentUpdated',
            ...updatePlan.update,
        });

        debug('[focustree] refresh timings', {
            documentVersion: updatePlan.update.documentVersion,
            snapshotVersion: updatePlan.update.snapshotVersion,
            loadMs: baseState.loadDurationMs,
            diffMs: diffDurationMs,
            changedTreeCount: updatePlan.changedTreeCount,
            changedFocusCount: updatePlan.changedFocusCount,
            changedInlayCount: updatePlan.changedInlayCount,
            changedSlots: updatePlan.update.changedSlots,
            deferredAssetLoad: baseState.deferredAssetLoad,
            postMessageMs: Date.now() - postMessageStartedAt,
            totalMs: Date.now() - refreshStartedAt,
        });
    }

    private createSnapshotLoader(
        content: string,
        assetLoadMode: FocusTreeAssetLoadMode = 'full',
    ): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(() => Promise.resolve(content), assetLoadMode);
        loader.onLoadDone(result => this.updateDependencies(result.dependencies));
        return loader;
    }

    private primeDeferredInitialBaseState(document: vscode.TextDocument): void {
        const loader = this.createSnapshotLoader(document.getText(), 'deferred');
        const promise = buildFocusTreeRenderBaseState(
            loader,
            document.version,
            this.getConditionPresetsByTree(),
        ).then(baseState => {
            this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
            if (document.version === baseState.focusPositionDocumentVersion) {
                this.pendingReadyBaseState = baseState;
            }
            return baseState;
        }).catch(e => {
            error(e);
            throw e;
        });

        this.pendingReadyBaseStatePromise = {
            documentVersion: document.version,
            promise,
        };
    }

    private scheduleDeferredHydrationRefresh(document: vscode.TextDocument): void {
        if (this.deferredHydrationDocumentVersion === document.version) {
            return;
        }

        this.deferredHydrationDocumentVersion = document.version;
        setTimeout(() => {
            void (async () => {
                try {
                    const latestDocument = getDocumentByUri(this.uri);
                    if (!latestDocument || latestDocument.version !== document.version) {
                        return;
                    }

                    await this.refreshDocument(latestDocument, { forceFullAssetLoad: true });
                } finally {
                    if (this.deferredHydrationDocumentVersion === document.version) {
                        this.deferredHydrationDocumentVersion = undefined;
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
        this.webviewReady = false;
        this.lastRenderCache = undefined;
        const content = this.renderShell(document.version);
        if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
            return;
        }

        this.webview.html = content;
    }

    private resetSessionState(): void {
        this.webviewReady = false;
        this.lastRenderCache = undefined;
        this.pendingReadyBaseState = undefined;
        this.pendingReadyBaseStatePromise = undefined;
        this.deferredHydrationDocumentVersion = undefined;
    }

    private startRefreshRequest(): number {
        this.latestRefreshRequestId += 1;
        return this.latestRefreshRequestId;
    }

    private isRefreshRequestCurrent(requestId: number): boolean {
        return requestId === this.latestRefreshRequestId;
    }
}
