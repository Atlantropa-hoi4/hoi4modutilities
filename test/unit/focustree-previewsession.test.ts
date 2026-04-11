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

function createBaseState(documentVersion: number, deferredAssetLoad: boolean) {
    return {
        focusTrees: [],
        allFocuses: [],
        allInlays: [],
        focusById: {},
        gfxFiles: [],
        gridBox: { position: { x: 0, y: 0 } },
        xGridSize: 96,
        yGridSize: 130,
        focusPositionDocumentVersion: documentVersion,
        focusPositionActiveFile: 'common/national_focus/test.txt',
        conditionPresetsByTree: {},
        hasFocusSelector: false,
        hasWarningsButton: false,
        loadDurationMs: 1,
        deferredAssetLoad,
    };
}

function createSession(overrides?: {
    runtimeState?: ReturnType<typeof createFocusTreeRuntimeState>;
    buildBaseState?: (document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred') => Promise<any>;
    createFullSnapshot?: (baseState: any, previousCache: any) => Promise<any>;
    renderShell?: (documentVersion: number) => string;
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
            renderDocument: async document => `full:${document.version}`,
            buildBaseState: overrides?.buildBaseState ?? (async (document, assetLoadMode) => (
                createBaseState(document.version, assetLoadMode === 'deferred')
            )),
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
    });
    return { session, webview, postMessages, runtimeState, latestDocument };
}

describe('focustree preview session', () => {
    it('keeps the shell html while the first snapshot is prepared before webview ready', async () => {
        const document = createDocument(4);
        const { session, webview, runtimeState } = createSession();

        await session.refreshDocument(document);

        assert.strictEqual(webview.html, '');
        assert.strictEqual(runtimeState.lastRenderCache, undefined);
        assert.strictEqual(runtimeState.webviewReady, false);
    });

    it('initializes the panel with shell html and delays snapshot delivery until webview ready', async () => {
        const document = createDocument(5);
        let resolveBuildBaseState: ((value: any) => void) | undefined;
        const buildBaseStatePromise = new Promise<any>(resolve => {
            resolveBuildBaseState = resolve;
        });
        const { session, webview, postMessages } = createSession({
            buildBaseState: async () => buildBaseStatePromise,
        });

        await session.initializePanel(document);

        assert.strictEqual(webview.html, 'shell:5');
        assert.strictEqual(postMessages.length, 0);

        resolveBuildBaseState?.({
            ...createBaseState(document.version, true),
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(webview.html, 'shell:5');
        assert.strictEqual(postMessages.length, 0);
    });

    it('posts a snapshot update after the webview becomes ready', async () => {
        const document = createDocument(6);
        const runtimeState = createFocusTreeRuntimeState();
        const { session, webview, postMessages, runtimeState: sessionState } = createSession({ runtimeState });

        await session.initializePanel(document);
        session.handleWebviewReady();
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(webview.html, 'shell:6');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeContentUpdated'));
        assert.strictEqual(sessionState.lastRenderCache?.snapshotVersion, 1);
        assert.strictEqual(sessionState.webviewReady, true);
    });

    it('uses snapshot updates instead of resetting html after the webview is ready', async () => {
        const document = createDocument(7);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        const { session, webview, postMessages } = createSession({
            runtimeState,
        });

        await session.refreshDocument(document);

        assert.strictEqual(webview.html, '');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeContentUpdated'));
        assert.strictEqual(runtimeState.webviewReady, true);
    });

    it('discards stale refresh work when a newer refresh starts first', async () => {
        const firstDocument = createDocument(10);
        const secondDocument = createDocument(11);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let resolveFirstHtml: ((value: any) => void) | undefined;
        const firstHtml = new Promise<any>(resolve => {
            resolveFirstHtml = resolve;
        });
        const { session, webview, postMessages } = createSession({
            runtimeState,
            buildBaseState: document => {
                if (document.version === 10) {
                    return firstHtml as Promise<any>;
                }
                return Promise.resolve(createBaseState(document.version, false));
            },
        });

        const firstRefresh = session.refreshDocument(firstDocument);
        const secondRefresh = session.refreshDocument(secondDocument);
        resolveFirstHtml?.(createBaseState(firstDocument.version, false));

        await Promise.all([firstRefresh, secondRefresh]);

        assert.ok(postMessages.some(message => (message as any).documentVersion === 11));
        assert.strictEqual(webview.html, '');
    });

    it('reconciles local edits through snapshot updates', async () => {
        const document = createDocument(12);
        const { session, webview, postMessages, latestDocument } = createSession({
            latestDocument: document,
        });
        session.handleWebviewReady();

        const updatedVersion = session.reconcileAfterLocalEdit(document);
        latestDocument.current = document;
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(updatedVersion, 12);
        assert.strictEqual(webview.html, '');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeContentUpdated'));
    });

    it('uses snapshot updates after structural edits', async () => {
        const document = createDocument(14);
        const { session, webview, latestDocument } = createSession({
            latestDocument: document,
        });
        session.handleWebviewReady();
        latestDocument.current = document;

        const version = await session.reloadAfterStructuralEdit(document);

        assert.strictEqual(version, 14);
        assert.strictEqual(webview.html, '');
    });

    it('ignores disposed webview errors during an async snapshot update', async () => {
        const document = createDocument(15);
        const { session, webview } = createSession();
        webview.postMessage = async () => {
            throw new Error('Webview is disposed');
        };

        session.handleWebviewReady();
        await session.refreshDocument(document);

        assert.strictEqual(webview.html, '');
    });
});
