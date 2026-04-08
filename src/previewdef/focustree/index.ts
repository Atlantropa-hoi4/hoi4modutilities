import * as vscode from 'vscode';
import {
    renderFocusTreeShellHtml,
    buildFocusTreeRenderBaseState,
    buildFocusTreeRenderPayloadFromBaseState,
    FocusTreeRenderBaseState,
} from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewDescriptor } from '../descriptor';
import { FocusTreeLoader } from './loader';
import { getDocumentByUri, getRelativePathInWorkspace } from '../../util/vsccommon';
import { FocusPositionEditMessage } from './positioneditcommon';
import { buildContinuousFocusPositionWorkspaceEdit, buildCreateFocusTemplateWorkspaceEdit, buildDeleteFocusWorkspaceEdit, buildFocusExclusiveLinkWorkspaceEdit, buildFocusLinkWorkspaceEdit, buildFocusPositionWorkspaceEdit } from './positioneditservice';
import { localize } from '../../util/i18n';
import { contextContainer } from '../../context';
import { FocusConditionPresetsByTree, normalizeConditionPresetsByTree } from './conditionpresets';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { debug, error } from '../../util/debug';
import {
    createFocusTreeRenderCache,
    createFocusTreeRenderUpdate,
    createFullFocusTreeRenderUpdate,
    FocusTreeRenderCache,
} from './renderpayloadpatch';
import { FocusTreeAssetLoadMode } from './loader';

const focusConditionPresetsStateKeyPrefix = 'focusTree.conditionPresets.v1:';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['common', 'national_focus', '*'])) {
        return 0;
    }

    return findDocumentRegexPreviewPriority(document, /(focus_tree|shared_focus|joint_focus)\s*=\s*{/);
}

export class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private relativeFilePath: string;
    private persistedConditionPresetsByTree: FocusConditionPresetsByTree;
    private pendingLocalEditDocumentVersions = new Set<number>();
    private webviewReady = false;
    private latestRefreshRequestId = 0;
    private lastRenderCache: FocusTreeRenderCache | undefined;
    private pendingReadyBaseState: FocusTreeRenderBaseState | undefined;
    private pendingReadyBaseStatePromise: { documentVersion: number; promise: Promise<FocusTreeRenderBaseState> } | undefined;
    private deferredHydrationDocumentVersion: number | undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        this.focusTreeLoader = new FocusTreeLoader(this.relativeFilePath);
        this.persistedConditionPresetsByTree = this.getStoredConditionPresetsByTree();
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.lastRenderCache = undefined;
        return renderFocusTreeShellHtml(
            document.uri,
            this.panel.webview,
            document.version,
            this.persistedConditionPresetsByTree,
        );
    }

    public override async initializePanelContent(document: vscode.TextDocument): Promise<void> {
        this.webviewReady = false;
        this.lastRenderCache = undefined;
        this.pendingReadyBaseState = undefined;
        this.pendingReadyBaseStatePromise = undefined;
        this.panel.webview.html = renderFocusTreeShellHtml(
            document.uri,
            this.panel.webview,
            document.version,
            this.persistedConditionPresetsByTree,
        );

        this.primeDeferredInitialBaseState(document);
    }

    public override getDocumentChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        await this.refreshDocument(document);
    }

    private async refreshDocument(
        document: vscode.TextDocument,
        options?: { ignorePendingLocalEditDocumentVersion?: boolean; forceFullAssetLoad?: boolean; forceFullSnapshot?: boolean },
    ): Promise<void> {
        if (!options?.ignorePendingLocalEditDocumentVersion && this.pendingLocalEditDocumentVersions.delete(document.version)) {
            return;
        }

        const requestId = this.startRefreshRequest();
        const requestDocumentVersion = document.version;
        const refreshStartedAt = Date.now();
        try {
            const cachedBaseState = !options?.forceFullAssetLoad && this.webviewReady
                && this.pendingReadyBaseState?.focusPositionDocumentVersion === document.version
                ? this.pendingReadyBaseState
                : undefined;
            if (cachedBaseState) {
                this.pendingReadyBaseState = undefined;
            }

            let baseState: FocusTreeRenderBaseState;
            if (cachedBaseState) {
                baseState = cachedBaseState;
            } else {
                const pendingBaseStatePromise = !options?.forceFullAssetLoad && this.webviewReady
                    && this.pendingReadyBaseStatePromise?.documentVersion === document.version
                    ? this.pendingReadyBaseStatePromise.promise
                    : undefined;
                if (pendingBaseStatePromise) {
                    baseState = await pendingBaseStatePromise;
                    if (!this.isRefreshRequestCurrent(requestId)) {
                        return;
                    }
                    this.pendingReadyBaseStatePromise = undefined;
                } else {
                    const assetLoadMode: FocusTreeAssetLoadMode = options?.forceFullAssetLoad
                        ? 'full'
                        : this.webviewReady ? 'full' : 'deferred';
                    const loader = this.createSnapshotLoader(document.getText(), assetLoadMode);
                    baseState = await buildFocusTreeRenderBaseState(loader, document.version, this.persistedConditionPresetsByTree);
                    this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
                    if (!this.isRefreshRequestCurrent(requestId)) {
                        return;
                    }
                }
            }

            const diffStartedAt = Date.now();
            if (!this.webviewReady) {
                this.pendingReadyBaseState = baseState;
                await this.applyFullRefresh(document, requestId, requestDocumentVersion);
                return;
            }

            const updatePlan = options?.forceFullSnapshot
                ? { kind: 'full' as const }
                : await createFocusTreeRenderUpdate(this.lastRenderCache, baseState);
            const diffDurationMs = Date.now() - diffStartedAt;
            if (updatePlan.kind === 'full') {
                const htmlBuildStartedAt = Date.now();
                const { payload, metrics } = await buildFocusTreeRenderPayloadFromBaseState(baseState);
                const { update, cache } = createFullFocusTreeRenderUpdate(payload, this.lastRenderCache);
                this.lastRenderCache = cache;
                const htmlBuildDurationMs = Date.now() - htmlBuildStartedAt;
                const postMessageStartedAt = Date.now();
                await this.panel.webview.postMessage({
                    command: 'focusTreeContentUpdated',
                    ...update,
                });
                debug('[focustree] refresh timings', {
                    documentVersion: payload.focusPositionDocumentVersion,
                    snapshotVersion: update.snapshotVersion,
                    loadMs: baseState.loadDurationMs,
                    diffMs: diffDurationMs,
                    htmlBuildMs: htmlBuildDurationMs,
                    focusRenderMs: metrics.focusRenderDurationMs,
                    inlayRenderMs: metrics.inlayRenderDurationMs,
                    postMessageMs: Date.now() - postMessageStartedAt,
                    changedSlots: update.changedSlots,
                    deferredAssetLoad: baseState.deferredAssetLoad,
                    totalMs: Date.now() - refreshStartedAt,
                });
                if (baseState.deferredAssetLoad && !options?.forceFullAssetLoad) {
                    this.scheduleDeferredHydrationRefresh(document);
                }
                return;
            }

            this.lastRenderCache = updatePlan.cache;
            const postMessageStartedAt = Date.now();
            await this.panel.webview.postMessage({
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
            if (baseState.deferredAssetLoad && !options?.forceFullAssetLoad) {
                this.scheduleDeferredHydrationRefresh(document);
            }
        } catch (e) {
            error(e);
            this.webviewReady = false;
            this.lastRenderCache = undefined;
            this.pendingReadyBaseState = undefined;
            this.pendingReadyBaseStatePromise = undefined;
            const content = await this.getContent(document);
            if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
                return;
            }

            this.panel.webview.html = content;
        }
    }

    private createSnapshotLoader(content: string, assetLoadMode: FocusTreeAssetLoadMode = 'full'): FocusTreeLoader {
        const loader = this.focusTreeLoader.createSnapshotLoader(() => Promise.resolve(content), assetLoadMode);
        loader.onLoadDone(r => this.updateDependencies(r.dependencies));
        return loader;
    }

    private primeDeferredInitialBaseState(document: vscode.TextDocument): void {
        const loader = this.createSnapshotLoader(document.getText(), 'deferred');
        const promise = buildFocusTreeRenderBaseState(loader, document.version, this.persistedConditionPresetsByTree)
            .then(baseState => {
                this.focusTreeLoader.adoptDependencyLoadersFrom(loader);
                if (document.version === baseState.focusPositionDocumentVersion) {
                    this.pendingReadyBaseState = baseState;
                }
                return baseState;
            })
            .catch(e => {
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

    private reconcileAfterLocalEdit(updatedDocument: vscode.TextDocument | undefined): number | undefined {
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

    private startRefreshRequest(): number {
        this.latestRefreshRequestId += 1;
        return this.latestRefreshRequestId;
    }

    private isRefreshRequestCurrent(requestId: number): boolean {
        return requestId === this.latestRefreshRequestId;
    }

    private async applyFullRefresh(
        document: vscode.TextDocument,
        requestId: number,
        requestDocumentVersion: number,
    ): Promise<void> {
        this.webviewReady = false;
        this.lastRenderCache = undefined;
        const content = await this.getContent(document);
        if (!this.isRefreshRequestCurrent(requestId) || document.version !== requestDocumentVersion) {
            return;
        }

        this.panel.webview.html = content;
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const command = (msg as any).command as string | undefined;
        if (command === 'focusTreeWebviewReady') {
            this.webviewReady = true;
            const document = getDocumentByUri(this.uri);
            if (document) {
                void this.refreshDocument(document);
            }
            return true;
        }

        if (command === 'promptFocusConditionPresetName') {
            const name = await vscode.window.showInputBox({
                prompt: localize('TODO', 'Preset name'),
                value: (msg as any).initialValue ?? '',
                ignoreFocusOut: true,
            });
            await this.panel.webview.postMessage({
                command: 'focusConditionPresetNameResolved',
                name,
            });
            return true;
        }

        if (command === 'persistFocusConditionPresets') {
            this.persistedConditionPresetsByTree = normalizeConditionPresetsByTree((msg as any).presetsByTree);
            await this.storeConditionPresetsByTree(this.persistedConditionPresetsByTree);
            return true;
        }

        if (command !== 'applyFocusPositionEdit'
            && command !== 'applyContinuousFocusPositionEdit'
            && command !== 'createFocusTemplateAtPosition'
            && command !== 'applyFocusLinkEdit'
            && command !== 'applyFocusExclusiveLinkEdit'
            && command !== 'deleteFocus') {
            return false;
        }

        const document = getDocumentByUri(this.uri);
        if (!document) {
            await vscode.window.showErrorMessage(localize('TODO', 'The source document is no longer open.'));
            return true;
        }

        if (msg.command === 'applyFocusPositionEdit') {
            const { edit, error } = buildFocusPositionWorkspaceEdit(document, msg.focusId, msg.targetLocalX, msg.targetLocalY);
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus position edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument);
            await this.panel.webview.postMessage({
                command: 'focusPositionEditApplied',
                focusId: msg.focusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'applyContinuousFocusPositionEdit') {
            const { edit, error } = buildContinuousFocusPositionWorkspaceEdit(
                document,
                this.relativeFilePath,
                msg.focusTreeEditKey,
                msg.targetX,
                msg.targetY,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the continuous focus position edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument);
            await this.panel.webview.postMessage({
                command: 'continuousFocusPositionEditApplied',
                focusTreeEditKey: msg.focusTreeEditKey,
                targetX: msg.targetX,
                targetY: msg.targetY,
                documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'applyFocusLinkEdit') {
            const { edit, error } = buildFocusLinkWorkspaceEdit(
                document,
                msg.parentFocusId,
                msg.childFocusId,
                msg.targetLocalX,
                msg.targetLocalY,
                msg.parentFocusIds,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                await this.panel.webview.postMessage({
                    command: 'focusLinkEditApplied',
                    parentFocusId: msg.parentFocusId,
                    parentFocusIds: msg.parentFocusIds,
                    childFocusId: msg.childFocusId,
                    targetLocalX: msg.targetLocalX,
                    targetLocalY: msg.targetLocalY,
                    documentVersion: document.version,
                });
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus link edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument);
            await this.panel.webview.postMessage({
                command: 'focusLinkEditApplied',
                parentFocusId: msg.parentFocusId,
                parentFocusIds: msg.parentFocusIds,
                childFocusId: msg.childFocusId,
                targetLocalX: msg.targetLocalX,
                targetLocalY: msg.targetLocalY,
                documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'applyFocusExclusiveLinkEdit') {
            const { edit, error } = buildFocusExclusiveLinkWorkspaceEdit(
                document,
                msg.sourceFocusId,
                msg.targetFocusId,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                await this.panel.webview.postMessage({
                    command: 'focusExclusiveLinkEditApplied',
                    sourceFocusId: msg.sourceFocusId,
                    targetFocusId: msg.targetFocusId,
                    documentVersion: document.version,
                });
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the mutually exclusive focus link edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument);
            await this.panel.webview.postMessage({
                command: 'focusExclusiveLinkEditApplied',
                sourceFocusId: msg.sourceFocusId,
                targetFocusId: msg.targetFocusId,
                documentVersion: updatedDocumentVersion ?? Math.max(document.version, msg.documentVersion) + 1,
            });

            return true;
        }

        if (msg.command === 'deleteFocus') {
            const focusIds = msg.focusIds && msg.focusIds.length > 0 ? msg.focusIds : [msg.focusId];
            const { edit, error } = buildDeleteFocusWorkspaceEdit(document, focusIds);
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus delete edit.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument) ?? updatedDocument.version;
                await this.panel.webview.postMessage({
                    command: 'deleteFocusApplied',
                    focusIds,
                    documentVersion: updatedDocumentVersion,
                });
            }

            return true;
        }

        if (msg.command === 'createFocusTemplateAtPosition') {
            const { edit, error, placeholderFocusId, placeholderRange } = buildCreateFocusTemplateWorkspaceEdit(
                document,
                this.relativeFilePath,
                msg.treeEditKey,
                msg.targetAbsoluteX,
                msg.targetAbsoluteY,
            );
            if (error) {
                await vscode.window.showErrorMessage(error);
                return true;
            }

            if (!edit) {
                return true;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await vscode.window.showErrorMessage(localize('TODO', 'VS Code refused the focus template insert.'));
                return true;
            }

            const updatedDocument = getDocumentByUri(this.uri);
            if (updatedDocument) {
                const updatedDocumentVersion = this.reconcileAfterLocalEdit(updatedDocument) ?? updatedDocument.version;
                await this.panel.webview.postMessage({
                    command: 'createFocusTemplateApplied',
                    treeEditKey: msg.treeEditKey,
                    focusId: placeholderFocusId,
                    targetAbsoluteX: msg.targetAbsoluteX,
                    targetAbsoluteY: msg.targetAbsoluteY,
                    documentVersion: updatedDocumentVersion,
                });
                if (placeholderRange) {
                    await vscode.window.showTextDocument(updatedDocument, {
                        selection: new vscode.Range(
                            updatedDocument.positionAt(placeholderRange.start),
                            updatedDocument.positionAt(placeholderRange.end),
                        ),
                        viewColumn: vscode.ViewColumn.One,
                    });
                }
            }

            return true;
        }

        return false;
    }

    private getConditionPresetsStateKey(): string {
        return `${focusConditionPresetsStateKeyPrefix}${this.relativeFilePath}`;
    }

    private getStoredConditionPresetsByTree(): FocusConditionPresetsByTree {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return {};
        }

        return normalizeConditionPresetsByTree(
            workspaceState.get(this.getConditionPresetsStateKey()) as FocusConditionPresetsByTree | undefined,
        );
    }

    private async storeConditionPresetsByTree(conditionPresetsByTree: FocusConditionPresetsByTree): Promise<void> {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return;
        }

        const hasEntries = Object.keys(conditionPresetsByTree).length > 0;
        await workspaceState.update(this.getConditionPresetsStateKey(), hasEntries ? conditionPresetsByTree : undefined);
    }
}

export const focusTreePreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    createPreview: (uri, panel) => new FocusTreePreview(uri, panel),
    panelOptions: {
        retainContextWhenHidden: true,
    },
};
