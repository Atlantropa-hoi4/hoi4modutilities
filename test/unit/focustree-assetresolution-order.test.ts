import * as assert from 'assert';
import Module = require('module');
import type * as vscode from 'vscode';
import type * as SessionModule from '../../src/previewdef/focustree/previewsession';
import type * as LoaderModule from '../../src/previewdef/focustree/loader';
import type * as AdapterModule from '../../src/previewdef/focustree/loaderadapter';
import type * as BuilderModule from '../../src/previewdef/focustree/snapshotbuilder';
import { focusTreeProtocolVersion } from '../../src/previewdef/focustree/viewmodel';

interface Gate {
    promise: Promise<void>;
    release: () => void;
}

interface PostedMessage {
    command?: string;
    snapshotVersion: number;
    assetRequestId?: number;
    final?: boolean;
    status?: string;
    tier?: string;
    materializedFocusIds?: string[];
    assetMaterialization?: { deferred: boolean; focusIds?: string[] };
    perf?: { source?: string };
}

function gate(): Gate {
    let release: () => void = () => undefined;
    // Node 20 and the repository's ES2022 target do not expose Promise.withResolvers.
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

async function until(predicate: () => boolean, message: string): Promise<void> {
    for (let turns = 0; turns < 100 && !predicate(); turns++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(predicate(), message);
}

/** Only external file/index/image services are controlled; loading, resolution, rendering and publication are real. */
function createLoadingFixture() {
    const source = `focus_tree = { id = MAIN
        focus = { id = VISIBLE icon = GFX_VISIBLE x = 0 y = 0 }
        focus = { id = NEARBY icon = GFX_NEARBY x = 0 y = 2 }
        focus = { id = NEXT icon = GFX_NEXT x = 0 y = 3 }
        focus = { id = HIDDEN icon = GFX_HIDDEN x = 0 y = 200 }
    }
    focus_tree = { id = OTHER focus = { id = OTHER_FOCUS icon = GFX_OTHER x = 0 y = 0 } }`;
    const lookups: string[] = [];
    const decoded: string[] = [];
    const textureReads: string[] = [];
    const settledLookups: string[] = [];
    const messages: PostedMessage[] = [];
    const barriers: Record<string, Gate | undefined> = {};
    const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
    const originalLoad = nodeModule._load;
    // Other suites also substitute these external services; isolate production imports from their caches.
    const sourceRoot = require.resolve('../../src/previewdef/focustree/loader').split('previewdef')[0];
    const savedModules = Object.entries(require.cache).filter(([filename]) => filename.startsWith(sourceRoot));
    savedModules.forEach(([filename]) => { delete require.cache[filename]; });
    const i18nPath = require.resolve('../../src/util/i18n');
    nodeModule._load = function(request, parent, isMain) {
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
                env: { language: 'en' },
                window: { showErrorMessage: () => undefined },
                workspace: { getConfiguration: () => ({ get: () => undefined, featureFlags: [], previewLocalisation: 'English' }) },
                Uri: { joinPath: () => ({ toString: () => 'mock-resource' }) },
            };
        }
        if (request.endsWith('/fileloader')) {
            return {
                readFileFromModOrHOI4: async (file: string) => [Buffer.from(file.endsWith('focus.txt') ? source : ''), file],
                listFilesFromModOrHOI4: async () => [],
                hoiFileExpiryToken: async (file: string) => { textureReads.push(file); return file; },
            };
        }
        if (request.endsWith('/featureflags')) {
            return { isSharedFocusIndexEnabled: () => false, isLocalisationIndexEnabled: () => false,
                isUseConditionInFocusEnabled: () => false, featureFlagsAsScript: () => '' };
        }
        if (request.endsWith('/gfxindex')) {
            return { getGfxContainerFile: async (name: string) => {
                lookups.push(name);
                await barriers[name]?.promise;
                settledLookups.push(name);
                return `interface/${name}.gfx`;
            } };
        }
        if (request.endsWith('/image/imagecache')) {
            return {
                getSpriteTextureFilesByGfxFile: async (file: string) => ({ [file.slice(10, -4)]: `gfx/${file.slice(10, -4)}.dds` }),
                getSpriteByGfxNameFromResolvedFiles: async (name: string) => {
                    decoded.push(name);
                    const image = { width: 64, height: 64, uri: `data:image/png;base64,${name}` };
                    return { image, width: 64, height: 64, noOfFrames: 1,
                        getFrame: (index: number) => index === 0 ? image : undefined };
                },
                getImageByPath: async () => undefined,
            };
        }
        if (request.endsWith('/i18n')) {
            // Absolute loading bypasses translation-only mocks left active by other suites.
            return originalLoad.call(this, i18nPath, parent, isMain);
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    let modules: {
        Session: typeof SessionModule.FocusTreePreviewSession;
        Loader: typeof LoaderModule.FocusTreeLoader;
        Adapter: typeof AdapterModule.FocusTreeLoaderAdapter;
        Builder: typeof BuilderModule.FocusTreeSnapshotBuilder;
    };
    try {
        modules = {
            Session: require('../../src/previewdef/focustree/previewsession').FocusTreePreviewSession,
            Loader: require('../../src/previewdef/focustree/loader').FocusTreeLoader,
            Adapter: require('../../src/previewdef/focustree/loaderadapter').FocusTreeLoaderAdapter,
            Builder: require('../../src/previewdef/focustree/snapshotbuilder').FocusTreeSnapshotBuilder,
        };
    } finally {
        nodeModule._load = originalLoad;
        Object.keys(require.cache).filter(filename => filename.startsWith(sourceRoot)).forEach(filename => { delete require.cache[filename]; });
        savedModules.forEach(([filename, module]) => { require.cache[filename] = module; });
    }
    const uri = { fsPath: 'C:/test/focus.txt', path: '/test/focus.txt', toString: () => 'file:///test/focus.txt' } as vscode.Uri;
    const document = { uri, version: 1, getText: () => source } as vscode.TextDocument;
    const webview = { html: '', postMessage: async (message: PostedMessage) => { messages.push(message); return true; } } as unknown as vscode.Webview;
    const focusTreeLoader = new modules.Loader('common/national_focus/focus.txt');
    const updateDependencies = () => undefined;
    const adapter = new modules.Adapter({ focusTreeLoader, updateDependencies });
    const builder = new modules.Builder({ uri, webview, loaderAdapter: adapter, getConditionPresetsByTree: () => ({}) });
    const session = new modules.Session({ uri, webview, focusTreeLoader, updateDependencies, getConditionPresetsByTree: () => ({}),
        getLatestDocument: () => document, snapshotBuilder: builder, deferredHydrationDelayMs: 10_000 });
    const paint = async () => {
        await session.initializePanel(document);
        session.handleWebviewReady('MAIN');
        await until(() => messages.some(message => message.command === 'focusTreeScene'), 'structural scene was not published');
        const structural = messages.find(message => message.command === 'focusTreeScene')!;
        session.handleContentApplied(structural.snapshotVersion, 1, 'firstScenePainted', ['VISIBLE']);
        await until(() => messages.some(message => message.perf?.source === 'hydration'), 'visible hydration waited for an unrelated icon');
    };
    const request = (assetRequestId: number, visibleFocusIds: string[], nearbyFocusIds: string[] = []) => session.handleAssetRequest({
        command: 'focusTreeAssetRequest', protocolVersion: focusTreeProtocolVersion, assetRequestId, treeId: 'MAIN',
        documentVersion: 1, snapshotVersion: 1, visibleFocusIds, nearbyFocusIds,
    });
    const dispose = () => {
        session.dispose();
        Object.values(barriers).forEach(barrier => barrier?.release());
    };
    return { session, messages, lookups, settledLookups, decoded, textureReads, barriers, paint, request, dispose };
}

describe('focus actual-path asset resolution ordering', () => {
    it('publishes and decodes visible assets without resolving hidden or other-tree icons, then retains warm assets', async () => {
        const fixture = createLoadingFixture();
        fixture.barriers.GFX_HIDDEN = gate();
        fixture.barriers.GFX_OTHER = gate();
        try {
            await fixture.paint();
            assert.deepStrictEqual(fixture.lookups, ['GFX_VISIBLE']);
            assert.deepStrictEqual(fixture.decoded, ['GFX_VISIBLE']);
            assert.deepStrictEqual(fixture.textureReads.filter(file => file.startsWith('gfx/')), ['gfx/GFX_VISIBLE.dds']);
            const hydration = fixture.messages.find(message => message.perf?.source === 'hydration')!;
            assert.deepStrictEqual(hydration.assetMaterialization, { deferred: false, focusIds: ['VISIBLE'] });
            await fixture.request(1, ['NEXT'], ['NEARBY']);
            await until(() => fixture.messages.some(message => message.assetRequestId === 1 && message.final), 'viewport demand did not finish');
            const applied = fixture.messages.filter(message => message.assetRequestId === 1 && message.status === 'applied');
            assert.deepStrictEqual(applied.map(message => [message.tier, message.materializedFocusIds]), [['visible', ['NEXT']], ['nearby', ['NEARBY']]]);
            assert.deepStrictEqual(fixture.lookups, ['GFX_VISIBLE', 'GFX_NEXT', 'GFX_NEARBY']);
            const lookupCount = fixture.lookups.length;
            await fixture.session.handleSceneRequest('MAIN');
            assert.strictEqual(fixture.lookups.length, lookupCount, 'warm scene reused its resolved assets');
            assert.deepStrictEqual(fixture.messages.at(-1)?.assetMaterialization?.focusIds, ['VISIBLE', 'NEXT', 'NEARBY']);
        } finally { fixture.dispose(); }
    });

    it('supersedes blocked nearby resolution with new visible demand and cannot publish the cancelled result', async () => {
        const fixture = createLoadingFixture();
        try {
            await fixture.paint();
            fixture.barriers.GFX_NEARBY = gate();
            await fixture.request(1, [], ['NEARBY']);
            await until(() => fixture.lookups.includes('GFX_NEARBY'), 'nearby resolution did not start');
            await fixture.request(2, ['NEXT']);
            await until(() => fixture.messages.some(message => message.assetRequestId === 2 && message.status === 'applied'), 'new visible demand waited for obsolete nearby work');
            fixture.barriers.GFX_NEARBY!.release();
            await until(() => fixture.settledLookups.includes('GFX_NEARBY'), 'cancelled lookup did not settle');
            await new Promise(resolve => setImmediate(resolve));
            assert.ok(!fixture.decoded.includes('GFX_NEARBY'), 'cancelled metadata did not reach image decode');
            assert.ok(!fixture.messages.some(message => message.assetRequestId === 1 && message.status === 'applied'));
            assert.ok(fixture.messages.some(message => message.assetRequestId === 2 && message.materializedFocusIds?.includes('NEXT')));
        } finally { fixture.dispose(); }
    });
});
