import * as assert from 'assert';
import Module = require('module');
import * as vscode from 'vscode';
import type { FocusTreeAssetScope } from '../../src/previewdef/focustree/loader';
import type {
    FocusTreeAssetStylePatch,
    FocusTreeAssetStylePatchOptions,
    FocusTreeRenderBaseState,
    FocusTreeRenderPayload,
} from '../../src/previewdef/focustree/contentbuilder';
import type * as FocusSchemaModule from '../../src/previewdef/focustree/schema';
import type * as HoiParserModule from '../../src/hoiformat/hoiparser';
import type * as RenderPatchModule from '../../src/previewdef/focustree/renderpayloadpatch';
import type * as FocusViewModule from '../../src/previewdef/focustree/viewmodel';
import type * as FocusIconAssetsModule from '../../src/previewdef/focustree/focusicongfx';
import type * as StyleSyncModule from '../../src/previewdef/focustree/stylesync';
import type * as AssetDemandModule from '../../webviewsrc/focustree/assetdemand';
import type {
    FocusTreeAssetMaterialization,
    FocusTreeAssetRequestMessage,
    FocusTreeSceneAssetsStatus,
    FocusTreeStyleSync,
} from '../../src/previewdef/focustree/webviewupdate';
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
    createFullSnapshot?: (
        baseState: any,
        previousCache: any,
        isCancelled?: () => boolean,
        onAssetStyleBatch?: unknown,
        prepared?: unknown,
        materializedFocusIds?: readonly string[],
        existingStyleRules?: ReadonlyMap<string, string>,
    ) => Promise<any>;
    renderAssetPatch?: (focuses: readonly any[], options: FocusTreeAssetStylePatchOptions) => Promise<FocusTreeAssetStylePatch>;
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
            renderAssetPatch: overrides?.renderAssetPatch,
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
                    dynamicStyleRules: new Map<string, string>(),
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
            dynamicStyleRules: new Map([['hydrated-icons', '']]),
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

const { FocusTreeInvalidation } = require('../../src/previewdef/focustree/invalidation') as typeof import('../../src/previewdef/focustree/invalidation');
const { FocusAssetMaterializationState } = require('../../webviewsrc/focustree/assetdemand') as typeof AssetDemandModule;
const { FocusTreeStyleReceiver } = require('../../src/previewdef/focustree/stylesync') as typeof StyleSyncModule;

function serializeRules(rules: Iterable<readonly [string, string]>): string {
    return Array.from(rules).map(([key, content]) => `.${key} { ${content} }\n`).join('');
}

/** Rules of serialized test CSS, in order; the fixtures' rule bodies contain no braces. */
function parseRules(css: string): Array<[selector: string, content: string]> {
    return Array.from(css.matchAll(/\.([^\s{]+) \{\s*([^}]*?)\s*\}/g), match => [match[1], match[2]]);
}

/**
 * A webview stylesheet as `stylesheet.ts` keeps it: a full sync replaces every rule, and an
 * appended rule replaces the earlier rule of its selector.
 */
function createWebviewStyleSheet() {
    const rules = new Map<string, string>();
    const transported: Array<{ kind: 'replace' | 'append'; css: string }> = [];
    return {
        rules,
        transported,
        target: {
            replace(css: string) {
                transported.push({ kind: 'replace', css });
                rules.clear();
                parseRules(css).forEach(([selector, content]) => rules.set(selector, content));
            },
            append(css: string) {
                transported.push({ kind: 'append', css });
                parseRules(css).forEach(([selector, content]) => {
                    rules.delete(selector);
                    rules.set(selector, content);
                });
            },
        },
    };
}

/** The fields of a posted message that change the webview's stylesheet and materialized focuses. */
interface PostedAssetMessage {
    command?: string;
    style?: FocusTreeStyleSync;
    status?: FocusTreeSceneAssetsStatus;
    materializedFocusIds?: string[];
    assetMaterialization?: FocusTreeAssetMaterialization;
}

/**
 * What the webview holds after the posted messages, applied like `hostsync`: every style sync in
 * arrival order, scene and full updates replacing the materialized set, patches adding to it.
 */
function getWebviewAssetState(messages: readonly PostedAssetMessage[]) {
    const sheet = createWebviewStyleSheet();
    const resyncRequests: number[] = [];
    const receiver = new FocusTreeStyleReceiver(sheet.target, () => resyncRequests.push(resyncRequests.length));
    const materialization = new FocusAssetMaterializationState();
    for (const message of messages) {
        receiver.apply(message.style);
        if (message.command === 'focusTreeSceneAssets') {
            if (message.status === 'applied') {
                materialization.add(message.materializedFocusIds ?? []);
            }
            continue;
        }
        if (message.assetMaterialization) {
            materialization.replace(message.assetMaterialization);
        }
    }
    return { rules: sheet.rules, transported: sheet.transported, resyncRequests, materialization, receiver };
}

/**
 * A session whose snapshots render each materialized focus as a real icon rule and every other
 * focus of the asset trees as a placeholder rule. Like the real style table, rules are keyed by
 * icon name, real rules win over placeholders of the same name, and placeholders skip names the
 * merged scenes already have. D1 of tree D shares A1's icon.
 */
function createAssetFixture(version: number) {
    const trees = getFocusTree(parseHoi4File(`
        focus_tree = { id = A
            focus = { id = A1 icon = GFX_A1 x = 0 y = 0 }
            focus = { id = A2 icon = GFX_A2 x = 1 y = 0 }
            focus = { id = A3 icon = GFX_A3 x = 2 y = 0 }
        }
        focus_tree = { id = B
            focus = { id = B1 icon = GFX_B1 x = 0 y = 0 }
            focus = { id = B2 icon = GFX_B2 x = 1 y = 0 }
        }
        focus_tree = { id = C focus = { id = C1 icon = GFX_C1 x = 0 y = 0 } }
        focus_tree = { id = D
            focus = { id = D1 icon = GFX_A1 x = 0 y = 0 }
            focus = { id = D2 icon = GFX_D2 x = 1 y = 0 }
        }
    `), [], 'common/national_focus/test.txt');
    const allFocuses = trees.flatMap(tree => Object.values(tree.focuses));
    const focusById = Object.fromEntries(allFocuses.map(focus => [focus.id, focus]));
    const document = createDocument(version);
    const fullSnapshotCalls: Array<{ treeIds: string[]; materializedFocusIds: readonly string[] | undefined; deferred: boolean }> = [];
    const patchCalls: Array<{ focusIds: string[]; resend: string[] }> = [];
    const gates: { fullBaseState?: Promise<void>; assetPatch?: Promise<void> } = {};
    let fullBaseStateCalls = 0;
    let iconStyleSignature = 'icons-1';
    /** Whether a base state finishing now was built with the localisation index ready. */
    let baseStateLocalised = false;
    const iconName = (focusId: string) => focusById[focusId].icon[0].icon!;
    const iconRuleKey = (focusId: string) => `st-focus-icon-${iconName(focusId)}`;
    // Changed icon textures change the decoded rule, like a new image body would.
    const realRule = (focusId: string) => `real:${iconName(focusId).replace(/^GFX_/, '')}${iconStyleSignature === 'icons-1' ? '' : `@${iconStyleSignature}`};`;
    const fixture = createSession({
        latestDocument: document,
        deferredHydrationDelayMs: 10_000,
        buildBaseState: async (currentDocument, mode, _isCancelled, scope) => {
            if (mode === 'full') {
                fullBaseStateCalls += 1;
                await gates.fullBaseState;
            }
            const assetTreeIds = Array.from(new Set([scope?.treeId ?? 'A', ...scope?.treeIds ?? []]));
            const assetFocuses = trees.filter(tree => assetTreeIds.includes(tree.id)).flatMap(tree => Object.values(tree.focuses));
            return {
                ...createBaseState(currentDocument.version, mode === 'deferred'),
                focusTrees: trees,
                allFocuses,
                focusById: Object.fromEntries(allFocuses.map(focus => [focus.id, focus])),
                assetTreeIds,
                hasFocusSelector: true,
                focusIconAssetResolution: {
                    ...createEmptyFocusIconAssetResolution(),
                    gfxFileByIconName: mode === 'full'
                        ? Object.fromEntries(assetFocuses.map(focus => [`GFX_${focus.id}`, 'interface/goals.gfx']))
                        : {},
                },
                focusIconStyleSignature: mode === 'full' ? iconStyleSignature : '',
                localisationIndexReady: baseStateLocalised,
            };
        },
        createFullSnapshot: async (baseState, previousCache, _isCancelled, _onAssetStyleBatch, _prepared, materializedFocusIds, existingStyleRules) => {
            const assetTreeIds: string[] = baseState.assetTreeIds;
            const assetFocusIds = trees.filter(tree => assetTreeIds.includes(tree.id)).flatMap(tree => Object.keys(tree.focuses));
            fullSnapshotCalls.push({ treeIds: assetTreeIds, materializedFocusIds, deferred: baseState.deferredAssetLoad });
            const materialized = baseState.deferredAssetLoad
                ? []
                : Array.from(new Set(materializedFocusIds ?? assetFocusIds)).filter(focusId => assetFocusIds.includes(focusId));
            const rules = new Map<string, string>();
            materialized.forEach(focusId => {
                if (!rules.has(iconRuleKey(focusId))) {
                    rules.set(iconRuleKey(focusId), realRule(focusId));
                }
            });
            assetFocusIds.filter(focusId => !materialized.includes(focusId)).forEach(focusId => {
                if (!rules.has(iconRuleKey(focusId)) && !existingStyleRules?.has(iconRuleKey(focusId))) {
                    rules.set(iconRuleKey(focusId), 'placeholder;');
                }
            });
            const payload = {
                ...baseState,
                focusTrees: toFocusTreeViews(trees),
                sourceFocusTrees: trees,
                selectedTreeId: assetTreeIds[0],
                materializedFocusIds: materialized,
                focusTemplates: {},
                focusTemplateKeyById: {},
                renderedInlayWindows: {},
                dynamicStyleCss: serializeRules(rules),
                dynamicStyleRules: rules,
            } as unknown as FocusTreeRenderPayload;
            const { update, cache } = createFullFocusTreeRenderUpdate(payload, previousCache);
            return {
                payload,
                update,
                cache,
                metrics: { renderedFocusCount: assetFocusIds.length, materializedFocusCount: materialized.length },
            };
        },
        renderAssetPatch: async (focuses, options) => {
            patchCalls.push({ focusIds: focuses.map(focus => focus.id), resend: Array.from(options.resendFocusIds ?? []) });
            await gates.assetPatch;
            const rules = new Map<string, string>();
            focuses
                .filter(focus => options.resendFocusIds?.has(focus.id)
                    || options.existingStyleRules.get(iconRuleKey(focus.id)) !== realRule(focus.id))
                .forEach(focus => rules.set(iconRuleKey(focus.id), realRule(focus.id)));
            return { rules: Array.from(rules) };
        },
    });
    const sceneAssets = (assetRequestId?: number) => fixture.postMessages
        .filter(message => message.command === 'focusTreeSceneAssets'
            && (assetRequestId === undefined || message.assetRequestId === assetRequestId));
    const request = (assetRequestId: number, visibleFocusIds: string[], nearbyFocusIds: string[] = [], overrides: Partial<FocusTreeAssetRequestMessage> = {}) =>
        fixture.session.handleAssetRequest({
            command: 'focusTreeAssetRequest',
            protocolVersion: focusTreeProtocolVersion,
            assetRequestId,
            treeId: 'A',
            snapshotVersion: fixture.runtimeState.lastRenderCache?.snapshotVersion ?? 0,
            documentVersion: document.version,
            visibleFocusIds,
            nearbyFocusIds,
            ...overrides,
        });
    const finalResponse = async (assetRequestId: number) => {
        await waitForCondition(() => sceneAssets(assetRequestId).some(message => message.final), `Expected a final answer to asset request ${assetRequestId}.`);
        return sceneAssets(assetRequestId);
    };
    const paintStructure = async () => {
        await fixture.session.initializePanel(document);
        fixture.session.handleWebviewReady('A');
        await waitForCondition(() => fixture.postMessages.some(message => message.command === 'focusTreeScene'), 'Expected the structural scene.');
        return fixture.postMessages.find(message => message.command === 'focusTreeScene');
    };
    const hydrate = async (visibleFocusIds: string[]) => {
        const structural = await paintStructure();
        fixture.session.handleContentApplied(structural.snapshotVersion, structural.documentVersion, 'firstScenePainted', visibleFocusIds);
        await waitForCondition(() => fixture.runtimeState.lastRenderCache?.deferredAssetLoad === false, 'Expected visible-first hydration.');
        return { structural, hydrated: fixture.postMessages.at(-1) };
    };
    return {
        ...fixture,
        document,
        fullSnapshotCalls,
        patchCalls,
        gates,
        sceneAssets,
        request,
        finalResponse,
        paintStructure,
        hydrate,
        iconRuleKey,
        realRule,
        getFullBaseStateCalls: () => fullBaseStateCalls,
        setIconStyleSignature: (value: string) => { iconStyleSignature = value; },
        setBaseStateLocalised: (value: boolean) => { baseStateLocalised = value; },
    };
}

describe('focustree preview session visible-first assets', () => {
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

    it('hydrates the selected scene with only the focuses the first paint showed', async () => {
        const fixture = createAssetFixture(100);
        const structural = await fixture.paintStructure();
        assert.deepStrictEqual(structural.assetMaterialization, { deferred: true, focusIds: [] });
        await fixture.request(1, ['A1']);
        const beforeHydration = await fixture.finalResponse(1);
        assert.deepStrictEqual(beforeHydration.map(message => message.status), ['stale'], 'structural scenes have no assets to extend');

        fixture.session.handleContentApplied(structural.snapshotVersion, structural.documentVersion, 'firstScenePainted', ['A2', 'A1']);
        await waitForCondition(() => fixture.runtimeState.lastRenderCache?.deferredAssetLoad === false, 'Expected visible-first hydration.');
        const hydrated = fixture.postMessages.at(-1);
        assert.deepStrictEqual(fixture.fullSnapshotCalls.at(-1), { treeIds: ['A'], materializedFocusIds: ['A2', 'A1'], deferred: false });
        assert.deepStrictEqual(hydrated.assetMaterialization, { deferred: false, focusIds: ['A2', 'A1'] });
        assert.strictEqual(hydrated.perf.assetLoadMode, 'full');
        assert.strictEqual(hydrated.perf.materializedFocusCount, 2);
        const rules = fixture.runtimeState.lastRenderCache?.dynamicStyleRules;
        assert.strictEqual(rules?.get('st-focus-icon-GFX_A1'), 'real:A1;');
        assert.strictEqual(rules?.get('st-focus-icon-GFX_A3'), 'placeholder;', 'off-screen focuses keep placeholders');
        fixture.session.dispose();
    });

    it('loads focuses that scrolling reveals, visible ones first, without resending rules in transit', async () => {
        const fixture = createAssetFixture(101);
        await fixture.hydrate(['A1']);
        const base = fixture.runtimeState.lastRenderCache!.snapshotVersion;
        await fixture.request(1, ['A2'], ['A3', 'B1']);
        const revealed = await fixture.finalResponse(1);
        assert.deepStrictEqual(revealed.map(message => [message.tier, message.materializedFocusIds, message.baseSnapshotVersion, message.snapshotVersion, message.final]), [
            ['visible', ['A2'], base, base + 1, false],
            ['nearby', ['A3'], base + 1, base + 2, true],
        ], 'B1 belongs to an unloaded tree and is ignored');
        assert.strictEqual(revealed[0].style.kind, 'delta');
        assert.match(revealed[0].style.css, /real:A2;/);
        assert.doesNotMatch(revealed[0].style.css, /real:A1;/);
        const cache = fixture.runtimeState.lastRenderCache!;
        assert.deepStrictEqual(cache.materializedFocusIds, ['A1', 'A2', 'A3']);
        assert.strictEqual(cache.snapshotVersion, base + 2);
        assert.strictEqual(cache.dynamicStyleRules.get('st-focus-icon-GFX_A2'), 'real:A2;');
        assert.strictEqual(getWebviewAssetState(fixture.postMessages).rules.get('st-focus-icon-GFX_A2'), 'real:A2;');

        // A request computed before the webview saw A2's patch must not receive it again.
        await fixture.request(2, ['A2'], [], { snapshotVersion: base });
        assert.deepStrictEqual((await fixture.finalResponse(2)).map(message => message.status), ['empty']);
        // A webview that saw the patch and still asks is marked again; its stylesheet already
        // holds the rule, so the image body does not travel twice.
        await fixture.request(3, ['A2'], [], { snapshotVersion: base + 2 });
        const resent = await fixture.finalResponse(3);
        assert.deepStrictEqual(resent.map(message => [message.status, message.materializedFocusIds, message.style]), [['applied', ['A2'], undefined]]);
        assert.deepStrictEqual(fixture.patchCalls.at(-1), { focusIds: ['A2'], resend: ['A2'] });
        fixture.session.dispose();
    });

    it('rejects stale requests and drops asset work that a scheduled refresh supersedes', async () => {
        const fixture = createAssetFixture(102);
        await fixture.hydrate(['A1']);
        const cache = fixture.runtimeState.lastRenderCache;
        await fixture.request(1, ['A2'], [], { documentVersion: 101 });
        assert.deepStrictEqual((await fixture.finalResponse(1)).map(message => message.status), ['stale']);
        assert.strictEqual(fixture.runtimeState.lastRenderCache, cache);

        let release: () => void = () => undefined;
        fixture.gates.assetPatch = new Promise<void>(resolve => { release = resolve; });
        const patchCount = fixture.patchCalls.length;
        await fixture.request(2, ['A2']);
        await waitForCondition(() => fixture.patchCalls.length > patchCount, 'Expected the asset patch to start.');
        // An imported edit keeps the root version; only generation cancellation stops the work.
        fixture.session.cancelPendingRefresh();
        release();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepStrictEqual(fixture.sceneAssets(2), []);
        assert.strictEqual(fixture.runtimeState.lastRenderCache, cache, 'the materialized cache is preserved');
        assert.deepStrictEqual(cache?.materializedFocusIds, ['A1']);
        fixture.session.dispose();
    });

    it('switches trees with placeholders, loads the shown tree on demand, and keeps revisited scenes', async () => {
        const fixture = createAssetFixture(103);
        await fixture.hydrate(['A1']);
        await fixture.request(1, ['A2']);
        await fixture.finalResponse(1);

        await fixture.session.handleSceneRequest('B');
        assert.deepStrictEqual(fixture.fullSnapshotCalls.at(-1)?.treeIds, ['B']);
        const scene = fixture.postMessages.at(-1);
        assert.strictEqual(scene.command, 'focusTreeScene');
        assert.deepStrictEqual(scene.assetMaterialization, { deferred: false, focusIds: ['A1', 'A2'] },
            'the new tree arrives with placeholders; loaded scenes keep their icons');
        assert.strictEqual(scene.style.kind, 'delta', 'a merged scene adds to the stylesheet the webview has');
        assert.doesNotMatch(scene.style.css, /real:A1;|real:A2;/, 'loaded rules do not travel again');
        assert.match(scene.style.css, /st-focus-icon-GFX_B1 \{ placeholder; \}/);
        assert.strictEqual(getWebviewAssetState(fixture.postMessages).rules.get('st-focus-icon-GFX_A2'), 'real:A2;');

        await fixture.request(2, ['B1'], ['B2'], { treeId: 'B' });
        const shown = await fixture.finalResponse(2);
        assert.deepStrictEqual(shown.map(message => message.materializedFocusIds), [['B1'], ['B2']]);
        // Returning to A is a client-side switch; its scrolled-to focuses still load.
        await fixture.request(3, ['A3'], [], { treeId: 'A' });
        const revisited = await fixture.finalResponse(3);
        assert.deepStrictEqual(revisited.map(message => [message.status, message.materializedFocusIds]), [['applied', ['A3']]]);
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.materializedFocusIds, ['A1', 'A2', 'B1', 'B2', 'A3']);
        fixture.session.dispose();
    });

    it('keeps a first-painted icon real while a tree sharing its asset hydrates, edits refresh, and full syncs replace styles', async () => {
        const fixture = createAssetFixture(111);
        const sharedKey = fixture.iconRuleKey('A1');
        assert.strictEqual(fixture.iconRuleKey('D1'), sharedKey, 'D1 shares the icon of A1');
        const focusIds = ['A1', 'A2', 'A3', 'D1', 'D2'];
        /** Focuses the webview counts as materialized, each rendering its real icon rule. */
        const assertWebviewRendersMaterializedIcons = (step: string, materializedFocusIds: string[]) => {
            const { rules, materialization, resyncRequests } = getWebviewAssetState(fixture.postMessages);
            assert.deepStrictEqual(resyncRequests, [], `${step}: every style delta fits the webview's stylesheet`);
            assert.deepStrictEqual(focusIds.filter(focusId => !materialization.isPending(focusId)), materializedFocusIds,
                `${step}: materialized focuses`);
            for (const focusId of materializedFocusIds) {
                assert.strictEqual(rules.get(fixture.iconRuleKey(focusId)), fixture.realRule(focusId),
                    `${step}: ${focusId} renders its real icon, not a placeholder`);
            }
            assert.strictEqual(fixture.runtimeState.lastRenderCache?.dynamicStyleRules.get(sharedKey), fixture.realRule('A1'),
                `${step}: the host's rule index agrees with the webview`);
        };

        await fixture.hydrate(['A1']);
        assertWebviewRendersMaterializedIcons('first paint', ['A1']);

        // D joins the loaded scenes with nothing materialized. Its unseen D1 must not turn the
        // shared icon back into a placeholder; its own icons do arrive as placeholders.
        await fixture.session.handleSceneRequest('D');
        const scene = fixture.postMessages.at(-1);
        assert.strictEqual(scene.command, 'focusTreeScene');
        assert.strictEqual(scene.treeId, 'D');
        assert.deepStrictEqual(parseRules(scene.style.css), [[fixture.iconRuleKey('D2'), 'placeholder;']],
            'only the new scene\'s missing rule travels');
        assertWebviewRendersMaterializedIcons('other tree hydrated', ['A1']);

        await fixture.request(1, ['D2'], [], { treeId: 'D' });
        await fixture.finalResponse(1);
        // Returning to A is a client-side switch: no message arrives, so A1 must already render
        // for real; it is materialized and is therefore never requested again.
        assertWebviewRendersMaterializedIcons('cached revisit', ['A1', 'D2']);

        // Edits that keep every focus refresh the loaded scenes, rebuilt or patched in place.
        for (let edit = 1; edit <= 3; edit++) {
            const edited = createDocument(111 + edit);
            fixture.latestDocument.current = edited;
            await fixture.session.refreshDocument(edited);
            assertWebviewRendersMaterializedIcons(`edit ${edit}`, ['A1', 'D2']);
        }

        // A dependency change rebuilds every materialized rule of every loaded scene and replaces
        // the webview's stylesheet with it.
        const latest = fixture.latestDocument.current!;
        const fullSnapshotCount = fixture.fullSnapshotCalls.length;
        fixture.setIconStyleSignature('icons-2');
        await fixture.session.refreshDocument(latest, {
            source: 'dependency',
            invalidation: FocusTreeInvalidation.Assets,
            assetLoadMode: 'full',
        });
        assert.strictEqual(fixture.fullSnapshotCalls.length, fullSnapshotCount + 1);
        const fullSync = fixture.fullSnapshotCalls.at(-1)!;
        assert.deepStrictEqual([...fullSync.treeIds].sort(), ['A', 'D'], 'the full sync covers every loaded scene');
        assert.deepStrictEqual([...fullSync.materializedFocusIds ?? []].sort(), ['A1', 'D2']);
        const assetUpdate = fixture.postMessages.filter(message => message.command !== 'focusTreeSceneAssets').at(-1);
        assert.deepStrictEqual(parseRules(assetUpdate.style.css).map(([selector]) => selector).sort(),
            [fixture.iconRuleKey('A1'), fixture.iconRuleKey('D2')].sort(), 'exactly the changed icon bodies travel');
        assertWebviewRendersMaterializedIcons('full sync', ['A1', 'D2']);

        // Revealing D1 later only extends the bookkeeping: its icon is already real.
        await fixture.request(2, ['D1'], [], { treeId: 'D', documentVersion: latest.version });
        const revealed = await fixture.finalResponse(2);
        assert.deepStrictEqual(revealed.map(message => [message.status, message.materializedFocusIds, message.style]),
            [['applied', ['D1'], undefined]]);
        assertWebviewRendersMaterializedIcons('shared icon revealed', ['A1', 'D1', 'D2']);
        fixture.session.dispose();
    });

    it('resyncs a webview whose stylesheet missed a delta and gives a restored webview every rule', async () => {
        const fixture = createAssetFixture(112);
        await fixture.hydrate(['A1']);
        await fixture.request(1, ['A2']);
        await fixture.finalResponse(1);
        await fixture.session.handleSceneRequest('B');
        const sceneIndex = fixture.postMessages.length - 1;
        assert.strictEqual(fixture.postMessages[sceneIndex].style.kind, 'delta');

        // The webview lost the scene's delta, so the next delta cannot apply; it reports that
        // through its asset request channel without asking for any focus.
        const lost = fixture.postMessages.map((message, index) => index === sceneIndex ? { ...message, style: undefined } : message);
        const resyncIndex = fixture.postMessages.length;
        await fixture.session.handleAssetRequest({
            command: 'focusTreeAssetRequest',
            protocolVersion: focusTreeProtocolVersion,
            assetRequestId: 0,
            treeId: 'B',
            snapshotVersion: fixture.runtimeState.lastRenderCache!.snapshotVersion,
            documentVersion: fixture.document.version,
            visibleFocusIds: [],
            nearbyFocusIds: [],
            styleResync: true,
        });
        const resync = fixture.postMessages.slice(resyncIndex);
        assert.deepStrictEqual(resync.map(message => message.command), ['focusTreeStyleSync'], 'a style-only report queues no asset work');
        assert.strictEqual(resync[0].style.kind, 'full');
        const recovered = getWebviewAssetState([...lost, ...resync]);
        assert.deepStrictEqual(recovered.rules, new Map(fixture.runtimeState.lastRenderCache!.dynamicStyleRules));
        assert.strictEqual(recovered.rules.get('st-focus-icon-GFX_A2'), 'real:A2;');
        assert.strictEqual(recovered.rules.get('st-focus-icon-GFX_B1'), 'placeholder;');

        // A restored webview document announces itself again; its first sync carries every rule.
        fixture.session.handleWebviewReady('B');
        const restoredIndex = fixture.postMessages.length;
        await fixture.request(2, ['B2'], [], { treeId: 'B' });
        const restored = await fixture.finalResponse(2);
        const restoredMessages = fixture.postMessages.slice(restoredIndex);
        assert.deepStrictEqual(restored.map(message => [message.status, message.materializedFocusIds]), [['applied', ['B2']]]);
        assert.strictEqual(restored[0].style.kind, 'full', 'a new document holds no stylesheet to extend');
        const fresh = getWebviewAssetState(restoredMessages);
        assert.deepStrictEqual(fresh.resyncRequests, []);
        assert.strictEqual(fresh.rules.get('st-focus-icon-GFX_A1'), 'real:A1;', 'loaded scenes keep their icons');
        assert.strictEqual(fresh.rules.get('st-focus-icon-GFX_B2'), 'real:B2;');
        assert.deepStrictEqual(fresh.rules, new Map(fixture.runtimeState.lastRenderCache!.dynamicStyleRules));
        fixture.session.dispose();
    });

    it('publishes only the latest of rapid scene requests and builds on a scene still in transit', async () => {
        const fixture = createAssetFixture(108);
        await fixture.hydrate(['A1']);
        const sceneMessages = () => fixture.postMessages
            .filter(message => message.command === 'focusTreeScene' && message.sceneMode === 'merge');

        // B is still loading when C is selected; only C's scene may be published.
        let releaseB: () => void = () => undefined;
        fixture.gates.fullBaseState = new Promise<void>(resolve => { releaseB = resolve; });
        const baseStateCalls = fixture.getFullBaseStateCalls();
        const toB = fixture.session.handleSceneRequest('B');
        await waitForCondition(() => fixture.getFullBaseStateCalls() > baseStateCalls, 'Expected B to start loading.');
        fixture.gates.fullBaseState = undefined;
        const toC = fixture.session.handleSceneRequest('C');
        releaseB();
        await Promise.all([toB, toC]);
        assert.deepStrictEqual(sceneMessages().map(message => message.treeId), ['C']);
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.selectedTreeId, 'C');
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.assetTreeIds, ['A', 'C']);

        // A request arriving while B's scene is in transit builds on B instead of dropping it.
        let releasePost: () => void = () => undefined;
        const postGate = new Promise<void>(resolve => { releasePost = resolve; });
        fixture.webview.postMessage = async (message: any) => {
            fixture.postMessages.push(message);
            if (message.command === 'focusTreeScene' && message.treeId === 'B') {
                await postGate;
            }
            return true;
        };
        const toB2 = fixture.session.handleSceneRequest('B');
        await waitForCondition(() => sceneMessages().some(message => message.treeId === 'B'), 'Expected B in transit.');
        const toA = fixture.session.handleSceneRequest('A');
        releasePost();
        await Promise.all([toB2, toA]);
        const last = sceneMessages().at(-1);
        assert.strictEqual(last.treeId, 'A');
        assert.deepStrictEqual(last.focusTrees.map((tree: { id: string }) => tree.id).sort(), ['A', 'B', 'C'],
            'the webview keeps B selectable without another request');
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.assetTreeIds, ['A', 'C', 'B']);
        assert.strictEqual(fixture.runtimeState.lastRenderCache?.selectedTreeId, 'A');
        fixture.session.dispose();
    });

    it('refreshes every materialized icon after an asset dependency change and serves queued requests afterwards', async () => {
        const fixture = createAssetFixture(104);
        await fixture.hydrate(['A1']);
        await fixture.request(1, ['A2']);
        await fixture.finalResponse(1);

        let release: () => void = () => undefined;
        fixture.gates.fullBaseState = new Promise<void>(resolve => { release = resolve; });
        fixture.setIconStyleSignature('icons-2');
        const baseStateCalls = fixture.getFullBaseStateCalls();
        const refresh = fixture.session.refreshDocument(fixture.document, {
            source: 'dependency',
            invalidation: FocusTreeInvalidation.Assets,
            assetLoadMode: 'full',
        });
        await waitForCondition(() => fixture.getFullBaseStateCalls() > baseStateCalls, 'Expected the dependency refresh to start.');
        await fixture.request(2, ['A3']);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepStrictEqual(fixture.sceneAssets(2), [], 'asset requests wait for the refresh');

        release();
        fixture.gates.fullBaseState = undefined;
        await refresh;
        assert.deepStrictEqual(fixture.fullSnapshotCalls.at(-1)?.materializedFocusIds, ['A1', 'A2']);
        const refreshed = fixture.postMessages.filter(message => message.command !== 'focusTreeSceneAssets').at(-1);
        assert.strictEqual(refreshed.perf.source, 'dependency');
        assert.deepStrictEqual(refreshed.assetMaterialization, { deferred: false, focusIds: ['A1', 'A2'] });
        assert.strictEqual(refreshed.style.kind, 'delta');
        assert.deepStrictEqual(parseRules(refreshed.style.css), [
            ['st-focus-icon-GFX_A1', 'real:A1@icons-2;'],
            ['st-focus-icon-GFX_A2', 'real:A2@icons-2;'],
        ], 'every materialized rule is replaced; unchanged placeholders stay where they are');
        assert.strictEqual(getWebviewAssetState(fixture.postMessages).rules.get('st-focus-icon-GFX_A2'), 'real:A2@icons-2;');

        const queued = await fixture.finalResponse(2);
        assert.deepStrictEqual(queued.map(message => [message.status, message.materializedFocusIds, message.baseSnapshotVersion]),
            [['applied', ['A3'], refreshed.snapshotVersion]]);
        fixture.session.dispose();
    });

    it('lets an in-flight hydration finish when localisation becomes ready instead of loading twice', async () => {
        let markIndexReady: () => void = () => undefined;
        (localisationIndex as any).whenLocalisationIndexReady = () => new Promise<void>(resolve => { markIndexReady = resolve; });
        const fixture = createAssetFixture(109);
        const structural = await fixture.paintStructure();
        let releaseHydration: () => void = () => undefined;
        fixture.gates.fullBaseState = new Promise<void>(resolve => { releaseHydration = resolve; });
        fixture.session.handleContentApplied(structural.snapshotVersion, structural.documentVersion, 'firstScenePainted', ['A1']);
        await waitForCondition(() => fixture.getFullBaseStateCalls() === 1, 'Expected the hydration to start.');

        // The index becomes ready while the hydration loads, so the hydration is built with it.
        fixture.setBaseStateLocalised(true);
        markIndexReady();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.strictEqual(fixture.getFullBaseStateCalls(), 1, 'the hydration is neither cancelled nor restarted');
        releaseHydration();
        await waitForCondition(() => fixture.runtimeState.lastRenderCache?.deferredAssetLoad === false, 'Expected the hydration to finish.');
        await new Promise(resolve => setTimeout(resolve, 5));

        assert.strictEqual(fixture.getFullBaseStateCalls(), 1, 'a localised hydration needs no second load');
        const sources = fixture.postMessages
            .filter(message => message.command !== 'focusTreeSceneAssets')
            .map(message => message.perf?.source);
        assert.strictEqual(sources.at(-1), 'hydration');
        assert.ok(!sources.includes('dependency'));
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.materializedFocusIds, ['A1']);
        fixture.session.dispose();
    });

    it('refreshes localisation after, not instead of, a hydration built before the index was ready', async () => {
        let markIndexReady: () => void = () => undefined;
        (localisationIndex as any).whenLocalisationIndexReady = () => new Promise<void>(resolve => { markIndexReady = resolve; });
        const fixture = createAssetFixture(110);
        const structural = await fixture.paintStructure();
        let releaseHydration: () => void = () => undefined;
        fixture.gates.fullBaseState = new Promise<void>(resolve => { releaseHydration = resolve; });
        fixture.session.handleContentApplied(structural.snapshotVersion, structural.documentVersion, 'firstScenePainted', ['A1']);
        await waitForCondition(() => fixture.getFullBaseStateCalls() === 1, 'Expected the hydration to start.');

        markIndexReady();
        await new Promise(resolve => setTimeout(resolve, 5));
        fixture.gates.fullBaseState = undefined;
        releaseHydration();
        await waitForCondition(() => fixture.postMessages.some(message => message.perf?.source === 'dependency'),
            'Expected the localisation refresh after the hydration.');

        const sources = fixture.postMessages
            .filter(message => message.command !== 'focusTreeSceneAssets')
            .map(message => message.perf?.source);
        assert.deepStrictEqual(sources.slice(-2), ['hydration', 'dependency'], 'the hydration was applied, not cancelled');
        assert.strictEqual(fixture.getFullBaseStateCalls(), 2);
        assert.deepStrictEqual(fixture.runtimeState.lastRenderCache?.materializedFocusIds, ['A1'],
            'the localisation refresh keeps the hydrated visible icons');
        fixture.session.dispose();
    });

    it('cancels a scheduled hydration for a pending refresh and hydrates right after the next one', async () => {
        const fixture = createAssetFixture(105);
        const structural = await fixture.paintStructure();
        const cache = fixture.runtimeState.lastRenderCache;
        assert.strictEqual(fixture.runtimeState.deferredHydrationDocumentVersion, 105);
        fixture.session.cancelPendingRefresh();
        assert.strictEqual(fixture.runtimeState.deferredHydrationDocumentVersion, undefined);
        assert.strictEqual(fixture.runtimeState.lastRenderCache, cache);

        // The acknowledgement of the cancelled hydration's scene still names the visible focuses.
        fixture.session.handleContentApplied(structural.snapshotVersion, structural.documentVersion, 'firstScenePainted', ['A3']);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.ok(fixture.fullSnapshotCalls.every(call => call.deferred), 'nothing hydrates before the scheduled refresh');

        await fixture.session.refreshDocument(fixture.document, { source: 'dependency', invalidation: FocusTreeInvalidation.Structure });
        await waitForCondition(() => fixture.runtimeState.lastRenderCache?.deferredAssetLoad === false,
            'Expected hydration without waiting for another first paint.');
        assert.deepStrictEqual(fixture.fullSnapshotCalls.at(-1)?.materializedFocusIds, ['A3']);
        fixture.session.dispose();
    });

    it('keeps a pending local-edit refresh when its own change is scheduled', async () => {
        const fixture = createAssetFixture(106);
        await fixture.hydrate(['A1']);
        const requestId = fixture.runtimeState.latestRefreshRequestId;
        fixture.runtimeState.pendingLocalEditDocumentVersions.add(106);
        fixture.session.cancelPendingRefresh();
        assert.strictEqual(fixture.runtimeState.latestRefreshRequestId, requestId,
            'the scheduled refresh of this version is skipped, so its local-edit refresh must finish');
        fixture.runtimeState.pendingLocalEditDocumentVersions.delete(106);
        fixture.session.cancelPendingRefresh();
        assert.strictEqual(fixture.runtimeState.latestRefreshRequestId, requestId + 1);
        fixture.session.dispose();
    });

    it('drops an in-flight refresh of an unchanged root document when an imported edit is scheduled', async () => {
        const fixture = createAssetFixture(107);
        await fixture.hydrate(['A1']);
        const messageCount = fixture.postMessages.length;
        const cache = fixture.runtimeState.lastRenderCache;
        let release: () => void = () => undefined;
        fixture.gates.fullBaseState = new Promise<void>(resolve => { release = resolve; });
        fixture.setIconStyleSignature('icons-3');
        const baseStateCalls = fixture.getFullBaseStateCalls();
        const refresh = fixture.session.refreshDocument(fixture.document, {
            source: 'dependency',
            invalidation: FocusTreeInvalidation.Assets,
            assetLoadMode: 'full',
        });
        await waitForCondition(() => fixture.getFullBaseStateCalls() > baseStateCalls, 'Expected the refresh to start.');
        fixture.session.cancelPendingRefresh();
        release();
        await refresh;
        assert.strictEqual(fixture.postMessages.length, messageCount);
        assert.strictEqual(fixture.runtimeState.lastRenderCache, cache);
        fixture.session.dispose();
    });
});
