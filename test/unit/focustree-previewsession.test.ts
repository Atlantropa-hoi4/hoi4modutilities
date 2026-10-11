import * as assert from 'assert';
import Module = require('module');
import * as vscode from 'vscode';
import type { FocusTreeAssetScope } from '../../src/previewdef/focustree/loader';
import type { FocusTreeRenderBaseState, FocusTreeRenderPayload } from '../../src/previewdef/focustree/contentbuilder';
import type * as FocusSchemaModule from '../../src/previewdef/focustree/schema';
import type * as HoiParserModule from '../../src/hoiformat/hoiparser';
import type * as RenderPatchModule from '../../src/previewdef/focustree/renderpayloadpatch';
import type * as FocusViewModule from '../../src/previewdef/focustree/viewmodel';
import type * as FocusIconAssetsModule from '../../src/previewdef/focustree/focusicongfx';
import { applyFocusTreeContentUpdate } from '../../webviewsrc/focustree/messageapply';
import type { FocusTreeMessageApplyContext } from '../../webviewsrc/focustree/messageapply';

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
const { focusTreeProtocolVersion } = require('../../src/previewdef/focustree/viewmodel') as typeof import('../../src/previewdef/focustree/viewmodel');
const localisationIndex = require('../../src/util/localisationIndex') as typeof import('../../src/util/localisationIndex');
const featureFlags = require('../../src/util/featureflags') as typeof import('../../src/util/featureflags');
const { getFocusTree } = require('../../src/previewdef/focustree/schema') as typeof FocusSchemaModule;
const { parseHoi4File } = require('../../src/hoiformat/hoiparser') as typeof HoiParserModule;
const { createFullFocusTreeRenderUpdate, createFocusTreeRenderCache } = require('../../src/previewdef/focustree/renderpayloadpatch') as typeof RenderPatchModule;
const { toFocusTreeViews } = require('../../src/previewdef/focustree/viewmodel') as typeof FocusViewModule;
const { createEmptyFocusIconAssetResolution } = require('../../src/previewdef/focustree/focusicongfx') as typeof FocusIconAssetsModule;
const originalIsLocalisationIndexReady = localisationIndex.isLocalisationIndexReady;
const originalWhenLocalisationIndexReady = localisationIndex.whenLocalisationIndexReady;
const originalIsLocalisationIndexEnabled = featureFlags.isLocalisationIndexEnabled;
const pendingLocalisationReady = new Promise<void>(() => undefined);

function createDocument(version: number): vscode.TextDocument {
    return {
        version,
        uri: { fsPath: `C:/test/focus-${version}.txt`, path: `/test/focus-${version}.txt`, toString: () => `file:///test/focus-${version}.txt` },
        getText: () => `focus_tree = { id = test_${version} }`,
    } as vscode.TextDocument;
}

function createBaseState(documentVersion: number, deferredAssetLoad: boolean): FocusTreeRenderBaseState {
    return {
        focusTrees: [],
        allFocuses: [],
        allInlays: [],
        focusById: {},
        gfxFiles: [],
        focusIconGfxFileByName: {},
        focusIconAssetResolution: createEmptyFocusIconAssetResolution(),
        focusIconStyleSignature: '',
        localisationIndexReady: false,
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
    } as unknown as FocusTreeRenderBaseState;
}

function createTreeView(id: string, focusId: string): any {
    return {
        id,
        kind: 'national',
        focuses: {
            [focusId]: {
                id: focusId,
                layoutEditKey: focusId,
                x: 0,
                y: 0,
                icon: [],
                prerequisite: [],
                prerequisiteGroupCount: 0,
                prerequisiteFocusCount: 0,
                exclusive: [],
                exclusiveCount: 0,
                inAllowBranch: [],
                offset: { x: 0, y: 0 },
                searchFilters: [],
                file: 'common/national_focus/test.txt',
            },
        },
        inlayWindows: [],
        allowBranchOptions: [],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [],
        searchFilters: [],
    };
}

async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 1000;
    while (!predicate() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.ok(predicate(), message);
}

function createSession(overrides?: {
    runtimeState?: ReturnType<typeof createFocusTreeRuntimeState>;
    buildBaseState?: (document: vscode.TextDocument, assetLoadMode: 'full' | 'deferred', isCancelled?: () => boolean, assetScope?: FocusTreeAssetScope) => Promise<FocusTreeRenderBaseState>;
    createFullSnapshot?: (baseState: any, previousCache: any, isCancelled?: () => boolean) => Promise<any>;
    renderShell?: (documentVersion: number) => string;
    latestDocument?: vscode.TextDocument | undefined;
    deferredHydrationDelayMs?: number;
    isInitialFullLoadReady?: () => boolean;
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
        isInitialFullLoadReady: overrides?.isInitialFullLoadReady,
        snapshotBuilder: {
            renderShell: overrides?.renderShell ?? (documentVersion => `shell:${documentVersion}`),
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
                    focusTemplates: {},
            focusTemplateKeyById: {},
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

async function createScopedConsumerSession(version: number) {
    let sourceText = `
        focus_tree = { id = A focus = { id = FOCUS_A icon = GFX_A x = 0 y = 0 } }
        focus_tree = { id = B focus = { id = FOCUS_B icon = GFX_B x = 1 y = 0 } }
    `;
    let trees = getFocusTree(parseHoi4File(sourceText), [], 'common/national_focus/test.txt');
    const assetRequests: string[][] = [];
    let waitForSecondTree: Promise<void> | undefined;
    let cancelledSecondTree: (() => boolean) | undefined;
    const document = createDocument(version);
    const fixture = createSession({
        latestDocument: document,
        buildBaseState: async (currentDocument, mode, isCancelled, scope) => {
            const selected = scope?.treeId ?? 'A';
            const ids = Array.from(new Set([selected, ...scope?.treeIds ?? []]));
            assetRequests.push(ids);
            if (selected === 'B' && waitForSecondTree) {
                cancelledSecondTree = isCancelled;
                await waitForSecondTree;
            }
            trees = getFocusTree(parseHoi4File(sourceText), [], 'common/national_focus/test.txt');
            const allFocuses = trees.flatMap(tree => Object.values(tree.focuses));
            return {
                ...createBaseState(currentDocument.version, mode === 'deferred'),
                focusTrees: trees,
                allFocuses,
                focusById: Object.fromEntries(allFocuses.map(focus => [focus.id, focus])),
                assetTreeIds: ids,
                hasFocusSelector: true,
                focusIconStyleSignature: JSON.stringify(allFocuses.map(focus => focus.icon)),
            };
        },
        createFullSnapshot: async (baseState, previousCache) => {
            const ids: string[] = baseState.assetTreeIds;
            const focuses = trees.filter(tree => ids.includes(tree.id)).flatMap(tree => Object.values(tree.focuses));
            const keyById = Object.fromEntries(focuses.map(focus => [focus.id, focus.id]));
            const templates = Object.fromEntries(focuses.map(focus => [
                focus.id, `<div>${focus.id}</div>`,
            ]));
            // Asset production is deterministic here; the session consumes real render caches.
            const payload = {
                ...baseState,
                focusTrees: toFocusTreeViews(trees),
                sourceFocusTrees: trees,
                selectedTreeId: ids[0],
                focusTemplates: templates,
                focusTemplateKeyById: keyById,
                renderedInlayWindows: {},
                dynamicStyleCss: ids.map(id => `.${id} {}`).join('\n'),
                dynamicStyleRules: new Map<string, string>(),
            } as unknown as FocusTreeRenderPayload;
            const { update, cache } = createFullFocusTreeRenderUpdate(payload, previousCache);
            return { payload, update, cache, metrics: { renderedFocusCount: focuses.length } };
        },
    });
    fixture.runtimeState.lastRenderCache = createFocusTreeRenderCache({
        ...createBaseState(version, false),
        focusTrees: toFocusTreeViews(trees),
        sourceFocusTrees: trees,
        selectedTreeId: 'A',
        assetTreeIds: ['A'],
        focusTemplates: { FOCUS_A: '<div>FOCUS_A</div>' },
        focusTemplateKeyById: { FOCUS_A: 'FOCUS_A' },
        renderedInlayWindows: {},
        dynamicStyleCss: '.A {}',
        dynamicStyleRules: new Map<string, string>(),
        hasFocusSelector: true,
    } as unknown as FocusTreeRenderPayload);
    fixture.session.handleWebviewReady('A');
    await fixture.session.refreshDocument(document, { assetLoadMode: 'full' });
    return {
        ...fixture, document, assetRequests,
        blockSecondTree: (promise: Promise<void>) => { waitForSecondTree = promise; },
        isSecondTreeCancelled: () => cancelledSecondTree?.() ?? false,
        changeFirstIcon: () => { sourceText = sourceText.replace('GFX_A', 'GFX_A_EDITED'); },
    };
}

describe('focustree preview session', () => {
    it('lazily hydrates disjoint tree assets, reuses them on return, and refreshes all loaded scenes after an edit', async () => {
        const fixture = await createScopedConsumerSession(60);
        assert.deepStrictEqual(fixture.assetRequests, [['A']]);
        assert.deepStrictEqual(Object.keys(fixture.runtimeState.lastRenderCache?.focusTemplateKeyById ?? {}), ['FOCUS_A']);
        await fixture.session.handleSceneRequest('B');
        assert.deepStrictEqual(fixture.assetRequests, [['A'], ['B']]);
        assert.deepStrictEqual(Object.keys(fixture.runtimeState.lastRenderCache?.focusRenderSignatures ?? {}).sort(), ['FOCUS_A', 'FOCUS_B']);
        const second = fixture.postMessages.at(-1);
        assert.deepStrictEqual(second.catalog.map((tree: { id: string }) => tree.id), ['A', 'B']);
        assert.strictEqual(second.focusTemplates.FOCUS_B, '<div>FOCUS_B</div>');
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.focusTemplates.FOCUS_A, '<div>FOCUS_A</div>');
        await fixture.session.handleSceneRequest('A');
        assert.deepStrictEqual(fixture.assetRequests, [['A'], ['B']], 'Returning to a hydrated tree must not prepare assets again');
        assert.strictEqual(fixture.postMessages.at(-1).focusTemplates.FOCUS_A, '<div>FOCUS_A</div>');
        const updated = createDocument(61);
        fixture.changeFirstIcon();
        fixture.latestDocument.current = updated;
        await fixture.session.refreshDocument(updated, { assetLoadMode: 'full' });
        assert.deepStrictEqual(fixture.assetRequests.at(-1), ['A', 'B']);
        const firstAfterEdit = fixture.runtimeState.lastRenderCache?.focusTrees.find(tree => tree.id === 'A');
        assert.strictEqual(firstAfterEdit?.focuses.FOCUS_A.icon[0].icon, 'GFX_A_EDITED');
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.focusTemplates.FOCUS_B, '<div>FOCUS_B</div>');
        fixture.session.dispose();
    });

    it('keeps client-local return selection across an in-flight scene and a structural refresh', async () => {
        const fixture = await createScopedConsumerSession(62);
        let releaseSecond: () => void = () => undefined;
        fixture.blockSecondTree(new Promise<void>(resolve => { releaseSecond = resolve; }));
        const request = fixture.session.handleSceneRequest('B');
        releaseSecond();
        await request;
        const merged = fixture.postMessages.at(-1);
        assert.deepStrictEqual(merged.focusTrees.map((tree: { id: string }) => tree.id), ['A', 'B'],
            'Both loaded scenes let the existing consumer preserve a local return to A');
        let selectedTreeId: string | undefined = 'A';
        const consumer: FocusTreeMessageApplyContext = {
            getSnapshotVersion: () => 0, setSnapshotVersion: () => undefined,
            getDocumentVersion: () => 0, setDocumentVersion: () => undefined,
            setFocusPositionActiveFile: () => undefined,
            getCurrentSelectionTreeId: () => selectedTreeId,
            setSelectedFocusTreeById: id => { selectedTreeId = id; },
            setFocusTrees: () => undefined, applyFocusTreePatches: () => undefined,
            setFocusTemplates: () => undefined, patchFocusTemplates: () => undefined,
            setRenderedInlayWindows: () => undefined, patchRenderedInlayWindows: () => undefined,
            refreshFocusTreeSelectorOptions: () => undefined, refreshWarningsButtonVisibility: () => undefined,
            setGridBox: () => undefined, setGridSizeX: () => undefined, setGridSizeY: () => undefined,
            replaceDynamicStyleCss: () => undefined,
        };
        assert.strictEqual(applyFocusTreeContentUpdate(merged, consumer), true);
        assert.strictEqual(selectedTreeId, 'A', 'Late hydration must not override a cached client-local switch');
        // The client changes back to A without a second host request.
        const updated = createDocument(63);
        fixture.changeFirstIcon();
        fixture.latestDocument.current = updated;
        await fixture.session.refreshDocument(updated, { assetLoadMode: 'full' });
        const refreshed = fixture.postMessages.at(-1);
        if (refreshed.focusTrees) {
            assert.deepStrictEqual(refreshed.focusTrees.map((tree: { id: string }) => tree.id), ['A', 'B']);
        }
        assert.strictEqual(applyFocusTreeContentUpdate(refreshed, consumer), true);
        assert.strictEqual(selectedTreeId, 'A', 'Invalidation must preserve the current client selection');
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.focusTrees.find(tree => tree.id === 'A')?.focuses.FOCUS_A.icon[0].icon, 'GFX_A_EDITED');
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.focusTemplates.FOCUS_B, '<div>FOCUS_B</div>');
        fixture.session.dispose();
    });
    it('hydrates already visible deferred scenes when switching before initial assets are ready', async () => {
        const fixture = await createScopedConsumerSession(65);
        const cache = fixture.runtimeState.lastRenderCache;
        assert.ok(cache);
        cache.deferredAssetLoad = true;
        cache.focusTemplates = {};
        cache.focusTemplateKeyById = {};
        await fixture.session.handleSceneRequest('B');
        assert.deepStrictEqual(fixture.assetRequests.at(-1), ['B', 'A']);
        const scene = fixture.postMessages.at(-1);
        assert.deepStrictEqual(scene.focusTrees.map((tree: { id: string }) => tree.id), ['A', 'B']);
        assert.strictEqual(scene.focusTemplates.FOCUS_A, '<div>FOCUS_A</div>');
        assert.strictEqual(scene.focusTemplates.FOCUS_B, '<div>FOCUS_B</div>');
        fixture.session.dispose();
    });


    it('does not publish or cache a stale lazy hydration after a rapid switch back', async () => {
        const fixture = await createScopedConsumerSession(64);
        let releaseSecond: () => void = () => undefined;
        fixture.blockSecondTree(new Promise<void>(resolve => { releaseSecond = resolve; }));
        const request = fixture.session.handleSceneRequest('B');
        await fixture.session.handleSceneRequest('A');
        assert.strictEqual(fixture.isSecondTreeCancelled(), true);
        const messageCount = fixture.postMessages.length;
        releaseSecond();
        await request;
        assert.strictEqual(fixture.postMessages.length, messageCount);
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.selectedTreeId, 'A');
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.assetTreeIds, ['A']);
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.focusTemplates.FOCUS_B, undefined);
        fixture.session.dispose();
    });

    beforeEach(() => {
        (localisationIndex as any).isLocalisationIndexReady = () => false;
        (localisationIndex as any).whenLocalisationIndexReady = () => pendingLocalisationReady;
        (featureFlags as any).isLocalisationIndexEnabled = () => true;
    });

    afterEach(() => {
        (localisationIndex as any).isLocalisationIndexReady = originalIsLocalisationIndexReady;
        (localisationIndex as any).whenLocalisationIndexReady = originalWhenLocalisationIndexReady;
        (featureFlags as any).isLocalisationIndexEnabled = originalIsLocalisationIndexEnabled;
    });

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

    it('always uses a structure-first deferred initial snapshot regardless of index readiness', async () => {
        const requestedModes: Array<'full' | 'deferred'> = [];
        const first = createSession({
            isInitialFullLoadReady: () => false,
            buildBaseState: async (document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });

        await first.session.initializePanel(createDocument(40));
        assert.deepStrictEqual(requestedModes, ['deferred']);
        first.session.dispose();

        requestedModes.length = 0;
        const second = createSession({
            isInitialFullLoadReady: () => true,
            buildBaseState: async (document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });

        await second.session.initializePanel(createDocument(41));
        assert.deepStrictEqual(requestedModes, ['deferred']);
        second.session.dispose();
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
        await waitForCondition(
            () => postMessages.some(message => (message as any).command === 'focusTreeScene'),
            'Expected a snapshot update after the webview became ready.',
        );

        assert.strictEqual(webview.html, 'shell:6');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeScene'));
        assert.strictEqual(sessionState.lastRenderCache?.snapshotVersion, 1);
        assert.strictEqual(sessionState.webviewReady, true);
    });

    it('sends only the selected scene initially and loads another catalog scene on request', async () => {
        const document = createDocument(42);
        const firstTree = createTreeView('first_tree', 'FIRST');
        const secondTree = createTreeView('second_tree', 'SECOND');
        const sourceTrees = getFocusTree(parseHoi4File(`
            focus_tree = { id = first_tree focus = { id = FIRST x = 0 y = 0 } }
            focus_tree = { id = second_tree focus = { id = SECOND x = 0 y = 0 } }
        `), [], 'common/national_focus/test.txt');
        const { session, postMessages } = createSession({
            deferredHydrationDelayMs: 10_000,
            createFullSnapshot: async baseState => ({
                payload: { focusPositionDocumentVersion: baseState.focusPositionDocumentVersion },
                update: {
                    updateType: 'structure',
                    snapshotVersion: 1,
                    documentVersion: baseState.focusPositionDocumentVersion,
                    selectedTreeId: 'first_tree',
                    changedSlots: ['treeDefinitions', 'selector', 'warnings', 'treeBody', 'inlays', 'layout', 'styleDeps'],
                    changedTreeIds: ['first_tree', 'second_tree'],
                    structurallyChangedTreeIds: ['first_tree', 'second_tree'],
                    changedFocusIds: ['FIRST', 'SECOND'],
                    focusTrees: [firstTree, secondTree],
                    focusTemplates: { first: '<div>first</div>', second: '<div>second</div>' },
                    focusTemplateKeyById: { FIRST: 'first', SECOND: 'second' },
                    renderedInlayWindows: {},
                    gridBox: baseState.gridBox,
                    dynamicStyleCss: '',
                    xGridSize: 96,
                    yGridSize: 130,
                },
                cache: createFocusTreeRenderCache({
                    ...baseState,
                    focusTrees: [firstTree, secondTree],
                    sourceFocusTrees: sourceTrees,
                    selectedTreeId: 'first_tree',
                    focusTemplates: { first: '<div>first</div>', second: '<div>second</div>' },
                    focusTemplateKeyById: { FIRST: 'first', SECOND: 'second' },
                    renderedInlayWindows: {},
                    dynamicStyleCss: '',
                    hasFocusSelector: true,
                    deferredAssetLoad: baseState.deferredAssetLoad,
                } as unknown as FocusTreeRenderPayload),
                metrics: { focusCount: 2, inlayCount: 0, deferredAssetLoad: baseState.deferredAssetLoad },
            }) as any,
        });

        await session.initializePanel(document);
        session.handleWebviewReady('first_tree');
        await waitForCondition(() => postMessages.length === 1, 'Expected the selected initial scene.');

        assert.deepStrictEqual(postMessages[0].focusTrees.map((tree: any) => tree.id), ['first_tree']);
        assert.deepStrictEqual(postMessages[0].catalog.map((tree: any) => tree.id), ['first_tree', 'second_tree']);
        assert.deepStrictEqual(postMessages[0].focusTemplateKeyById, { FIRST: 'first' });
        assert.deepStrictEqual(Object.keys(postMessages[0].focusTemplates), ['first']);

        await session.handleSceneRequest('second_tree');
        assert.strictEqual(postMessages[1].sceneMode, 'merge');
        assert.deepStrictEqual(postMessages[1].focusTrees.map((tree: any) => tree.id), ['second_tree']);
        assert.deepStrictEqual(postMessages[1].focusTemplateKeyById, { SECOND: 'second' });
        assert.deepStrictEqual(Object.keys(postMessages[1].focusTemplates), ['second']);
        session.dispose();
    });

    it('catches cancellation when a pending-ready snapshot is disposed during planning', async () => {
        const document = createDocument(29);
        const runtimeState = createFocusTreeRuntimeState();
        const { session, postMessages } = createSession({ runtimeState });

        await session.initializePanel(document);
        await waitForCondition(
            () => runtimeState.pendingReadyBaseState !== undefined,
            'Expected a pending base state before webview ready.',
        );
        session.handleWebviewReady();
        session.dispose();
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.deepStrictEqual(postMessages, []);
    });

    it('adds timing metadata to content update messages', async () => {
        const document = createDocument(22);
        const runtimeState = createFocusTreeRuntimeState();
        const { session, postMessages } = createSession({ runtimeState });

        await session.initializePanel(document);
        session.handleWebviewReady();
        await waitForCondition(
            () => postMessages.some(message => (message as any).command === 'focusTreeScene'),
            'Expected a snapshot update with timing metadata.',
        );

        const contentUpdate = postMessages.find(message => (message as any).command === 'focusTreeScene') as any;
        assert.ok(contentUpdate);
        assert.strictEqual(contentUpdate.perf.source, 'initialize');
        assert.strictEqual(contentUpdate.perf.assetLoadMode, 'deferred');
        assert.strictEqual(contentUpdate.perf.updateKind, 'full');
        assert.strictEqual(contentUpdate.perf.payloadBytes, 0);
        assert.strictEqual(contentUpdate.protocolVersion, focusTreeProtocolVersion);
        assert.strictEqual(typeof contentUpdate.requestId, 'number');
        assert.strictEqual(contentUpdate.perf.changedSlotCount, contentUpdate.changedSlots.length);
    });

    it('starts deferred hydration when the webview acknowledges first content', async () => {
        const document = createDocument(23);
        const requestedModes: Array<'full' | 'deferred'> = [];
        const { session, postMessages } = createSession({
            deferredHydrationDelayMs: 10_000,
            buildBaseState: async (_document, assetLoadMode) => {
                requestedModes.push(assetLoadMode);
                return createBaseState(document.version, assetLoadMode === 'deferred');
            },
        });

        await session.initializePanel(document);
        session.handleWebviewReady();
        await waitForCondition(
            () => postMessages.some(message => (message as any).command === 'focusTreeScene'),
            'Expected the deferred content update.',
        );
        const firstUpdate = postMessages[0] as any;
        session.handleContentApplied(firstUpdate.snapshotVersion, firstUpdate.documentVersion, 'firstScenePainted');
        await waitForCondition(() => requestedModes.length === 2, 'Expected acknowledgement-driven hydration.');

        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);
        session.dispose();
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
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeScene'));
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

    it('does not let a stale postMessage completion overwrite the latest render cache', async () => {
        const firstDocument = createDocument(27);
        const secondDocument = createDocument(28);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let resolveFirstPostStarted: (() => void) | undefined;
        const firstPostStarted = new Promise<void>(resolve => {
            resolveFirstPostStarted = resolve;
        });
        let releaseFirstPost: (() => void) | undefined;
        const firstPostGate = new Promise<void>(resolve => {
            releaseFirstPost = resolve;
        });
        const { session, webview, postMessages, latestDocument } = createSession({
            runtimeState,
            latestDocument: firstDocument,
        });
        webview.postMessage = async message => {
            postMessages.push(message);
            if ((message as any).documentVersion === firstDocument.version) {
                resolveFirstPostStarted?.();
                await firstPostGate;
            }
            return true;
        };

        const firstRefresh = session.refreshDocument(firstDocument);
        await firstPostStarted;
        latestDocument.current = secondDocument;
        const secondRefresh = session.refreshDocument(secondDocument);
        releaseFirstPost?.();
        await Promise.all([firstRefresh, secondRefresh]);

        assert.strictEqual(runtimeState.lastRenderCache?.focusPositionDocumentVersion, secondDocument.version);
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

    it('signals cancellation to an in-flight base-state build when disposed', async () => {
        const document = createDocument(24);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let resolveBuildStarted: (() => void) | undefined;
        const buildStarted = new Promise<void>(resolve => {
            resolveBuildStarted = resolve;
        });
        let observedCancellation = false;
        const { session, postMessages } = createSession({
            runtimeState,
            latestDocument: document,
            buildBaseState: async (_document, _assetLoadMode, isCancelled) => {
                resolveBuildStarted?.();
                while (!isCancelled?.()) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                observedCancellation = true;
                throw new UserError('cancelled disposed build');
            },
        });

        const refresh = session.refreshDocument(document);
        await buildStarted;
        session.dispose();
        session.dispose();
        await refresh;

        assert.strictEqual(observedCancellation, true);
        assert.strictEqual(runtimeState.latestRefreshRequestId, 2);
        assert.strictEqual(runtimeState.webviewReady, false);
        assert.deepStrictEqual(postMessages, []);
    });

    it('signals cancellation to an in-flight full snapshot build when disposed', async () => {
        const document = createDocument(26);
        const runtimeState = createFocusTreeRuntimeState();
        runtimeState.webviewReady = true;
        let resolveSnapshotStarted: (() => void) | undefined;
        const snapshotStarted = new Promise<void>(resolve => {
            resolveSnapshotStarted = resolve;
        });
        let observedCancellation = false;
        const { session, postMessages } = createSession({
            runtimeState,
            latestDocument: document,
            createFullSnapshot: async (_baseState, _previousCache, isCancelled) => {
                resolveSnapshotStarted?.();
                while (!isCancelled?.()) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                observedCancellation = true;
                throw new UserError('cancelled disposed snapshot');
            },
        });

        const refresh = session.refreshDocument(document);
        await snapshotStarted;
        session.dispose();
        await refresh;

        assert.strictEqual(observedCancellation, true);
        assert.strictEqual(runtimeState.lastRenderCache, undefined);
        assert.deepStrictEqual(postMessages, []);
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
        await waitForCondition(
            () => postMessages.some(message => (message as any).command === 'focusTreeScene'),
            'Expected the local edit reconciliation snapshot.',
        );

        assert.strictEqual(updatedVersion, 12);
        assert.strictEqual(webview.html, '');
        assert.ok(postMessages.some(message => (message as any).command === 'focusTreeScene'));
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
            focusTemplates: {},
            focusTemplateKeyById: {},
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
        await waitForCondition(
            () => postMessages.filter(message => (message as any).command === 'focusTreeScene').length === 1,
            'Expected the deferred snapshot before hydration.',
        );

        assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeScene').length, 1);
        await waitForCondition(
            () => requestedModes.length === 2,
            'Expected full hydration to start after the deferred snapshot.',
        );
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);

        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);
        resolveFull?.(createBaseState(document.version, false));
        await waitForCondition(
            () => postMessages.filter(message => (message as any).command === 'focusTreeScene').length === 2,
            'Expected the hydrated snapshot update.',
        );

        assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeScene').length, 2);
        assert.deepStrictEqual(requestedModes, ['deferred', 'full']);
    });

    it('cancels scheduled hydration and localisation-ready refresh when disposed', async () => {
        const originalIsLocalisationIndexReady = localisationIndex.isLocalisationIndexReady;
        const originalWhenLocalisationIndexReady = localisationIndex.whenLocalisationIndexReady;
        let resolveLocalisationReady: (() => void) | undefined;
        const localisationReady = new Promise<void>(resolve => {
            resolveLocalisationReady = resolve;
        });
        (localisationIndex as any).isLocalisationIndexReady = () => false;
        (localisationIndex as any).whenLocalisationIndexReady = () => localisationReady;

        try {
            const document = createDocument(25);
            const requestedModes: Array<'full' | 'deferred'> = [];
            const { session, postMessages } = createSession({
                deferredHydrationDelayMs: 20,
                buildBaseState: async (_document, assetLoadMode) => {
                    requestedModes.push(assetLoadMode);
                    return createBaseState(document.version, assetLoadMode === 'deferred');
                },
            });

            await session.initializePanel(document);
            session.handleWebviewReady();
            await waitForCondition(
                () => postMessages.some(message => (message as any).command === 'focusTreeScene'),
                'Expected the deferred snapshot before disposal.',
            );

            assert.deepStrictEqual(requestedModes, ['deferred']);
            assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeScene').length, 1);

            session.dispose();
            session.dispose();
            resolveLocalisationReady?.();
            await new Promise(resolve => setTimeout(resolve, 40));

            assert.deepStrictEqual(requestedModes, ['deferred']);
            assert.strictEqual(postMessages.filter(message => (message as any).command === 'focusTreeScene').length, 1);
        } finally {
            (localisationIndex as any).isLocalisationIndexReady = originalIsLocalisationIndexReady;
            (localisationIndex as any).whenLocalisationIndexReady = originalWhenLocalisationIndexReady;
        }
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
        await waitForCondition(
            () => postMessages.some(message => (message as any).documentVersion === initialDocument.version),
            'Expected the initial deferred snapshot before the later IDE refresh.',
        );

        latestDocument.current = updatedDocument;
        const refreshPromise = session.refreshDocument(updatedDocument);
        resolveFullInitial?.(createBaseState(initialDocument.version, false));
        resolveUpdatedDeferred?.(createBaseState(updatedDocument.version, true));
        await refreshPromise;
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        const contentUpdates = postMessages.filter(message => (message as any).command === 'focusTreeScene');
        assert.ok(contentUpdates.some(message => (message as any).documentVersion === 17));
        assert.ok(contentUpdates.some(message => (message as any).documentVersion === 18));
        assert.strictEqual((contentUpdates.at(-1) as any).documentVersion, 18);
    });
});
