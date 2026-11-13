import * as assert from 'assert';
import Module = require('module');
import type { WebviewPanel, Uri } from 'vscode';
import { PNG } from 'pngjs';
import type { CountryLabelsData, RequestCountryLabelsMessage, WorldMapData, WorldMapMessage } from '../../src/previewdef/worldmap/definitions';
import type { LoaderSession } from '../../src/util/loader/loader';
import { resolveCountryName } from '../../src/previewdef/worldmap/loader/countrylocalisation';

async function withMocks(mocks: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const originalLoad = loader._load;
    const originalCache = { ...require.cache };
    for (const key of Object.keys(require.cache)) {
        if (/[\\/]src[\\/]/.test(key)) { delete require.cache[key]; }
    }
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop()!;
        if (Object.hasOwn(mocks, name)) { return mocks[name]; }
        if (/\.(?:html|css)$/.test(request)) { return ''; }
        if (request === 'vscode') {
            class EventEmitter {
                public event = () => ({ dispose() {} });
                public fire(): void {}
            }
            return { EventEmitter, env: { language: 'en' }, workspace: { getConfiguration: () => ({}) },
                l10n: { t: (text: string) => text } };
        }
        return originalLoad.call(this, request, parent, main);
    };
    try { await run(); }
    finally {
        loader._load = originalLoad;
        for (const key of Object.keys(require.cache)) { if (!originalCache[key]) { delete require.cache[key]; } }
        Object.assign(require.cache, originalCache);
    }
}

interface LabelController {
    loadGeneration: number;
    cachedWorldMap: WorldMapData;
    worldMapDependencies?: string[];
    reloadChangedDependencies(): void;
    sendCountryLabels(message: RequestCountryLabelsMessage): Promise<void>;
}

describe('world map lazy country-label sources', () => {
    it('rejects an old result when a nested history changes before lazy dependencies finish loading', async () => {
        let finish!: (value: { result: CountryLabelsData; dependencies: string[]; warnings: [] }) => void;
        let calls = 0;
        let reloads = 0;
        const posted: WorldMapMessage[] = [];
        const labels: CountryLabelsData = { histories: [], localisations: {}, conditionExprs: [], mapFont: undefined };
        await withMocks({ worldmaploader: { WorldMapLoader: class {
            public onProgress = () => ({ dispose() {} });
            public clearCache(): void {}
            public loadCountryLabels(): Promise<{ result: CountryLabelsData; dependencies: string[]; warnings: [] }> {
                calls++;
                return calls === 1 ? new Promise(resolve => { finish = resolve; }) :
                    Promise.resolve({ result: labels, dependencies: ['history/countries/*'], warnings: [] });
            }
        } } }, async () => {
            const { WorldMap } = require('../../src/previewdef/worldmap/worldmap') as typeof import('../../src/previewdef/worldmap/worldmap');
            const panel = { webview: { postMessage: async (message: WorldMapMessage) => { posted.push(message); return true; } } } as unknown as WebviewPanel;
            const controller = new WorldMap(panel);
            const internals = controller as unknown as LabelController;
            internals.loadGeneration = 1;
            internals.cachedWorldMap = { width: 1, height: 1 } as WorldMapData;
            internals.reloadChangedDependencies = () => { reloads++; };
            const request = internals.sendCountryLabels({ command: 'requestcountrylabels', loadGeneration: 1, requestId: 1 });
            assert.ok(internals.worldMapDependencies?.includes('history/countries/*'));
            controller.onDocumentChange({ path: '/mod/history/countries/nested/AAA - Country.txt',
                toString: () => 'file:///mod/history/countries/nested/AAA - Country.txt' } as Uri);
            assert.strictEqual(reloads, 1);
            finish({ result: labels, dependencies: ['history/countries/*'], warnings: [] });
            await request;
            assert.strictEqual(posted.length, 0, 'a source revision must reject stale data even before the map reload debounce fires');
            await internals.sendCountryLabels({ command: 'requestcountrylabels', loadGeneration: 1, requestId: 2 });
            assert.strictEqual(calls, 2, 'a cancelled source revision must not poison the next label request');
            assert.strictEqual(posted[0]?.command, 'countrylabels');
            assert.strictEqual(posted[0]?.command === 'countrylabels' && posted[0].requestId, 2);
        });
    });

    it('keeps mod history ahead of a differently named base-game history for the same tag', async () => {
        const files: Record<string, string> = {
            'history/countries/AAA - z_mod.txt': 'set_politics = { ruling_party = neutrality }',
            'history/countries/AAA - a_base.txt': 'set_politics = { ruling_party = democratic }',
        };
        await withMocks({ fileloader: {
            listFilesFromModOrHOI4: async () => Object.keys(files).map(file => file.slice('history/countries/'.length)),
            readFileFromModOrHOI4: async (file: string) => [Buffer.from(files[file])],
        }, localisationIndex: { getLocalisedTextQuickIfReady: (key: string) => ({ AAA_neutrality: 'Mod name', AAA_democratic: 'Base name' } as Record<string, string>)[key] },
        mapfont: { loadMapFont: async () => ({ result: undefined, dependencies: [], warnings: [] }) } }, async () => {
            const { loadCountryLabelsData } = require('../../src/previewdef/worldmap/loader/countrylabels') as typeof import('../../src/previewdef/worldmap/loader/countrylabels');
            const country = { tag: 'AAA', localisedName: undefined, color: 0, file: 'common/countries/AAA.txt' };
            const result = await loadCountryLabelsData([country], [], { throwIfCancelled() {} } as unknown as LoaderSession);
            assert.strictEqual(resolveCountryName(country, result.result, []), 'Mod name');
        });
    });

    it('keeps a mod font and its override ahead of lower-priority definition files', async () => {
        const files: Record<string, string> = {
            'interface/a_mod.gfx': 'bitmapfonts = { bitmapfont = { name = tahoma_60 path = "gfx/fonts/mod_base" } bitmapfont_override = { name = tahoma_60 path = "gfx/fonts/mod_override" } }',
            'interface/z_dependency.gfx': 'bitmapfonts = { bitmapfont = { name = tahoma_60 path = "gfx/fonts/dependency" } }',
            'gfx/fonts/mod_override.fnt': 'common lineHeight=1\nchar id=65 x=0 y=0 width=1 height=1 xoffset=0 yoffset=0 xadvance=1',
        };
        const reads: string[] = [];
        const image = PNG.sync.write(new PNG({ width: 1, height: 1 }));
        await withMocks({ fileloader: {
            listFilesFromModOrHOI4: async () => ['a_mod.gfx', 'z_dependency.gfx'],
            readFileFromModOrHOI4: async (file: string) => {
                reads.push(file);
                if (!files[file]) { throw new Error('Unexpected font source ' + file); }
                return [Buffer.from(files[file])];
            },
        }, imagecache: { getImageByPath: async (file: string) => {
            assert.strictEqual(file, 'gfx/fonts/mod_override.dds');
            return { pngBuffer: image };
        } } }, async () => {
            const { loadMapFont } = require('../../src/previewdef/worldmap/loader/mapfont') as typeof import('../../src/previewdef/worldmap/loader/mapfont');
            const result = await loadMapFont(['A'], { throwIfCancelled() {} } as unknown as LoaderSession);
            assert.ok(result.result?.glyphs[65]);
            assert.ok(reads.includes('gfx/fonts/mod_override.fnt'));
            assert.ok(!reads.includes('interface/z_dependency.gfx'));
        });
    });
});
