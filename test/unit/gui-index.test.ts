import * as assert from 'assert';
import Module = require('module');
import type * as GuiIndexApi from '../../src/util/guiIndex';
import type * as GuiWindowsApi from '../../src/util/guiwindowindex';
import type * as IndexServiceApi from '../../src/services/indexService';
import type * as LoaderApi from '../../src/util/loader/loader';

class Disposable {
    constructor(private readonly callback: () => void = () => undefined) {}
    dispose(): void { this.callback(); }
    static from(...items: Array<{ dispose(): void }>): Disposable {
        return new Disposable(() => { items.forEach(item => item.dispose()); });
    }
}

interface Harness {
    contents: Record<string, string>;
    order: string[];
    reads: string[];
    saves: number;
    generation: number;
    beforeRead?: (file: string) => Promise<void>;
    changes: Array<(event: { document: { uri: { path: string } } }) => void>;
    snapshots: Map<string, string>;
    createIndex(): typeof GuiIndexApi;
    windows(): typeof GuiWindowsApi;
    session(cancelled?: () => boolean): InstanceType<typeof LoaderApi.LoaderSession>;
}

async function withIndex(run: (harness: Harness) => Promise<void>): Promise<void> {
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const originalLoad = loader._load;
    const originalCache = { ...require.cache };
    for (const key of Object.keys(require.cache)) {
        if (/[\\/](?:out[\\/])?src[\\/]/.test(key)) { delete require.cache[key]; }
    }
    const snapshots = new Map<string, string>();
    const harness: Harness = {
        contents: {}, order: [], reads: [], saves: 0, generation: 1, changes: [], snapshots,
        createIndex: () => {
            delete require.cache[require.resolve('../../src/util/guiIndex')];
            return require('../../src/util/guiIndex') as typeof GuiIndexApi;
        },
        windows: () => require('../../src/util/guiwindowindex') as typeof GuiWindowsApi,
        session: cancelled => {
            const { LoaderSession } = require('../../src/util/loader/loader') as typeof LoaderApi;
            return new LoaderSession(false, cancelled);
        },
    };
    const event = () => new Disposable();
    class Emitter {
        event = event;
        fire(): void {}
        dispose(): void {}
    }
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop();
        if (request === 'vscode') {
            return {
                EventEmitter: Emitter, Disposable, env: { language: 'en' },
                RelativePattern: class { constructor(public base: unknown, public pattern: string) {} },
                window: { setStatusBarMessage: () => undefined },
                workspace: {
                    getConfiguration: () => ({}),
                    onDidChangeTextDocument: (listener: Harness['changes'][number]) => {
                        harness.changes.push(listener);
                        return new Disposable(() => { harness.changes.splice(harness.changes.indexOf(listener), 1); });
                    },
                    onDidOpenTextDocument: event, onDidCloseTextDocument: event, onDidCreateFiles: event,
                    onDidDeleteFiles: event, onDidRenameFiles: event, onDidChangeWorkspaceFolders: event,
                    onDidChangeConfiguration: event,
                    createFileSystemWatcher: () => ({ dispose: () => undefined, onDidChange: event, onDidCreate: event, onDidDelete: event }),
                },
            };
        }
        if (name === 'indexCache') {
            return {
                indexCacheUri: () => ({ toString: () => 'cache' }),
                indexFingerprint: async () => JSON.stringify([harness.generation, harness.order, harness.contents]),
                readIndexCache: async (_uri: unknown, fingerprint: string) => {
                    const text = snapshots.get(fingerprint);
                    return text ? JSON.parse(text) as unknown : undefined;
                },
                saveIndexCache: async (_uri: unknown, fingerprint: string, value: unknown) => {
                    snapshots.set(fingerprint, JSON.stringify(value)); harness.saves++;
                },
            };
        }
        if (name === 'fileloader') {
            return {
                listFilesFromModOrHOI4: async () => harness.order.map(file => file.slice('interface/'.length)),
                hoiFileExpiryToken: async (file: string) => harness.contents[file] ?? '',
                readFileFromModOrHOI4: async (file: string) => {
                    const text = harness.contents[file];
                    harness.reads.push(file);
                    await harness.beforeRead?.(file);
                    if (text === undefined) { throw new Error('Missing fixture ' + file); }
                    return [Buffer.from(text), { toString: () => file }];
                },
                getSelectedModRootFolders: async () => [], refreshFileContentSource: () => undefined,
            };
        }
        if (name === 'modfile') { return { getSelectedModSourceGeneration: () => harness.generation, onDidChangeSelectedModSource: event }; }
        if (name === 'telemetry') { return { sendEvent: () => undefined }; }
        if (name === 'localizer') { return { localizer: { t: (text: string) => text } }; }
        if (name === 'i18n') { return { localize: (_key: string, text: string) => text }; }
        if (name === 'debug') { return { error: () => undefined }; }
        if (name === 'dependency') { return require('../../src/util/dependencyheader') as unknown; }
        return originalLoad.call(this, request, parent, main);
    };
    let services: typeof IndexServiceApi | undefined;
    try {
        services = require('../../src/services/indexService') as typeof IndexServiceApi;
        await run(harness);
    } finally {
        services?.registerIndexServiceLifecycle().dispose();
        loader._load = originalLoad;
        for (const key of Object.keys(require.cache)) { if (!originalCache[key]) { delete require.cache[key]; } }
        Object.assign(require.cache, originalCache);
    }
}

async function settlePersistence(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

describe('shared persistent GUI index', () => {
    it('keeps source precedence, nested windows, element types and first duplicate definitions', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/z_mod.gui', 'interface/a_game.gui'];
            harness.contents = {
                'interface/z_mod.gui': `guiTypes = {
                    containerWindowType = { name = shared containerWindowType = { name = nested } }
                    windowType = { name = root_window }
                    scrollbarType = { name = root_scrollbar }
                    extendedScrollbarType = { name = root_extended }
                    @position_name = "focus_spacing"
                    PoSiTiOnTyPe = { NaMe = @position_name PoSiTiOn = { X = 144 Y = 170 } }
                }`,
                'interface/a_game.gui': 'guiTypes = { containerWindowType = { name = shared } containerWindowType = { name = game_only } }',
            };
            const api = harness.createIndex();
            assert.deepStrictEqual(await api.findGuiFiles(['shared', 'nested']), ['interface/z_mod.gui']);
            assert.deepStrictEqual(await api.findGuiFiles(['game_only']), ['interface/a_game.gui']);
            assert.deepStrictEqual(await api.findGuiFiles(['root_scrollbar']), []);
            assert.deepStrictEqual(await api.findGuiFiles(['root_scrollbar'], ['scrollbar']), ['interface/z_mod.gui']);
            assert.deepStrictEqual(await api.findGuiFiles(['root_extended'], ['extendedscrollbar']), ['interface/z_mod.gui']);
            assert.deepStrictEqual(await api.findGuiFiles(['focus_spacing']), []);
            assert.deepStrictEqual(await api.findGuiFiles(['focus_spacing'], ['position']), ['interface/z_mod.gui']);
            assert.strictEqual(api.isGuiIndexSnapshot({ version: 2, files: [{ file: 'interface/a.gui', token: '', items: [{ name: 'bad', type: 'icon' }] }] }), false);
            assert.strictEqual(api.isGuiIndexSnapshot({ files: [] }), false, 'old snapshots omit named GUI positions and must rebuild');
        });
    });

    it('restores a fresh index from disk metadata and reparses only edited files after invalidation', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/mod.gui', 'interface/base.gui'];
            harness.contents = {
                'interface/mod.gui': 'guiTypes = { containerWindowType = { name = original } }',
                'interface/base.gui': 'guiTypes = { windowType = { name = base } }',
            };
            await harness.createIndex().findGuiFiles(['original']);
            await settlePersistence();
            assert.ok(harness.saves > 0);
            harness.reads = [];
            const restored = harness.createIndex();
            assert.deepStrictEqual(await restored.findGuiFiles(['original']), ['interface/mod.gui']);
            assert.deepStrictEqual(harness.reads, [], 'warm metadata must avoid reading GUI bodies');
            harness.contents['interface/mod.gui'] = 'guiTypes = { containerWindowType = { name = unsaved_name } }';
            restored.invalidateGuiIndex();
            assert.deepStrictEqual(await restored.findGuiFiles(['original', 'unsaved_name', 'base']), ['interface/mod.gui', 'interface/base.gui']);
            assert.deepStrictEqual(await restored.findGuiFiles(['original']), []);
            assert.deepStrictEqual(harness.reads, ['interface/mod.gui']);
            delete harness.contents['interface/mod.gui'];
            harness.order.shift();
            restored.invalidateGuiIndex();
            assert.deepStrictEqual(await restored.findGuiFiles(['unsaved_name']), []);
        });
    });

    it('rebuilds old GUI snapshots that predate named position support', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/spacing.gui'];
            harness.contents['interface/spacing.gui'] = 'guiTypes = { positionType = { name = focus_spacing position = { x = 144 y = 170 } } }';
            await harness.createIndex().findGuiFiles(['focus_spacing'], ['position']);
            await settlePersistence();
            for (const [fingerprint, value] of harness.snapshots) {
                const snapshot = JSON.parse(value) as { version?: number; files: { items: unknown[] }[] };
                delete snapshot.version;
                snapshot.files.forEach(file => { file.items = []; });
                harness.snapshots.set(fingerprint, JSON.stringify(snapshot));
            }
            harness.reads = [];
            assert.deepStrictEqual(await harness.createIndex().findGuiFiles(['focus_spacing'], ['position']), ['interface/spacing.gui']);
            assert.deepStrictEqual(harness.reads, ['interface/spacing.gui']);
        });
    });

    it('loads referenced focus spacing in GUI order without reading GFX or unrelated GUI files', async () => {
        await withIndex(async harness => {
            harness.contents = {
                'interface/root.gui': '#!gui:interface/child.gui\n#!gfx:interface/ignored.gfx\nguiTypes = { positionType = { name = focus_spacing position = { x = 144 y = 170 } } }',
                'interface/child.gui': '#!gui:interface/leaf.gui\nguiTypes = { positionType = { name = focus_spacing position = { x = 200 y = 220 } } }',
                'interface/leaf.gui': '@spacing = 240\nguiTypes = { positionType = { name = focus_spacing position = { x = @spacing y = 260 } } }',
                'interface/unrelated.gui': 'guiTypes = { positionType = { name = focus_spacing position = { x = 999 y = 999 } } }',
            };
            const { FocusSpacingLoader } = require('../../src/previewdef/focustree/focusspacing') as typeof import('../../src/previewdef/focustree/focusspacing');
            const result = await new FocusSpacingLoader('interface/root.gui').load(harness.session());
            assert.deepStrictEqual(result.result.focusSpacing, { x: 240, y: 260 });
            assert.deepStrictEqual(result.dependencies, ['interface/root.gui', 'interface/child.gui', 'interface/leaf.gui']);
            assert.ok(!harness.reads.includes('interface/ignored.gfx'));
            assert.ok(!harness.reads.includes('interface/unrelated.gui'));
            await assert.rejects(new FocusSpacingLoader('interface/root.gui').load(harness.session(() => true)), /cancelled/);
        });
    });

    it('discards an in-flight index invalidated by a newer edit', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/test.gui'];
            harness.contents['interface/test.gui'] = 'guiTypes = { windowType = { name = old } }';
            let release!: () => void;
            let started!: () => void;
            const entered = new Promise<void>(resolve => { started = resolve; });
            const barrier = new Promise<void>(resolve => { release = resolve; });
            let blocked = false;
            harness.beforeRead = async () => {
                if (!blocked) { blocked = true; started(); await barrier; }
            };
            const api = harness.createIndex();
            const stale = api.findGuiFiles(['old']);
            await entered;
            harness.contents['interface/test.gui'] = 'guiTypes = { windowType = { name = newest } }';
            api.invalidateGuiIndex();
            const current = api.findGuiFiles(['newest']);
            release();
            assert.deepStrictEqual(await stale, []);
            assert.deepStrictEqual(await current, ['interface/test.gui']);
        });
    });

    it('loads only indexed GUI files and retains nested GUI, GFX, variables and cancellation', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/root.gui', 'interface/child.gui', 'interface/unrelated.gui'];
            harness.contents = {
                'interface/root.gui': '#!gui:interface/child.gui\n#!gfx:interface/root_assets.gfx\n@width = 90\n@window_name = "target"\nguiTypes = { containerWindowType = { name = @window_name size = { width = @width height = 20 } } }',
                'interface/child.gui': '#!gfx:interface/child_assets.gfx\nguiTypes = { windowType = { name = child } }',
                'interface/unrelated.gui': 'guiTypes = { windowType = { name = unrelated } }',
            };
            await harness.createIndex().findGuiFiles(['target']);
            harness.reads = [];
            const result = await harness.windows().loadContainerWindows(['target'], harness.session());
            assert.strictEqual(result.windows.target.window.size?.width?._value, 90);
            assert.ok(result.dependencies.includes('interface/root.gui'));
            assert.ok(result.dependencies.includes('interface/child.gui'));
            assert.ok(result.gfxFiles.includes('interface/root_assets.gfx'));
            assert.ok(result.gfxFiles.includes('interface/child_assets.gfx'));
            assert.ok(result.gfxFiles.includes('interface/root.gfx'));
            assert.ok(!harness.reads.includes('interface/unrelated.gui'));
            await assert.rejects(harness.windows().loadContainerWindows(['target'], harness.session(() => true)), /cancelled/);
        });
    });

    it('invalidates renamed unsaved GUI names through the document watcher', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/test.gui'];
            harness.contents['interface/test.gui'] = 'guiTypes = { windowType = { name = before } }';
            const api = harness.createIndex();
            const registration = api.registerGuiIndex();
            try {
                assert.deepStrictEqual(await api.findGuiFiles(['before']), ['interface/test.gui']);
                harness.contents['interface/test.gui'] = 'guiTypes = { windowType = { name = after } }';
                harness.changes.forEach(listener => listener({ document: { uri: { path: '/mod/interface/test.gui' } } }));
                assert.deepStrictEqual(await api.findGuiFiles(['before']), []);
                assert.deepStrictEqual(await api.findGuiFiles(['after']), ['interface/test.gui']);
            } finally { registration.dispose(); }
            assert.strictEqual(harness.changes.length, 0);
        });
    });

    it('keeps indexed definitions ahead of lower-priority referenced GUI duplicates', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/first.gui', 'interface/second.gui', 'interface/referenced.gui'];
            harness.contents = {
                'interface/first.gui': '#!gui:interface/referenced.gui\nguiTypes = { windowType = { name = first size = { width = 100 height = 20 } } }',
                'interface/second.gui': 'guiTypes = { windowType = { name = second size = { width = 200 height = 20 } } }',
                'interface/referenced.gui': 'guiTypes = { windowType = { name = first size = { width = 1 height = 20 } } windowType = { name = second size = { width = 2 height = 20 } } }',
            };
            harness.createIndex();
            const result = await harness.windows().loadContainerWindows(['first', 'second'], harness.session());
            assert.strictEqual(result.windows.first.file, 'interface/first.gui');
            assert.strictEqual(result.windows.first.window.size?.width?._value, 100);
            assert.strictEqual(result.windows.second.file, 'interface/second.gui');
            assert.strictEqual(result.windows.second.window.size?.width?._value, 200);
            assert.ok(result.guiFiles.includes('interface/referenced.gui'));
            assert.ok(result.dependencies.includes('interface/referenced.gui'));
        });
    });

    it('cancels pending publication when index registration is disposed', async () => {
        await withIndex(async harness => {
            harness.order = ['interface/test.gui'];
            harness.contents['interface/test.gui'] = 'guiTypes = { windowType = { name = pending } }';
            let release!: () => void;
            let started!: () => void;
            const entered = new Promise<void>(resolve => { started = resolve; });
            const barrier = new Promise<void>(resolve => { release = resolve; });
            harness.beforeRead = async () => { started(); await barrier; };
            const api = harness.createIndex();
            const registration = api.registerGuiIndex();
            const pending = api.findGuiFiles(['pending']);
            await entered;
            registration.dispose();
            release();
            await assert.rejects(pending, /cancelled/i);
            await assert.rejects(api.findGuiFiles(['pending']), /cancelled/i);
            assert.strictEqual(harness.saves, 0);
        });
    });
});
