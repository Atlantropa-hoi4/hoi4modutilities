import * as assert from 'assert';
import Module = require('module');
import type { IndexCacheSpec } from '../../src/services/indexCache';

type CacheApi = typeof import('../../src/services/indexCache');
type Layer = 'base' | 'dlc' | 'workspace';
interface SourceFile {
    version: string;
    opened?: boolean;
    text?: string;
}
interface MockUri {
    path: string;
    toString(): string;
}
interface FingerprintHarness {
    previewLocalisation: string;
    sources: Record<Layer, Record<string, SourceFile>>;
    resolved: string[];
    versionReads: string[];
    bufferReads: string[];
    beforeList?: () => Promise<void>;
}

const globalSpec: IndexCacheSpec = {
    folder: 'localisation', extension: '.yml', layer: 'global',
    includeFile: file => /(?:^|[ _-])l_(?:english|korean)\.yml$/i.test(file),
};
const signal = () => new AbortController().signal;

describe('index cache input filtering', () => {
    it('excludes irrelevant languages before resolving or statting base and DLC inputs', async () => {
        await withFingerprintMocks(async (api, harness) => {
            const first = await api.indexFingerprint(globalSpec, signal());
            assert.deepStrictEqual(harness.resolved, [
                'base/base_l_english.yml', 'base/base_l_korean.yml',
                'dlc/dlc_l_english.yml', 'dlc/dlc_l_korean.yml',
            ]);
            assert.deepStrictEqual(harness.versionReads, harness.resolved);
            assert.deepStrictEqual(harness.bufferReads, []);

            harness.sources.base['base_l_russian.yml'].version = 'changed';
            harness.sources.dlc['dlc_l_russian.yml'].version = 'changed';
            harness.sources.base['added_l_french.yml'] = { version: 'new' };
            assert.strictEqual(await api.indexFingerprint(globalSpec, signal()), first);

            for (const layer of ['base', 'dlc'] as const) {
                for (const language of ['english', 'korean']) {
                    const file = harness.sources[layer][`${layer}_l_${language}.yml`];
                    const before = await api.indexFingerprint(globalSpec, signal());
                    file.version += '-changed';
                    assert.notStrictEqual(await api.indexFingerprint(globalSpec, signal()), before);
                }
            }
        });
    });

    it('invalidates when eligible files are added, renamed, or removed', async () => {
        await withFingerprintMocks(async (api, harness) => {
            const initial = await api.indexFingerprint(globalSpec, signal());
            const source = { version: 'new' };
            harness.sources.dlc['new_l_korean.yml'] = source;
            const added = await api.indexFingerprint(globalSpec, signal());
            assert.notStrictEqual(added, initial);

            delete harness.sources.dlc['new_l_korean.yml'];
            harness.sources.dlc['renamed_l_korean.yml'] = source;
            assert.notStrictEqual(await api.indexFingerprint(globalSpec, signal()), added);
            delete harness.sources.dlc['renamed_l_korean.yml'];
            assert.strictEqual(await api.indexFingerprint(globalSpec, signal()), initial);
        });
    });

    it('fingerprints eligible unsaved buffers while ignoring irrelevant unsaved buffers', async () => {
        await withFingerprintMocks(async (api, harness) => {
            const eligible = harness.sources.base['base_l_korean.yml'];
            const irrelevant = harness.sources.dlc['dlc_l_russian.yml'];
            eligible.opened = irrelevant.opened = true;
            eligible.text = irrelevant.text = 'original';
            const initial = await api.indexFingerprint(globalSpec, signal());
            assert.deepStrictEqual(harness.bufferReads, ['base/base_l_korean.yml']);
            assert.ok(!harness.versionReads.includes('base/base_l_korean.yml'));

            irrelevant.text = 'irrelevant unsaved edit';
            assert.strictEqual(await api.indexFingerprint(globalSpec, signal()), initial);
            eligible.text = 'eligible unsaved edit';
            assert.notStrictEqual(await api.indexFingerprint(globalSpec, signal()), initial);
        });
    });

    it('retains unfiltered workspace fingerprints and default cache behavior', async () => {
        await withFingerprintMocks(async (api, harness) => {
            const workspaceSpec: IndexCacheSpec = { folder: 'localisation', extension: '.yml', layer: 'workspace' };
            const initial = await api.indexFingerprint(workspaceSpec, signal());
            assert.deepStrictEqual(harness.resolved, [
                'workspace/mod_l_english.yml', 'workspace/mod_l_korean.yml', 'workspace/mod_l_russian.yml',
            ]);
            harness.sources.workspace['mod_l_russian.yml'].version = 'changed';
            assert.notStrictEqual(await api.indexFingerprint(workspaceSpec, signal()), initial);

            harness.resolved.length = 0;
            const { includeFile: _includeFile, ...unfiltered } = globalSpec;
            await api.indexFingerprint(unfiltered, signal());
            assert.ok(harness.resolved.includes('base/base_l_russian.yml'));
            assert.ok(harness.resolved.includes('dlc/dlc_l_russian.yml'));
            assert.ok(!harness.resolved.includes('base/notes.txt'));
        });
    });

    it('captures a selector once before asynchronous listing and separates language namespaces', async () => {
        await withFingerprintMocks(async (api, harness) => {
            let selectorReads = 0;
            const spec: IndexCacheSpec = {
                folder: 'localisation', extension: '.yml', layer: 'global',
                get includeFile() {
                    selectorReads += 1;
                    const suffix = harness.previewLocalisation === 'Korean' ? 'l_korean.yml' : 'l_russian.yml';
                    return (file: string) => file.endsWith('l_english.yml') || file.endsWith(suffix);
                },
            };
            const firstUri = api.indexCacheUri('localisationIndex')!.toString();
            harness.beforeList = async () => { harness.previewLocalisation = 'Russian'; };
            const koreanFingerprint = await api.indexFingerprint(spec, signal());
            assert.strictEqual(selectorReads, 1);
            assert.deepStrictEqual(harness.resolved, [
                'base/base_l_english.yml', 'base/base_l_korean.yml',
                'dlc/dlc_l_english.yml', 'dlc/dlc_l_korean.yml',
            ]);
            assert.notStrictEqual(api.indexCacheUri('localisationIndex')!.toString(), firstUri);
            harness.beforeList = undefined;
            assert.notStrictEqual(await api.indexFingerprint(spec, signal()), koreanFingerprint);
            assert.strictEqual(selectorReads, 2);
        });
    });
});

async function withFingerprintMocks(
    run: (api: CacheApi, harness: FingerprintHarness) => Promise<void>,
): Promise<void> {
    const harness: FingerprintHarness = {
        previewLocalisation: 'Korean', resolved: [], versionReads: [], bufferReads: [],
        sources: {
            base: { 'base_l_english.yml': { version: '1' }, 'base_l_korean.yml': { version: '1' },
                'base_l_russian.yml': { version: '1' }, 'notes.txt': { version: '1' } },
            dlc: { 'dlc_l_english.yml': { version: '1' }, 'dlc_l_korean.yml': { version: '1' }, 'dlc_l_russian.yml': { version: '1' } },
            workspace: { 'mod_l_english.yml': { version: '1' }, 'mod_l_korean.yml': { version: '1' }, 'mod_l_russian.yml': { version: '1' } },
        },
    };
    const uri = (path: string): MockUri => ({ path, toString: () => path });
    const sourceFor = (file: MockUri): SourceFile => {
        const [layer, name] = file.path.split('/');
        return harness.sources[layer as Layer][name];
    };
    const layerFor = (options: { mod?: boolean; hoi4?: boolean }): Layer =>
        options.mod ? 'workspace' : options.hoi4 ? 'base' : 'dlc';
    const mocks: Record<string, unknown> = {
        vscode: {
            Uri: { joinPath: (base: MockUri, ...parts: string[]) => uri([base.path, ...parts].join('/')) },
            workspace: {
                getConfiguration: () => ({ installPath: '/game', loadDlcContents: true, modFile: 'test.mod',
                    previewLocalisation: harness.previewLocalisation }),
                workspaceFolders: [{ uri: uri('/workspace') }],
            },
        },
        context: { contextContainer: { current: { globalStorageUri: uri('/storage') } } },
        fileloader: {
            listFilesFromModOrHOI4: async (_folder: string, options: { mod?: boolean; hoi4?: boolean }) => {
                await harness.beforeList?.();
                return Object.keys(harness.sources[layerFor(options)]);
            },
            getFilePathFromModOrHOI4: async (file: string, options: { mod?: boolean; hoi4?: boolean }) => {
                const path = `${layerFor(options)}/${file.slice('localisation/'.length)}`;
                harness.resolved.push(path);
                return uri(path);
            },
            expiryToken: async (file: MockUri) => { harness.versionReads.push(file.path); return sourceFor(file).version; },
            isHoiFileOpened: (file: MockUri) => sourceFor(file).opened,
            readFileFromPath: async (file: MockUri) => { harness.bufferReads.push(file.path); return [Buffer.from(sourceFor(file).text!)]; },
        },
    };
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const original = loader._load;
    const cached = { ...require.cache };
    delete require.cache[require.resolve('../../src/services/indexCache')];
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop()!;
        return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, request, parent, main);
    };
    try {
        const api = require('../../src/services/indexCache') as CacheApi;
        await run(api, harness);
    } finally {
        loader._load = original;
        for (const key of Object.keys(require.cache)) {
            if (!cached[key]) { delete require.cache[key]; }
        }
        Object.assign(require.cache, cached);
    }
}
