import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson } from '../../src/hoiformat/schema';
import { guiFileSchema, GuiFile } from '../../src/hoiformat/gui';
import { StyleTable } from '../../src/util/styletable';

// Keep module mocks local to each test, including lazy imports made during an async load.
async function isolated(mocks: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const original = loader._load;
    const cached = { ...require.cache };
    for (const key of Object.keys(require.cache)) { if (/[\\/]out[\\/]src[\\/]/.test(key)) { delete require.cache[key]; } }
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop()!;
        return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, request, parent, main);
    };
    try { await run(); }
    finally {
        loader._load = original;
        for (const key of Object.keys(require.cache)) { if (!cached[key]) { delete require.cache[key]; } }
        Object.assign(require.cache, cached);
    }
}

class Emitter {
    public event = () => ({ dispose: () => undefined });
    public fire(): void { }
    public dispose(): void { }
}
const vscode = { EventEmitter: Emitter, env: { language: 'en' }, window: { setStatusBarMessage: () => undefined },
    workspace: { getConfiguration: () => ({ featureFlags: [], previewLocalisation: 'English' }) } };
const shared = { vscode, telemetry: { sendEvent: () => undefined }, context: { contextContainer: { current: null } },
    debug: { error: () => undefined, debug: () => undefined } };

describe('imported preview features', () => {
    it('persists warm indexes, separates mod namespaces and rejects stale or damaged snapshots', async () => {
        const files = new Map<string, Uint8Array>();
        let mod = 'one.mod'; let source = 'first'; let dirty = false; let builds = 0;
        const uri = (value: string): any => ({ path: value, toString: () => value, with: (change: { path: string }) => uri(change.path) });
        const storage = uri('/storage');
        const config = () => ({ installPath: '/game', modFile: mod, loadDlcContents: true });
        const vscodeMock = { ...vscode, Uri: { joinPath: (base: any, ...parts: string[]) => uri(base.path + '/' + parts.join('/')) }, workspace: {
            getConfiguration: config, workspaceFolders: [{ uri: uri('/mod') }], fs: {
                stat: async (file: any) => { const content = files.get(file.path); if (!content) { throw new Error('missing'); } return { size: content.length }; },
                readFile: async (file: any) => files.get(file.path),
                writeFile: async (file: any, content: Uint8Array) => { files.set(file.path, content); },
                createDirectory: async () => undefined,
                rename: async (from: any, to: any) => { files.set(to.path, files.get(from.path)!); files.delete(from.path); },
                delete: async (file: any) => { files.delete(file.path); },
            },
        } };
        await isolated({ ...shared, vscode: vscodeMock, context: { contextContainer: { current: { globalStorageUri: storage } } }, fileloader: {
            listFilesFromModOrHOI4: async () => ['a.txt'], getFilePathFromModOrHOI4: async () => uri('/mod/a.txt'),
            expiryToken: async () => source, isHoiFileOpened: () => dirty, readFileFromPath: async () => [Buffer.from(source)],
        } }, async () => {
            const { IndexService } = require('../../src/services/indexService') as typeof import('../../src/services/indexService');
            const { indexCacheUri, indexFingerprint, readIndexCache } = require('../../src/services/indexCache') as typeof import('../../src/services/indexCache');
            const spec = { folder: 'events', extension: '.txt', layer: 'all' as const };
            const committed: string[] = [];
            const create = () => new IndexService({ events: { cache: spec,
                build: async () => { builds++; return { content: source }; }, commit: snapshot => committed.push(snapshot.content),
                reset: () => undefined, statusMessage: 'Building', telemetryEvent: 'eventTest',
            } });
            await create().ensure('events', { showStatusBar: false });
            await create().ensure('events', { showStatusBar: false });
            assert.strictEqual(builds, 1);
            assert.deepStrictEqual(committed, ['first', 'first']);
            const firstUri = indexCacheUri('eventTest')!;
            const firstFingerprint = await indexFingerprint(spec, new AbortController().signal);
            mod = 'two.mod'; assert.notStrictEqual(indexCacheUri('eventTest')!.toString(), firstUri.toString()); mod = 'one.mod';
            source = 'changed';
            await create().ensure('events', { showStatusBar: false });
            assert.strictEqual(builds, 2);
            assert.strictEqual(await readIndexCache(firstUri, firstFingerprint), undefined);
            const fingerprint = await indexFingerprint(spec, new AbortController().signal);
            const envelope = JSON.parse(Buffer.from(files.get(firstUri.path)!).toString()); envelope.data = '{"content":"tampered"}';
            files.set(firstUri.path, Buffer.from(JSON.stringify(envelope)));
            assert.strictEqual(await readIndexCache(firstUri, fingerprint), undefined);
            dirty = true;
            const dirtyFingerprint = await indexFingerprint(spec, new AbortController().signal);
            assert.strictEqual(await indexFingerprint(spec, new AbortController().signal), dirtyFingerprint);
            source = 'unsaved edit';
            assert.notStrictEqual(await indexFingerprint(spec, new AbortController().signal), dirtyFingerprint);
            assert.ok([...files.keys()].every(key => !key.endsWith('.tmp')));
        });
    });

    it('discovers cross-file event calls, preserves same-namespace siblings and terminates cycles', async () => {
        const files: Record<string, string> = {
            'events/a.txt': 'add_namespace = chain country_event = { id = chain.1 after = { country_event = { id = chain.2 } } }',
            'events/b.txt': 'add_namespace = chain country_event = { id = chain.2 immediate = { country_event = { id = chain.1 } } } country_event = { id = chain.3 }',
        };
        await isolated({ ...shared, fileloader: {
            getFileContentSourceGeneration: () => 1, getFilePathFromMod: async () => 'mod',
            listFilesFromModOrHOI4: async () => Object.keys(files).map(file => file.slice(7)),
            readFileFromModOrHOI4: async (file: string) => [Buffer.from(files[file]), file],
            hoiFileExpiryToken: async (file: string) => files[file],
        }, modfile: { getSelectedModSourceGeneration: () => 1 }, gfxindex: { getGfxContainerFiles: async () => [] },
        vsccommon: { getLanguageIdInYml: () => 'l_english' } }, async () => {
            const { EventsLoader } = require('../../src/previewdef/event/loader') as typeof import('../../src/previewdef/event/loader');
            const { LoaderSession } = require('../../src/util/loader/loader') as typeof import('../../src/util/loader/loader');
            const { invalidateEventIndex } = require('../../src/util/eventIndex') as typeof import('../../src/util/eventIndex');
            const loader = new EventsLoader('events/a.txt', async () => files['events/a.txt']);
            const first = await loader.load(new LoaderSession(true));
            assert.deepStrictEqual(first.result.events.eventItemsByNamespace.chain.map(event => event.id), ['chain.1', 'chain.2', 'chain.3']);
            assert.ok(first.dependencies.includes('events/b.txt'));
            files['events/c.txt'] = 'add_namespace = chain country_event = { id = chain.4 }';
            files['events/a.txt'] = 'add_namespace = chain country_event = { id = chain.1 option = { country_event = { id = chain.4 } } }';
            invalidateEventIndex();
            const second = await loader.load(new LoaderSession(true));
            assert.deepStrictEqual(second.result.events.eventItemsByNamespace.chain.map(event => event.id), ['chain.1', 'chain.4']);
            assert.ok(!second.dependencies.includes('events/b.txt'));
        });
    });

    it('resolves declared technology country icons and equipment naming fallbacks', async () => {
        const files: Record<string, string> = {
            'common/country_tags/tags.txt': 'GER = "countries/Germany.txt" FRA = "countries/France.txt"',
            'common/units/equipment/equipment.txt': 'equipments = { tank = { short_name = tank_short } tank_1 = { archetype = tank } }',
            'common/units/equipment/zzz_base.txt': 'equipments = { tank = { short_name = base_short } }',
        };
        await isolated({ ...shared, fileloader: {
            listFilesFromModOrHOI4: async (folder: string) => Object.keys(files).filter(file => file.startsWith(folder + '/')).map(file => file.slice(folder.length + 1)),
            parseAndResolveHoi4FileCached: async (file: string) => parseHoi4File(files[file]),
            getFilePathFromMod: async (file: string) => file.endsWith('equipment.txt') ? 'mod' : undefined,
        }, gfxindex: { getIndexedGfxNames: async () => ['GFX_GER_armor_medium', 'GFX_FRA_unrelated', 'GFX_armor'] } }, async () => {
            const { loadTechnologyPresentation, technologyIconNames } = require('../../src/previewdef/technology/presentation') as typeof import('../../src/previewdef/technology/presentation');
            const technology = { id: 'armor', subTechnologies: [], equipmentIds: ['tank_1'] } as any;
            const dependencies = await loadTechnologyPresentation([{ technologies: [technology] } as any]);
            assert.deepStrictEqual(technology.countryTags, ['GER']);
            assert.deepStrictEqual(technology.nameKeys, { short: ['tank_short'], long: ['tank_1'] });
            assert.strictEqual(dependencies.length, 3);
            assert.deepStrictEqual(technologyIconNames('armor', 'GER'), ['GFX_GER_armor_medium', 'GFX_GER_armor', 'GFX_armor_medium', 'GFX_armor']);
        });
    });

    it('renders focus GUI title styles with escaped names while preserving editing and dynamic icons', async () => {
        const sprites: string[] = [];
        await isolated({ ...shared, imagecache: { getSpriteByGfxName: async (name: string) => { sprites.push(name); return undefined; } },
            featureflags: { isLocalisationIndexEnabled: () => false } }, async () => {
            const { parseFocusTitleStyles, findFocusWindow, renderFocusGui, renderContinuousFocusGui } = require('../../src/previewdef/focustree/presentation') as typeof import('../../src/previewdef/focustree/presentation');
            const { renderFocusHtmlTemplate } = require('../../src/previewdef/focustree/focusrender') as typeof import('../../src/previewdef/focustree/focusrender');
            const gui = convertNodeToJson<GuiFile>(parseHoi4File(`guiTypes = {
                containerWindowType = { name = national_focus_item size = { width = 100 height = 120 }
                    iconType = { name = bg spriteType = old }
                    iconType = { name = symbol position = { x = 50 y = 35 } centerposition = yes }
                    instantTextBoxType = { name = name maxWidth = 100 maxHeight = 25 position = { x = 0 y = 85 } }
                }
                containerWindowType = { name = tree containerWindowType = { name = continuous_focus_window size = { width = 720 height = 300 } } }
            }`), guiFileSchema);
            const windows = gui.guitypes.flatMap(type => type.containerwindowtype);
            const presentation = { item: findFocusWindow(windows, 'national_focus_item'), continuous: findFocusWindow(windows, 'continuous_focus_window'),
                styles: parseFocusTitleStyles(parseHoi4File('style = { name = special unavailable = GFX_special }')) };
            const focus = { id: 'FOCUS<id>', textIcon: 'special', file: 'main.txt', isInCurrentFile: true,
                layout: { editable: true, sourceFile: 'main.txt' }, token: { start: 1, end: 100 } } as any;
            const styles = new StyleTable();
            const body = await renderFocusGui(focus, presentation, styles, [], 96, 130, '<translated>');
            const html = renderFocusHtmlTemplate(focus, styles, 'main.txt', 96, 130, '<translated>', body);
            assert.ok(sprites.includes('GFX_special'));
            assert.match(html, /data-focus-editable="true"/);
            assert.match(html, /focus-checkbox/);
            assert.match(html, /\{\{iconClass\}\}/);
            assert.match(html, /&lt;translated&gt;/);
            assert.doesNotMatch(html, /<translated>/);
            assert.ok(await renderContinuousFocusGui(presentation, styles, []));
            assert.match(styles.toStyleContent(), /width:720px;height:300px/);
        });
    });

    it('deduplicates GFX texture data and bounds concurrent card rendering', async () => {
        let active = 0; let maximum = 0;
        await isolated({ ...shared, imagecache: { getImageByPath: async () => {
            maximum = Math.max(maximum, ++active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            return { path: 'shared.dds', uri: 'data:image/png;base64,SHARED_TEXTURE', width: 32, height: 32 };
        } } }, async () => {
            const { renderGfxFile } = require('../../src/previewdef/gfx/contentbuilder') as typeof import('../../src/previewdef/gfx/contentbuilder');
            const text = 'spriteTypes = {' + Array.from({ length: 25 }, (_, i) => `spriteType = { name = GFX_${i} texturefile = "shared.dds" }`).join('\n') + '}';
            const result = await renderGfxFile(text, { toString: () => 'file:///sample.gfx' } as any, {} as any);
            assert.strictEqual(result.html.split('data:image/png;base64,SHARED_TEXTURE').length - 1, 1);
            assert.strictEqual(result.html.split('role="img"').length - 1, 25);
            assert.ok(maximum <= 8 && maximum > 1);
            assert.match(result.html, /id="GFX_24"/);
            assert.match(result.html, /start="\d+"/);
        });
    });
});
