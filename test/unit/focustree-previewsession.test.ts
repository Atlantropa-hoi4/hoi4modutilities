import * as assert from 'assert';
import * as vscode from 'vscode';
import { FocusTreePreviewSession } from '../../src/previewdef/focustree/previewsession';
import { createFocusTreeRuntimeState } from '../../src/previewdef/focustree/runtime';

function createDocument(version: number): vscode.TextDocument {
    return {
        version,
        uri: { fsPath: `C:/test/focus-${version}.txt`, path: `/test/focus-${version}.txt`, toString: () => `file:///test/focus-${version}.txt` },
        getText: () => `focus_tree = { id = test_${version} }`,
    } as vscode.TextDocument;
}

function createSession(overrides?: {
    runtimeState?: ReturnType<typeof createFocusTreeRuntimeState>;
    buildBaseState?: (document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred') => Promise<any>;
    createFullSnapshot?: (baseState: any, previousCache: any) => Promise<any>;
    renderShell?: (documentVersion: number) => string;
    renderDocument?: (document: vscode.TextDocument) => Promise<string>;
    plan?: (previousCache: any, baseState: any) => Promise<any>;
    latestDocument?: vscode.TextDocument | undefined;
}) {
    const postMessages: any[] = [];
    const webview = {
        html: '',
        postMessage: async (message: unknown) => {
            postMessages.push(message);
            return true;
        },
    } as unknown as vscode.Webview;
    const runtimeState = overrides?.runtimeState ?? createFocusTreeRuntimeState();
    const latestDocument = { current: overrides?.latestDocument };
    const session = new FocusTreePreviewSession({
        uri: { fsPath: 'C:/test/focus.txt', path: '/test/focus.txt', toString: () => 'file:///test/focus.txt' } as vscode.Uri,
        webview,
        focusTreeLoader: {} as any,
        getConditionPresetsByTree: () => ({}),
        updateDependencies: () => undefined,
        getLatestDocument: () => latestDocument.current,
        runtimeState,
        snapshotBuilder: {
            renderShell: overrides?.renderShell ?? (documentVersion => `shell:${documentVersion}`),
            renderDocument: overrides?.renderDocument ?? (async document => `full:${document.version}`),
            buildBaseState: overrides?.buildBaseState ?? (async (document, assetLoadMode) => ({
                focusPositionDocumentVersion: document.version,
                deferredAssetLoad: assetLoadMode === 'deferred',
                loadDurationMs: 1,
            })),
            createFullSnapshot: overrides?.createFullSnapshot ?? (async baseState => ({
                payload: {
                    focusPositionDocumentVersion: baseState.focusPositionDocumentVersion,
                },
                update: {
                    snapshotVersion: 1,
                    documentVersion: baseState.focusPositionDocumentVersion,
                    changedSlots: ['treeDefinitions'],
                },
                cache: { snapshotVersion: 1 },
                metrics: {
                    focusRenderDurationMs: 1,
                    inlayRenderDurationMs: 1,
                },
            }) as any),
        },
        patchPlanner: {
            plan: overrides?.plan ?? (async () => ({ kind: 'full' })),
        },
    });
    return { session, webview, postMessages, runtimeState, latestDocument };
}

describe('focustree preview session', () => {
    it('replaces the panel with a shell while the webview is not ready and caches the deferred base state', async () => {
        const document = createDocument(4);
        const { session, webview, runtimeState } = createSession({
            buildBaseState: async currentDocument => ({
                focusPositionDocumentVersion: currentDocument.version,
                deferredAssetLoad: true,
                loadDurationMs: 1,
            }),
        });

        await session.refreshDocument(document);

        assert.strictEqual(webview.html, 'shell:4');
        assert.strictEqual(runtimeState.pendingReadyBaseState?.focusPositionDocumentVersion, 4);
    });

    it('posts a full snapshot when the webview is ready and a cached base state already exists', async () => {
        const document = createDocument(6);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        runtimeState.pendingReadyBaseState = {
            focusPositionDocumentVersion: 6,
            deferredAssetLoad: false,
            loadDurationMs: 2,
        } as any;
        const { session, postMessages, runtimeState: sessionState } = createSession({ runtimeState });

        await session.refreshDocument(document);

        assert.strictEqual(postMessages.length, 1);
        assert.strictEqual(postMessages[0].command, 'focusTreeContentUpdated');
        assert.strictEqual(sessionState.lastRenderCache?.snapshotVersion, 1);
    });

    it('posts a partial snapshot when the patch planner can stay incremental', async () => {
        const document = createDocument(8);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        const { session, postMessages, runtimeState: sessionState } = createSession({
            runtimeState,
            plan: async () => ({
                kind: 'partial',
                update: {
                    snapshotVersion: 9,
                    documentVersion: 8,
                    changedSlots: ['treeBody'],
                },
                cache: { snapshotVersion: 9 },
                changedTreeCount: 0,
                changedFocusCount: 1,
                changedInlayCount: 0,
            }),
        });

        await session.refreshDocument(document);

        assert.strictEqual(postMessages.length, 1);
        assert.strictEqual(postMessages[0].snapshotVersion, 9);
        assert.deepStrictEqual(postMessages[0].changedSlots, ['treeBody']);
        assert.strictEqual(sessionState.lastRenderCache?.snapshotVersion, 9);
    });

    it('discards stale refresh work when a newer refresh starts first', async () => {
        const firstDocument = createDocument(10);
        const secondDocument = createDocument(11);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let resolveFirstBaseState: ((value: any) => void) | undefined;
        const firstBaseState = new Promise<any>(resolve => {
            resolveFirstBaseState = resolve;
        });
        const { session, postMessages } = createSession({
            runtimeState,
            buildBaseState: document => {
                if (document.version === 10) {
                    return firstBaseState;
                }
                return Promise.resolve({
                    focusPositionDocumentVersion: document.version,
                    deferredAssetLoad: false,
                    loadDurationMs: 1,
                });
            },
        });

        const firstRefresh = session.refreshDocument(firstDocument);
        const secondRefresh = session.refreshDocument(secondDocument);
        resolveFirstBaseState?.({
            focusPositionDocumentVersion: 10,
            deferredAssetLoad: false,
            loadDurationMs: 1,
        });

        await Promise.all([firstRefresh, secondRefresh]);

        assert.strictEqual(postMessages.length, 1);
        assert.strictEqual(postMessages[0].documentVersion, 11);
    });

    it('forces a full snapshot refresh after a local edit reconcile', async () => {
        const document = createDocument(12);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        const buildModes: string[] = [];
        const { session, postMessages, latestDocument } = createSession({
            runtimeState,
            latestDocument: document,
            buildBaseState: async (currentDocument, assetLoadMode) => {
                buildModes.push(assetLoadMode);
                return {
                    focusPositionDocumentVersion: currentDocument.version,
                    deferredAssetLoad: false,
                    loadDurationMs: 1,
                };
            },
            plan: async () => ({
                kind: 'partial',
                update: {
                    snapshotVersion: 5,
                    documentVersion: 12,
                    changedSlots: ['treeBody'],
                },
                cache: { snapshotVersion: 5 },
                changedTreeCount: 0,
                changedFocusCount: 1,
                changedInlayCount: 0,
            }),
        });

        const updatedVersion = session.reconcileAfterLocalEdit(document);
        latestDocument.current = document;
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(updatedVersion, 12);
        assert.ok(buildModes.every(mode => mode === 'full'));
        assert.strictEqual(postMessages.length, 1);
        assert.strictEqual(postMessages[0].changedSlots.includes('treeDefinitions'), true);
    });

    it('uses a structural full render path after structural edits', async () => {
        const document = createDocument(14);
        const { session, webview, latestDocument } = createSession({
            latestDocument: document,
            renderDocument: async currentDocument => `full:${currentDocument.version}`,
        });
        latestDocument.current = document;

        const version = await session.reloadAfterStructuralEdit(document);

        assert.strictEqual(version, 14);
        assert.strictEqual(webview.html, 'full:14');
    });
});
