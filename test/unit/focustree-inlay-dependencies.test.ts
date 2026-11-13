import * as assert from 'assert';
import Module = require('module');
import type * as InlayApi from '../../src/previewdef/focustree/inlay';
import type * as FocusLoaderApi from '../../src/previewdef/focustree/loader';
import type * as LoaderApi from '../../src/util/loader/loader';

const mainFile = 'common/national_focus/main.txt';
const standardFolder = 'common/focus_inlay_windows/';
const focus = (headers = '', id = 'custom_inlay') => `${headers}\nfocus_tree = {
    id = MAIN inlay_window = { id = ${id} position = { x = 10 y = 20 } }
    focus = { id = ROOT x = 0 y = 0 cost = 1 }
}`;

interface Harness {
    contents: Record<string, string>;
    reads: string[];
    beforeRead?: (file: string) => Promise<void>;
    inlay: typeof InlayApi;
    focusLoader: typeof FocusLoaderApi;
    session(force?: boolean, cancelled?: () => boolean): InstanceType<typeof LoaderApi.LoaderSession>;
}

async function withInlays(run: (harness: Harness) => Promise<void>): Promise<void> {
    const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const originalLoad = modules._load;
    const originalCache = { ...require.cache };
    for (const file of Object.keys(require.cache)) {
        if (/[\\/](?:out[\\/])?src[\\/]/.test(file)) { delete require.cache[file]; }
    }
    const contents: Record<string, string> = {
        [mainFile]: focus(), 'interface/nationalfocusview.gui': 'guiTypes = {}',
        'common/national_focus/00_titlebar_styles.txt': '',
    };
    const harness = { contents, reads: [] } as unknown as Harness;
    class Emitter {
        event = () => ({ dispose: () => undefined });
        fire(): void {}
        dispose(): void {}
    }
    modules._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop();
        if (request === 'vscode') {
            return { EventEmitter: Emitter, env: { language: 'en' }, workspace: { getConfiguration: () => ({}) } };
        }
        if (name === 'fileloader') {
            return {
                hoiFileExpiryToken: async (file: string) => contents[file] ?? 'missing',
                listFilesFromModOrHOI4: async (folder: string) => Object.keys(contents)
                    .filter(file => file.startsWith(folder + '/')).map(file => file.slice(folder.length + 1)),
                readFileFromModOrHOI4: async (file: string) => {
                    harness.reads.push(file);
                    const content = contents[file];
                    await harness.beforeRead?.(file);
                    if (content === undefined) { throw new Error('Missing fixture ' + file); }
                    return [Buffer.from(content), { toString: () => file }];
                },
            };
        }
        if (name === 'featureflags') { return { isSharedFocusIndexEnabled: () => false }; }
        if (name === 'gfxindex') { return { getGfxContainerFile: async () => undefined, tryGetGfxContainerFile: async () => undefined }; }
        if (name === 'sharedFocusIndex') { return {}; }
        if (name === 'imagecache') { return { getSpriteTextureFilesByGfxFile: async () => ({}) }; }
        if (name === 'guiwindowindex') {
            return { loadContainerWindows: async (names: string[]) => ({
                windows: Object.fromEntries(names.map(name => [name, { file: 'interface/inlay.gui', window: { name } }])),
                guiFiles: [], gfxFiles: [], dependencies: [],
            }) };
        }
        if (name === 'debug') { return { error: () => undefined }; }
        if (name === 'telemetry') { return { sendEvent: () => undefined }; }
        if (name === 'i18n') { return { localize: (_key: string, text: string, ...args: unknown[]) =>
            text.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])) }; }
        if (name === 'dependency') { return require('../../src/util/dependencyheader') as unknown; }
        return originalLoad.call(this, request, parent, main);
    };
    try {
        harness.inlay = require('../../src/previewdef/focustree/inlay') as typeof InlayApi;
        harness.focusLoader = require('../../src/previewdef/focustree/loader') as typeof FocusLoaderApi;
        const { LoaderSession } = require('../../src/util/loader/loader') as typeof LoaderApi;
        harness.session = (force = false, cancelled) => new LoaderSession(force, cancelled);
        await run(harness);
    } finally {
        modules._load = originalLoad;
        for (const file of Object.keys(require.cache)) { if (!originalCache[file]) { delete require.cache[file]; } }
        Object.assign(require.cache, originalCache);
    }
}

describe('explicit focus inlay dependencies', () => {
    it('loads a non-standard header file, preserves each tree condition and records its dependency', async () => {
        await withInlays(async harness => {
            const custom = 'custom/inlay/definition.txt';
            harness.contents[mainFile] = focus(`#!focus_inlay_window:${custom}`);
            harness.contents[custom] = 'custom_inlay = { window_name = custom_window visible = { has_country_flag = visible } }';
            const loaded = await new harness.focusLoader.FocusTreeLoader(mainFile).load(harness.session(true));
            const tree = loaded.result.focusTrees[0];
            assert.strictEqual(tree.inlayWindows[0]?.file, custom);
            assert.strictEqual(tree.inlayWindows[0]?.windowName, 'custom_window');
            assert.deepStrictEqual(tree.inlayWindows[0]?.position, { x: 10, y: 20 });
            assert.ok(tree.inlayConditionExprs.some(condition => condition.nodeContent.includes('has_country_flag')));
            assert.ok(loaded.dependencies.includes(custom));
            assert.ok(!tree.warnings.some(warning => warning.code === 'inlay-reference-missing'));
        });
    });

    it('keeps deferred first paint free of inlay reads while retaining explicit dependency provenance', async () => {
        await withInlays(async harness => {
            const custom = 'custom/lazy.txt';
            harness.contents[mainFile] = focus(`#!focus_inlay_window:${custom}`);
            harness.contents[custom] = 'custom_inlay = { window_name = custom_window }';
            const loaded = await new harness.focusLoader.FocusTreeLoader(mainFile, undefined, 'deferred').load(harness.session(true));
            assert.ok(!harness.reads.includes(custom));
            assert.ok(loaded.dependencies.includes(custom));
            assert.deepStrictEqual(loaded.result.inlayFiles, [custom]);
            assert.deepStrictEqual(loaded.result.focusTrees[0].inlayWindows, []);
        });
    });

    it('does not read an explicitly listed standard file twice and applies explicit overrides in header order', async () => {
        await withInlays(async harness => {
            const first = standardFolder + 'first.txt', second = standardFolder + 'second.txt';
            const custom = 'custom/override.txt';
            harness.contents[first] = 'custom_inlay = { window_name = first_window }';
            harness.contents[second] = 'custom_inlay = { window_name = second_window }';
            harness.contents[custom] = 'custom_inlay = { window_name = override_window }';
            const baseline = await new harness.focusLoader.FocusTreeLoader(mainFile).load(harness.session(true));
            assert.strictEqual(baseline.result.focusTrees[0].inlayWindows[0]?.windowName, 'first_window');
            harness.contents[mainFile] = focus(`#!focus_inlay_window:./${second}\n#!focus_inlay_window:${custom}`);
            const loaded = await new harness.focusLoader.FocusTreeLoader(mainFile).load(harness.session(true));
            assert.strictEqual(loaded.result.focusTrees[0].inlayWindows[0]?.windowName, 'override_window');
            assert.strictEqual(harness.reads.filter(file => file === second).length, 1);
            assert.strictEqual(harness.reads.filter(file => file === first).length, 1);
            assert.strictEqual(harness.reads.filter(file => file === custom).length, 1);
        });
    });

    it('reloads an unsaved explicit definition immediately through its tracked loader', async () => {
        await withInlays(async harness => {
            const custom = 'custom/unsaved.txt';
            harness.contents[mainFile] = focus(`#!focus_inlay_window:${custom}`);
            harness.contents[custom] = 'custom_inlay = { window_name = before }';
            const loader = new harness.focusLoader.FocusTreeLoader(mainFile);
            const first = await loader.load(harness.session());
            assert.strictEqual(first.result.focusTrees[0].inlayWindows[0]?.windowName, 'before');
            harness.contents[custom] = 'custom_inlay = { window_name = after }';
            assert.strictEqual(await loader.shouldReload(harness.session()), true);
            const changed = await loader.load(harness.session());
            assert.strictEqual(changed.result.focusTrees[0].inlayWindows[0]?.windowName, 'after');
        });
    });

    it('keeps missing explicit files in the manifest and discovers them after creation', async () => {
        await withInlays(async harness => {
            const custom = 'custom/created-later.txt';
            harness.contents[mainFile] = focus(`#!focus_inlay_window:${custom}`);
            const loader = new harness.focusLoader.FocusTreeLoader(mainFile);
            const missing = await loader.load(harness.session());
            assert.ok(missing.dependencies.includes(custom));
            assert.ok(missing.result.focusTrees[0].warnings.some(warning => warning.code === 'inlay-reference-missing'));
            harness.contents[custom] = 'custom_inlay = { window_name = created_window }';
            const created = await loader.load(harness.session());
            assert.strictEqual(created.result.focusTrees[0].inlayWindows[0]?.windowName, 'created_window');
        });
    });

    it('forwards headers from an imported focus file without duplicate reads', async () => {
        await withInlays(async harness => {
            const custom = 'custom/imported.txt', imported = 'common/national_focus/imported.txt';
            harness.contents[mainFile] = focus(`#!focus:${imported}`);
            harness.contents[imported] = `#!focus_inlay_window:${custom}\nshared_focus = { id = SHARED x = 0 y = 0 }`;
            harness.contents[custom] = 'custom_inlay = { window_name = imported_window }';
            const loaded = await new harness.focusLoader.FocusTreeLoader(mainFile).load(harness.session(true));
            assert.strictEqual(loaded.result.focusTrees.find(tree => tree.id === 'MAIN')?.inlayWindows[0]?.windowName, 'imported_window');
            assert.ok(loaded.dependencies.includes(custom));
            assert.strictEqual(harness.reads.filter(file => file === custom).length, 1);
        });
    });

    it('preserves BOM offsets for definition and scripted control navigation', async () => {
        await withInlays(async harness => {
            const file = 'custom/bom.txt';
            const content = '\uFEFFcustom_inlay = { window_name = custom_window scripted_images = { picture = { GFX_custom = yes } } scripted_buttons = { action = { available = { always = yes } } } }';
            harness.contents[file] = content;
            const loaded = await new harness.inlay.FocusInlayFileLoader(file).load(harness.session());
            const inlay = loaded.result.inlays[0];
            assert.strictEqual(inlay.token?.start, content.indexOf('custom_inlay'));
            assert.strictEqual(inlay.scriptedImages[0].token?.start, content.indexOf('picture'));
            assert.strictEqual(inlay.scriptedButtons[0].token?.start, content.indexOf('action'));
        });
    });

    it('does not publish a canceled explicit definition load', async () => {
        await withInlays(async harness => {
            const file = 'custom/cancelled.txt';
            harness.contents[file] = 'custom_inlay = { window_name = custom_window }';
            let release!: () => void, entered!: () => void;
            const barrier = new Promise<void>(resolve => { release = resolve; });
            const started = new Promise<void>(resolve => { entered = resolve; });
            harness.beforeRead = async path => { if (path === file) { entered(); await barrier; } };
            let cancelled = false;
            const loader = new harness.inlay.FocusInlayFileLoader(file);
            const pending = loader.load(harness.session(false, () => cancelled));
            await started;
            cancelled = true;
            release();
            await assert.rejects(pending, /cancelled/);
            harness.beforeRead = undefined;
            const current = await loader.load(harness.session());
            assert.strictEqual(current.result.inlays[0]?.windowName, 'custom_window');
        });
    });
});
