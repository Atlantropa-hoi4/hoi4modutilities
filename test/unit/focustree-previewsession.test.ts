import * as assert from 'assert';
import Module = require('module');
import * as vscode from 'vscode';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({
                    get: () => undefined,
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
            },
            Uri: {
                joinPath: () => ({ toString: () => 'mock-uri' }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { FocusTreePreviewSession } = require('../../src/previewdef/focustree/previewsession') as typeof import('../../src/previewdef/focustree/previewsession');
const { createFocusTreeRuntimeState } = require('../../src/previewdef/focustree/runtime') as typeof import('../../src/previewdef/focustree/runtime');
const { UserError } = require('../../src/util/common') as typeof import('../../src/util/common');

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
        focusIconGfxFileByName: {},
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
    buildBaseState?: (document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred', isCancelled?: () => boolean) => Promise<any>;
    createFullSnapshot?: (baseState: any, previousCache: any) => Promise<any>;
    renderShell?: (documentVersion: number) => string;
    latestDocument?: vscode.TextDocument | undefined;
    deferredHydrationDelayMs?: number;
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
        deferredHydrationDelayMs: overrides?.deferredHydrationDelayMs ?? 0,
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
                cache: {
                    snapshotVersion: 1,
                    selectedTreeId: baseState.focusTrees[0]?.id,
                    focusTrees: baseState.focusTrees,
                    renderedFocus: {},
                    renderedInlayWindows: {},
                    focusIconGfxFileByName: {},
                    gridBox: baseState.gridBox,
                    dynamicStyleCss: '',
                    xGridSize: baseState.xGridSize,
                    yGridSize: baseState.yGridSize,
                    focusPositionDocumentVersion: baseState.focusPositionDocumentVersion,
                    hasFocusSelector: baseState.hasFocusSelector,
                    hasWarningsButton: baseState.hasWarningsButton,
                    deferredAssetLoad: baseState.deferredAssetLoad,
                    treePatchSignatures: {},
                    treeStructureSignatures: {},
                    focusRenderSignatures: {},
                    inlayRenderSignatures: {},
                    styleDependencySignature: '',
                },
                metrics: {
                    loadDurationMs: 1,
                    focusIconStyleDurationMs: 1,
                    localisationResolveDurationMs: 1,
                    focusTemplateRenderDurationMs: 1,
                    focusRenderDurationMs: 1,
                    inlayStyleDurationMs: 1,
                    inlayRenderDurationMs: 1,
                    focusCount: 0,
                    inlayCount: 0,
                    deferredAssetLoad: baseState.deferredAssetLoad,
                },
            }) as any),
        },
    });
    return { session, webview, postMessages, runtimeState, latestDocument };
}

describe('focustree preview session', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

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

    it('adds timing metadata to content update messages', async () => {
        const document = createDocument(22);
        const runtimeState = createFocusTreeRuntimeState();
        const { session, postMessages } = createSession({ runtimeState });

        await session.initializePanel(document);
        session.handleWebviewReady();
        await new Promise(resolve => setTimeout(resolve, 0));

        const contentUpdate = postMessages.find(message => (message as any).command === 'focusTreeContentUpdated') as any;
        assert.ok(contentUpdate);
        assert.strictEqual(contentUpdate.perf.source, 'initialize');
        assert.strictEqual(contentUpdate.perf.assetLoadMode, 'deferred');
        assert.strictEqual(contentUpdate.perf.updateKind, 'full');
        assert.ok(contentUpdate.perf.payloadBytes > 0);
        assert.strictEqual(contentUpdate.perf.changedSlotCount, contentUpdate.changedSlots.length);
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

    it('signals cancellation to stale refresh base-state builds', async () => {
        const firstDocument = createDocument(20);
        const secondDocument = createDocument(21);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let firstBuildIsCancelled: (() => boolean) | undefined;
        let resolveFirstBuild: (() => void) | undefined;
        const firstBuildStarted = new Promise<void>(resolve => {
            resolveFirstBuild = resolve;
        });
        let observedCancellation = false;
        const { session, latestDocument, postMessages } = createSession({
            runtimeState,
            latestDocument: firstDocument,
            buildBaseState: async (document, assetLoadMode, isCancelled) => {
                if (document.version === firstDocument.version) {
                    firstBuildIsCancelled = isCancelled;
                    resolveFirstBuild?.();
                    while (!isCancelled?.()) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }

                    observedCancellation = true;
                    throw new UserError('cancelled stale build');
                }

                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });

        const firstRefresh = session.refreshDocument(firstDocument);
        await firstBuildStarted;
        latestDocument.current = secondDocument;
        const secondRefresh = session.refreshDocument(secondDocument);

        await Promise.all([firstRefresh, secondRefresh]);

        assert.strictEqual(firstBuildIsCancelled?.(), true);
        assert.strictEqual(observedCancellation, true);
        assert.ok(postMessages.some(message => (message as any).documentVersion === secondDocument.version));
        assert.ok(!postMessages.some(message => (message as any).documentVersion === firstDocument.version));
    });

    it('reconciles local edits through deferred snapshot updates before hydration', async () => {
        const document = createDocument(12);
        const requestedModes: Array<'full' | 'deferred'> = [];
        const { session, webview, postMessages, latestDocument } = createSession({
            latestDocument: document,
            buildBaseState: async (_document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });
        session.handleWebviewReady();

        const updatedVersion = session.reconcileAfterLocalEdit(document);
        latestDocument.current = document;
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(updatedVersion, 12);
        assert.strictEqual(webview.html, '');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeContentUpdated'));
        assert.deepStrictEqual(requestedModes.slice(0, 1), ['deferred']);
    });

    it('keeps hydrated icon assets on later local edits instead of reverting to deferred placeholders', async () => {
        const document = createDocument(23);
        const requestedModes: Array<'full' | 'deferred'> = [];
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        runtimeState.lastRenderCache = {
            snapshotVersion: 3,
            focusTrees: [],
            renderedFocus: {},
            renderedInlayWindows: {},
            focusIconGfxFileByName: {},
            focusIconStyleSignature: 'hydrated-icons',
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.hydrated-icons {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: document.version - 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            hasFocusSelector: false,
            hasWarningsButton: false,
            deferredAssetLoad: false,
            treePatchSignatures: {},
            treeStructureSignatures: {},
            focusRenderSignatures: {},
            inlayRenderSignatures: {},
            styleDependencySignature: '',
        } as any;
        const { session, latestDocument } = createSession({
            runtimeState,
            latestDocument: document,
            buildBaseState: async (_document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });

        session.reconcileAfterLocalEdit(document);
        latestDocument.current = document;
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(requestedModes.slice(0, 1), ['full']);
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

    it('keeps temporary parser errors inside document refreshes', async () => {
        const document = createDocument(19);
        const { session, webview, postMessages } = createSession({
            buildBaseState: async () => {
                throw new UserError('temporary parse error');
            },
        });

        session.handleWebviewReady();
        await assert.doesNotReject(() => session.refreshDocument(document));

        assert.strictEqual(webview.html, '');
        assert.deepStrictEqual(postMessages, []);
    });

    it('schedules full hydration after the deferred first snapshot is applied', async () => {
        const document = createDocument(16);
        let resolveDeferred: ((value: any) => void) | undefined;
        let resolveFull: ((value: any) => void) | undefined;
        const requestedModes: Array<'full' | 'deferred'> = [];
        const deferredPromise = new Promise<any>(resolve => {
            resolveDeferred = resolve;
        });
        const fullPromise = new Promise<any>(resolve => {
            resolveFull = resolve;
        });
        const { session, postMessages } = createSession({
            buildBaseState: async (_document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return assetLoadMode === 'deferred' ? deferredPromise : fullPromise;
            },
        });

        await session.initializePanel(document);

        assert.deepStrictEqual(requestedModes, ['deferred']);

        session.handleWebviewReady();
        resolveDeferred?.(createBaseState(document.version, true));
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeContentUpdated').length, 1);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);

        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);
        resolveFull?.(createBaseState(document.version, false));
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeContentUpdated').length, 2);
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);
    });

    it('still applies later IDE document refreshes while the initial hydration promise is pending', async () => {
        const initialDocument = createDocument(17);
        const updatedDocument = createDocument(18);
        let resolveDeferredInitial: ((value: any) => void) | undefined;
        let resolveFullInitial: ((value: any) => void) | undefined;
        let resolveUpdatedDeferred: ((value: any) => void) | undefined;
        const deferredInitialPromise = new Promise<any>(resolve => {
            resolveDeferredInitial = resolve;
        });
        const fullInitialPromise = new Promise<any>(resolve => {
            resolveFullInitial = resolve;
        });
        const updatedDeferredPromise = new Promise<any>(resolve => {
            resolveUpdatedDeferred = resolve;
        });
        const { session, postMessages, latestDocument } = createSession({
            latestDocument: initialDocument,
            buildBaseState: async (document, assetLoadMode) => {
                if (document.version === 17 && assetLoadMode === 'deferred') {
                    return deferredInitialPromise;
                }
                if (document.version === 17 && assetLoadMode === 'full') {
                    return fullInitialPromise;
                }
                if (document.version === 18 && assetLoadMode === 'deferred') {
                    return updatedDeferredPromise;
                }
                if (document.version === 18 && assetLoadMode === 'full') {
                    return Promise.resolve(createBaseState(updatedDocument.version, false));
                }

                throw new Error(`Unexpected buildBaseState request ${document.version}:${assetLoadMode}`);
            },
        });

        await session.initializePanel(initialDocument);
        session.handleWebviewReady();

        resolveDeferredInitial?.(createBaseState(initialDocument.version, true));
        await new Promise(resolve => setTimeout(resolve, 0));

        latestDocument.current = updatedDocument;
        const refreshPromise = session.refreshDocument(updatedDocument);
        resolveFullInitial?.(createBaseState(initialDocument.version, false));
        resolveUpdatedDeferred?.(createBaseState(updatedDocument.version, true));
        await refreshPromise;
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        const contentUpdates = postMessages.filter(message => (message as any).command === 'focusTreeContentUpdated');
        assert.ok(contentUpdates.some(message => (message as any).documentVersion === 17));
        assert.ok(contentUpdates.some(message => (message as any).documentVersion === 18));
        assert.strictEqual((contentUpdates.at(-1) as any).documentVersion, 18);
    });
});
