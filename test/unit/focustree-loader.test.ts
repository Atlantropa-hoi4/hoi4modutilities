import * as assert from 'assert';
import Module = require('module');
import type * as LoaderAdapterModule from '../../src/previewdef/focustree/loaderadapter';
import type * as InvalidationModule from '../../src/previewdef/focustree/invalidation';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

const mainFocusFile = 'common/national_focus/main.txt';
const sharedFocusFile = 'common/national_focus/shared.txt';
const focusTreeGuiFile = 'interface/nationalfocusview.gui';
const indexedGfxFile = 'interface/indexed_icons.gfx';
const fileContents: Record<string, string> = {
    [mainFocusFile]: `
        focus_tree = {
            id = MAIN
            shared_focus = SHARED_EXT
            focus = {
                id = LOCAL
                icon = GFX_LOCAL
                x = 0
                y = 0
                cost = 1
            }
        }
    `,
    [sharedFocusFile]: `
        shared_focus = {
            id = SHARED_EXT
            icon = GFX_SHARED
            x = 0
            y = 0
            cost = 1
        }
    `,
    [focusTreeGuiFile]: 'guiTypes = {}',
};
const focusIconResolutionCalls: string[][] = [];
const gfxIndexLookups: string[] = [];
const focusIconFallbackLimits: Array<number | undefined> = [];
const blockingSharedFocusIndexLookups: string[] = [];
const readySharedFocusIndexLookups: string[] = [];
/** Every shared focus index layer is ready. */
let sharedFocusIndexReady = true;
/** Keys a complete workspace layer resolves while other layers may still be building. */
const workspaceSharedFocusIds = new Set<string>();
let iconResolutionBarrier: { started: () => void; released: Promise<void> } | undefined;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class EventEmitter<T> {
            private readonly listeners: Array<(value: T) => unknown> = [];
            public event = (listener: (value: T) => unknown) => {
                this.listeners.push(listener);
                return { dispose: () => undefined };
            };
            public fire(value: T): void { this.listeners.forEach(listener => listener(value)); }
        }

        return {
            EventEmitter,
            window: { showErrorMessage: () => undefined },
            l10n: { t: (_key: string, fallback: string) => fallback },
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
            },
        };
    }

    if (request.endsWith('/util/fileloader')
        || request.endsWith('/fileloader')
        || request === '../../util/fileloader'
        || request === '../fileloader') {
        return {
            readFileFromModOrHOI4: async (file: string) => [Buffer.from(fileContents[file] ?? ''), file],
            hoiFileExpiryToken: async (file: string) => `token:${file}`,
            listFilesFromModOrHOI4: async () => [],
        };
    }

    if (request.endsWith('/util/featureflags')
        || request.endsWith('/featureflags')
        || request === '../../util/featureflags') {
        return {
            isSharedFocusIndexEnabled: () => true,
            isLocalisationIndexEnabled: () => false,
            isUseConditionInFocusEnabled: () => false,
        };
    }

    if (request.endsWith('/util/sharedFocusIndex')
        || request.endsWith('/sharedFocusIndex')
        || request === '../../util/sharedFocusIndex') {
        return {
            findFileByFocusKey: async (focusId: string) => {
                blockingSharedFocusIndexLookups.push(focusId);
                return focusId === 'SHARED_EXT' ? sharedFocusFile : undefined;
            },
            tryFindFileByFocusKey: (focusId: string) => {
                readySharedFocusIndexLookups.push(focusId);
                if (workspaceSharedFocusIds.has(focusId)) {
                    return sharedFocusFile;
                }
                return sharedFocusIndexReady && focusId === 'SHARED_EXT' ? sharedFocusFile : undefined;
            },
            isSharedFocusIndexReady: () => sharedFocusIndexReady,
        };
    }

    if (request.endsWith('/util/gfxindex')
        || request.endsWith('/gfxindex')
        || request === '../../util/gfxindex') {
        return {
            getGfxContainerFile: async (gfxName: string) => {
                gfxIndexLookups.push(gfxName);
                return gfxName === 'GFX_LOCAL' ? indexedGfxFile : gfxName === 'GFX_SECOND' ? 'interface/second_icons.gfx' : undefined;
            },
        };
    }

    if ((request.endsWith('/focusicongfx') || request === './focusicongfx')
        && parent?.filename?.includes('focustree')) {
        return {
            createEmptyFocusIconAssetResolution: () => ({
                gfxFiles: [],
                textureFiles: [],
                gfxFileByIconName: {},
                unresolvedIconNames: [],
                textureExpiryByIconName: {},
            }),
            resolveFocusIconGfxAssets: async (iconNames: string[], resolver: { resolveIndexedFile: (gfxName: string) => Promise<string | undefined> }) => {
                focusIconResolutionCalls.push([...iconNames]);
                focusIconFallbackLimits.push((resolver as { fallbackScanLimit?: number }).fallbackScanLimit);
                const barrier = iconResolutionBarrier;
                if (barrier) {
                    barrier.started();
                    await barrier.released;
                }
                const gfxFileByIconName: Record<string, string> = {};
                for (const iconName of iconNames) {
                    const gfxFile = await resolver.resolveIndexedFile(iconName);
                    if (gfxFile) {
                        gfxFileByIconName[iconName] = gfxFile;
                    }
                }

                return {
                    gfxFiles: Object.values(gfxFileByIconName),
                    textureFiles: [],
                    gfxFileByIconName,
                    unresolvedIconNames: [],
                    textureExpiryByIconName: {},
                };
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/loader/loader')];
delete require.cache[require.resolve('../../src/previewdef/focustree/focusspacing')];
delete require.cache[require.resolve('../../src/previewdef/focustree/loader')];
delete require.cache[require.resolve('../../src/previewdef/focustree/presentation')];
delete require.cache[require.resolve('../../src/previewdef/gui/loader')];

const {
    FocusTreeLoader,
} = require('../../src/previewdef/focustree/loader') as typeof import('../../src/previewdef/focustree/loader');
const {
    LoaderSession,
} = require('../../src/util/loader/loader') as typeof import('../../src/util/loader/loader');
const {
    getPerfSnapshot,
    resetPerfMetrics,
} = require('../../src/util/perf') as typeof import('../../src/util/perf');

const { FocusTreeLoaderAdapter } = require('../../src/previewdef/focustree/loaderadapter') as typeof LoaderAdapterModule;
const { FocusTreeInvalidation } = require('../../src/previewdef/focustree/invalidation') as typeof InvalidationModule;
nodeModule._load = originalLoad;

describe('focustree loader', () => {
    beforeEach(() => {
        focusIconResolutionCalls.length = 0;
        gfxIndexLookups.length = 0;
        focusIconFallbackLimits.length = 0;
        blockingSharedFocusIndexLookups.length = 0;
        readySharedFocusIndexLookups.length = 0;
        sharedFocusIndexReady = true;
        workspaceSharedFocusIds.clear();
        iconResolutionBarrier = undefined;
    });

    it('propagates deferred asset loading to shared focus dependencies', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'deferred');
        const result = await loader.load(new LoaderSession(true));

        assert.strictEqual(result.result.deferredAssetLoad, true);
        assert.ok(result.dependencies.includes(sharedFocusFile));
        assert.deepStrictEqual(focusIconResolutionCalls, []);
        assert.deepStrictEqual(blockingSharedFocusIndexLookups, []);
        assert.deepStrictEqual(readySharedFocusIndexLookups, ['SHARED_EXT']);
    });

    it('does not block a deferred first render on an unfinished shared focus index', async () => {
        sharedFocusIndexReady = false;
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'deferred');
        const result = await loader.load(new LoaderSession(true));

        assert.strictEqual(result.result.deferredAssetLoad, true);
        assert.ok(!result.dependencies.includes(sharedFocusFile));
        assert.deepStrictEqual(blockingSharedFocusIndexLookups, []);
        assert.deepStrictEqual(readySharedFocusIndexLookups, ['SHARED_EXT'], 'only the non-blocking lookup runs');
        assert.ok(result.result.focusTrees.every(tree =>
            tree.warnings.every(warning => warning.code !== 'shared-focus-target-missing')));
    });

    it('uses complete workspace shared focus hits in the deferred first render while global layers build', async () => {
        sharedFocusIndexReady = false;
        workspaceSharedFocusIds.add('SHARED_EXT');
        const content = fileContents[mainFocusFile].replace('shared_focus = SHARED_EXT', 'shared_focus = SHARED_EXT\n shared_focus = GLOBAL_PENDING');
        const loader = new FocusTreeLoader(mainFocusFile).createSnapshotLoader(async () => content, 'deferred', 'workspace-hit');
        const result = await loader.load(new LoaderSession(true));

        const mainTree = result.result.focusTrees.find(tree => tree.id === 'MAIN');
        assert.ok(mainTree?.focuses.SHARED_EXT, 'the workspace hit is part of the structural scene');
        assert.ok(result.dependencies.includes(sharedFocusFile), 'its source file is watched');
        assert.deepStrictEqual(blockingSharedFocusIndexLookups, []);
        assert.deepStrictEqual(readySharedFocusIndexLookups, ['SHARED_EXT', 'GLOBAL_PENDING']);
        assert.ok(result.result.focusTrees.every(tree => tree.warnings.every(warning =>
            warning.code !== 'shared-focus-target-missing')), 'a key global layers may still provide is not reported missing');
    });

    it('keeps full asset loading for full shared focus dependency hydration', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        await loader.load(new LoaderSession(true));

        assert.ok(focusIconResolutionCalls.length >= 1);
        assert.ok(focusIconResolutionCalls.flat().includes('GFX_SHARED'));
        assert.deepStrictEqual(blockingSharedFocusIndexLookups, ['SHARED_EXT']);
    });

    it('prepares only the selected tree icons while retaining both trees and imported source focuses', async () => {
        const originalSharedContent = fileContents[sharedFocusFile];
        fileContents[sharedFocusFile] += `
            shared_focus = { id = UNUSED_IMPORT icon = GFX_UNUSED_IMPORT x = 2 y = 0 }
        `;
        try {
        const content = fileContents[mainFocusFile] + `
            focus_tree = { id = SECOND focus = { id = SECOND_FOCUS icon = GFX_SECOND x = 1 y = 1 } }
        `;
        const root = new FocusTreeLoader(mainFocusFile);
        const first = await root.createSnapshotLoader(async () => content, 'full', 'scope', { treeId: 'MAIN' })
            .load(new LoaderSession(true));
        assert.deepStrictEqual(first.result.focusTrees.map(tree => tree.id), ['MAIN', 'SECOND']);
        assert.ok(first.result.focusTrees[0].focuses.SHARED_EXT);
        assert.deepStrictEqual(first.result.assetTreeIds, ['MAIN']);
        assert.strictEqual(focusIconResolutionCalls.length, 1, 'Imported source loaders must not resolve their own assets');
        assert.ok(focusIconResolutionCalls[0].includes('GFX_SHARED'));
        assert.ok(!focusIconResolutionCalls.flat().includes('GFX_SECOND'));
        assert.ok(!focusIconResolutionCalls.flat().includes('GFX_UNUSED_IMPORT'));
        const second = await root.createSnapshotLoader(async () => content, 'full', 'scope', { treeId: 'SECOND' })
            .load(new LoaderSession(true));
        assert.deepStrictEqual(second.result.assetTreeIds, ['SECOND']);
        assert.deepStrictEqual(focusIconResolutionCalls.at(-1), ['GFX_SECOND']);
        const unscoped = await root.createSnapshotLoader(async () => content, 'full', 'scope')
            .load(new LoaderSession(true));
        assert.strictEqual(unscoped.result.assetTreeIds, undefined);
        assert.ok(focusIconResolutionCalls.at(-1)?.includes('GFX_SECOND'));
        assert.ok(focusIconResolutionCalls.at(-1)?.includes('GFX_SHARED'));
        } finally {
            fileContents[sharedFocusFile] = originalSharedContent;
        }
    });

    it('reuses scoped session states, retains watchers for loaded trees, and invalidates every asset scope', async () => {
        const content = fileContents[mainFocusFile] + `
            focus_tree = { id = SECOND focus = { id = SECOND_FOCUS icon = GFX_SECOND x = 1 y = 1 } }
        `;
        const dependencyUpdates: string[][] = [];
        const adapter = new FocusTreeLoaderAdapter({
            focusTreeLoader: new FocusTreeLoader(mainFocusFile),
            updateDependencies: dependencies => dependencyUpdates.push(dependencies),
        });
        const first = await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'MAIN' });
        const firstResolutionCount = focusIconResolutionCalls.length;
        const repeatedFirst = await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.strictEqual(repeatedFirst, first);
        assert.strictEqual(focusIconResolutionCalls.length, firstResolutionCount);
        const second = await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'SECOND' });
        assert.notStrictEqual(second, first);
        assert.deepStrictEqual(second.assetTreeIds, ['SECOND']);
        assert.ok(dependencyUpdates.at(-1)?.includes(indexedGfxFile));
        assert.ok(dependencyUpdates.at(-1)?.includes('interface/second_icons.gfx'));
        const returnedFirst = await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.notStrictEqual(returnedFirst, first, 'Only the most recent full source graph is retained');
        assert.strictEqual(await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'MAIN' }), returnedFirst);
        for (const invalidation of [FocusTreeInvalidation.Assets, FocusTreeInvalidation.Presentation, FocusTreeInvalidation.Localisation]) {
            adapter.invalidate(invalidation);
            assert.notStrictEqual(await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'MAIN' }), first);
            assert.notStrictEqual(await adapter.buildBaseState(content, 10, {}, 'full', undefined, { treeId: 'SECOND' }), second);
        }
        const edited = await adapter.buildBaseState(content + '\n# edit', 11, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.notStrictEqual(edited, first);
        adapter.dispose();
    });

    it('re-renders a ready localisation index from the hydrated state without loading it again', async () => {
        const adapter = new FocusTreeLoaderAdapter({
            focusTreeLoader: new FocusTreeLoader(mainFocusFile),
            updateDependencies: () => undefined,
        });
        const content = fileContents[mainFocusFile];
        const hydrated = await adapter.buildBaseState(content, 30, {}, 'full', undefined, { treeId: 'MAIN' });
        hydrated.focusDisplayNameById = { MAIN_FOCUS: 'unlocalised id' };
        const resolutionCount = focusIconResolutionCalls.length;

        // After hydration, refreshes name the loaded trees explicitly; that is the same scope.
        assert.strictEqual(await adapter.buildBaseState(content, 30, {}, 'full', undefined, { treeId: 'MAIN', treeIds: ['MAIN'] }), hydrated);
        adapter.invalidate(FocusTreeInvalidation.Localisation, { reuseLoadedStates: true });
        const localised = await adapter.buildBaseState(content, 30, {}, 'full', undefined, { treeId: 'MAIN', treeIds: ['MAIN'] });
        assert.strictEqual(localised, hydrated, 'trees, icons, and watchers do not depend on localisation');
        assert.strictEqual(localised.focusDisplayNameById, undefined, 'display names are resolved again when rendering');
        assert.strictEqual(focusIconResolutionCalls.length, resolutionCount, 'the loader does not run again');

        // An edited localisation file may still be updating the index, so it reloads as before.
        adapter.invalidate(FocusTreeInvalidation.Localisation);
        const reloaded = await adapter.buildBaseState(content, 30, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.notStrictEqual(reloaded, hydrated);
        adapter.invalidate(FocusTreeInvalidation.Assets, { reuseLoadedStates: true });
        assert.notStrictEqual(await adapter.buildBaseState(content, 30, {}, 'full', undefined, { treeId: 'MAIN' }), reloaded,
            'asset changes always reload');
        assert.ok(focusIconResolutionCalls.length > resolutionCount);
        adapter.dispose();
    });

    it('replaces obsolete watchers only after an invalidated refresh covers every loaded tree', async () => {
        const content = fileContents[mainFocusFile] + `
            focus_tree = { id = SECOND focus = { id = SECOND_FOCUS icon = GFX_SECOND x = 1 y = 1 } }
        `;
        const dependencyUpdates: string[][] = [];
        const adapter = new FocusTreeLoaderAdapter({
            focusTreeLoader: new FocusTreeLoader(mainFocusFile),
            updateDependencies: dependencies => dependencyUpdates.push(dependencies),
        });
        await adapter.buildBaseState(content, 20, {}, 'full', undefined, { treeId: 'MAIN' });
        await adapter.buildBaseState(content, 20, {}, 'full', undefined, { treeId: 'SECOND' });
        adapter.invalidate(FocusTreeInvalidation.Assets);
        assert.ok(dependencyUpdates.at(-1)?.includes(indexedGfxFile), 'Invalidation retains watchers until replacement');
        const edited = content.replace('GFX_LOCAL', 'GFX_REPLACED');
        await adapter.buildBaseState(edited, 21, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.ok(dependencyUpdates.at(-1)?.includes(indexedGfxFile), 'A one-tree load cannot drop another loaded scene manifest');
        await adapter.buildBaseState(edited, 21, {}, 'full', undefined, { treeId: 'MAIN', treeIds: ['MAIN', 'SECOND'] });
        assert.ok(!dependencyUpdates.at(-1)?.includes(indexedGfxFile), 'Complete refreshed scope removes obsolete assets');
        assert.ok(dependencyUpdates.at(-1)?.includes('interface/second_icons.gfx'), 'Previously loaded scene remains watched');
        adapter.dispose();
    });

    it('cannot repopulate scoped assets or watchers from a load invalidated mid-resolution', async () => {
        let markStarted: () => void = () => undefined;
        let release: () => void = () => undefined;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        iconResolutionBarrier = {
            started: markStarted,
            released: new Promise<void>(resolve => { release = resolve; }),
        };
        const dependencyUpdates: string[][] = [];
        const adapter = new FocusTreeLoaderAdapter({
            focusTreeLoader: new FocusTreeLoader(mainFocusFile),
            updateDependencies: dependencies => dependencyUpdates.push(dependencies),
        });
        const pending = adapter.buildBaseState(fileContents[mainFocusFile], 12, {}, 'full', undefined, { treeId: 'MAIN' });
        await started;
        adapter.invalidate(FocusTreeInvalidation.Assets);
        iconResolutionBarrier = undefined;
        release();
        const stale = await pending;
        assert.strictEqual(dependencyUpdates.length, 0);
        const current = await adapter.buildBaseState(fileContents[mainFocusFile], 12, {}, 'full', undefined, { treeId: 'MAIN' });
        assert.notStrictEqual(current, stale);
        assert.strictEqual(focusIconResolutionCalls.length, 2);
        assert.ok(dependencyUpdates.at(-1)?.includes(indexedGfxFile));
        adapter.dispose();
    });

    it('uses the GFX index during full asset loading so icons do not require explicit dependency headers', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        const result = await loader.load(new LoaderSession(true));

        assert.ok(gfxIndexLookups.includes('GFX_LOCAL'));
        assert.strictEqual(result.result.focusIconGfxFileByName.GFX_LOCAL, indexedGfxFile);
        assert.ok(result.result.gfxFiles.includes(indexedGfxFile));
    });

    it('does not scan every GFX file for unresolved icons on the initial hydration path', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        await loader.load(new LoaderSession(true));

        assert.ok(focusIconFallbackLimits.length >= 1);
        assert.ok(focusIconFallbackLimits.every(limit => limit === 0));
    });

    it('parses one source snapshot for deferred structure and full hydration of one document version', async () => {
        resetPerfMetrics();
        const rootLoader = new FocusTreeLoader(mainFocusFile);
        const deferredLoader = rootLoader.createSnapshotLoader(
            async () => fileContents[mainFocusFile],
            'deferred',
            '7',
        );
        const fullLoader = rootLoader.createSnapshotLoader(
            async () => fileContents[mainFocusFile],
            'full',
            '7',
        );

        await deferredLoader.load(new LoaderSession(true));
        await fullLoader.load(new LoaderSession(true));

        const sourceSnapshotBuilds = getPerfSnapshot({ limit: 100 }).entries.filter(entry =>
            entry.label === 'focustree.sourceSnapshot' && entry.tags.file === mainFocusFile);
        assert.strictEqual(sourceSnapshotBuilds.length, 1);
    });
    it('reuses icon GFX resolution across document versions until assets are invalidated', async () => {
        const rootLoader = new FocusTreeLoader(mainFocusFile);
        const loadVersion = async (version: string, content: string) => {
            const loader = rootLoader.createSnapshotLoader(async () => content, 'full', version);
            const result = (await loader.load(new LoaderSession(true))).result;
            rootLoader.adoptDependencyLoadersFrom(loader);
            return result;
        };
        const content = fileContents[mainFocusFile];

        const first = await loadVersion('1', content);
        const callsAfterFirstLoad = focusIconResolutionCalls.length;
        const edited = await loadVersion('2', `# edited\n${content}`);

        assert.ok(callsAfterFirstLoad >= 1);
        assert.strictEqual(focusIconResolutionCalls.length, callsAfterFirstLoad);
        assert.deepStrictEqual(edited.focusIconGfxFileByName, first.focusIconGfxFileByName);

        rootLoader.clearIconAssetResolution();
        await loadVersion('3', `# edited again\n${content}`);
        assert.strictEqual(focusIconResolutionCalls.length, callsAfterFirstLoad + 1);
    });
});
