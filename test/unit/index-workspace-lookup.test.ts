import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import Module = require('module');
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type * as FocusIndexApi from '../../src/util/sharedFocusIndex';
import type * as GfxIndexApi from '../../src/util/gfxindex';
import type { Node } from '../../src/hoiformat/hoiparser';

interface ReadOptions { mod?: boolean; hoi4?: boolean; dlc?: boolean; }
interface Target {
    build(size: [number], signal: AbortSignal): Promise<unknown>;
    commit(snapshot: unknown): void;
    reset(): void;
}
interface Harness {
    enabled: boolean;
    workspaceFiles: Record<string, string>;
    baseFiles: Record<string, string>;
    dlcFiles: Record<string, string>;
    reads: string[];
    globalLists: number;
    services: TestIndexService[];
    globalGate: Promise<void>;
}
class TestIndexService {
    private readonly ready = new Set<string>();
    private readonly pending = new Map<string, Promise<void>>();
    constructor(private readonly targets: Record<string, Target>) {}
    ensure(id: string): Promise<void> {
        if (this.ready.has(id)) { return Promise.resolve(); }
        const pending = this.pending.get(id);
        if (pending) { return pending; }
        const task = this.targets[id].build([0], new AbortController().signal).then(snapshot => {
            this.targets[id].commit(snapshot); this.ready.add(id);
        });
        this.pending.set(id, task);
        return task;
    }
    isReady(id: string): boolean { return this.ready.has(id); }
    invalidate(id: string): void { this.ready.delete(id); this.pending.delete(id); this.targets[id].reset(); }
}

async function loadIndex(file: 'sharedFocusIndex' | 'gfxindex', harness: Harness): Promise<typeof FocusIndexApi | typeof GfxIndexApi> {
    const sourcePath = path.resolve(__dirname, '../../../src/util', `${file}.ts`);
    const realRequire = createRequire(path.resolve(__dirname, '../../src/util', `${file}.js`));
    const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
    const originalLoad = nodeModule._load;
    nodeModule._load = function(request, parent, isMain) {
        if (request === 'vscode') { return { workspace: { getConfiguration: () => ({ featureFlags: [] }) } }; }
        return originalLoad.call(nodeModule, request, parent, isMain);
    };
    let focusExtractor: (node: Node) => string[];
    try { ({ extractFocusIds: focusExtractor } = realRequire('../previewdef/focustree/focustreeschematypes')); }
    finally { nodeModule._load = originalLoad; }
    const { parseHoi4File } = realRequire('../hoiformat/hoiparser');
    const { getSpriteTypes } = realRequire('../hoiformat/spritetype');
    const output = transpileModule(await fs.readFile(sourcePath, 'utf8'), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    const chooseFiles = (options: ReadOptions): Record<string, string> => options.mod ? harness.workspaceFiles : options.dlc ? harness.dlcFiles : harness.baseFiles;
    const customRequire = (request: string): unknown => {
        if (request === 'vscode') { return {}; }
        if (request === './common') {
            return {
                debounceByInput: (callback: unknown) => callback,
                mapWithConcurrency: (files: string[], _limit: number, callback: (file: string) => Promise<void>) => Promise.all(files.map(callback)),
                forceError: (error: unknown) => error, UserError: Error,
            };
        }
        if (request === '../services/indexService') {
            return { IndexService: class extends TestIndexService {
                constructor(targets: Record<string, Target>) { super(targets); harness.services.push(this); }
            } };
        }
        if (request === './featureflags') { return { isSharedFocusIndexEnabled: () => harness.enabled, isGfxIndexEnabled: () => harness.enabled }; }
        if (request === './fileloader') {
            return {
                listFilesFromModOrHOI4: async (_folder: string, options: ReadOptions) => {
                    if (!options.mod) { harness.globalLists++; await harness.globalGate; }
                    return Object.keys(chooseFiles(options));
                },
                readFileFromModOrHOI4: async (file: string, options: ReadOptions) => {
                    harness.reads.push(file);
                    const relative = file.slice(file.lastIndexOf('/') + 1);
                    return [Buffer.from(chooseFiles(options)[relative]), { toString: () => file }];
                },
            };
        }
        if (request === './compute/indexextraction') {
            return { extractScriptIndex: async (kind: string, bytes: Buffer) => {
                const node = parseHoi4File(bytes.toString());
                if (kind === 'gfx-index') { return getSpriteTypes(node).map((sprite: { name: string }) => sprite.name); }
                return focusExtractor(node);
            } };
        }
        if (request === './i18n') { return { localize: (_key: string, fallback: string) => fallback }; }
        if (request === './logger') { return { Logger: { error: (error: unknown) => { throw error; } } }; }
        if (request === './debug') { return { error: (error: unknown) => { throw error; } }; }
        if (request === './modfile') { return {}; }
        if (request === './nodecommon') { return {}; }
        return realRequire(request);
    };
    vm.runInNewContext(output, { exports, require: customRequire, AbortController, Buffer, console, setTimeout, clearTimeout }, { filename: sourcePath });
    return exports as typeof FocusIndexApi | typeof GfxIndexApi;
}

describe('ready workspace index lookup cutover', function() {
    this.timeout(5_000);
    for (const kind of ['sharedFocusIndex', 'gfxindex'] as const) {
        it(`${kind} returns committed workspace hits without waiting for global files and preserves fallback layers`, async () => {
            let release!: () => void;
            const source = (name: string): string => kind === 'gfxindex'
                ? `spritetypes = { spritetype = { name = ${name} texturefile = a } }`
                : `shared_focus = { id = ${name} }`;
            const extension = kind === 'gfxindex' ? 'gfx' : 'txt';
            const folder = kind === 'gfxindex' ? 'interface' : 'common/national_focus';
            const harness: Harness = {
                enabled: true, workspaceFiles: { [`mod.${extension}`]: source('SHARED') },
                baseFiles: { [`base.${extension}`]: source('BASE_ONLY'), [`duplicate.${extension}`]: source('SHARED') },
                dlcFiles: { [`dlc.${extension}`]: source('DLC_ONLY') }, reads: [], globalLists: 0, services: [],
                globalGate: new Promise(resolve => { release = resolve; }),
            };
            const api = await loadIndex(kind, harness);
            const lookup = 'findFileByFocusKey' in api ? api.findFileByFocusKey : api.getGfxContainerFile;
            const tryLookup = 'tryFindFileByFocusKey' in api ? api.tryFindFileByFocusKey : api.tryGetGfxContainerFile;
            try {
                assert.strictEqual(await lookup('SHARED'), `${folder}/mod.${extension}`);
                assert.strictEqual(harness.globalLists, 0, 'workspace hits must not perform global I/O');
                assert.strictEqual(tryLookup('SHARED'), `${folder}/mod.${extension}`);
                assert.strictEqual(tryLookup('BASE_ONLY'), undefined, 'unbuilt global fallback must not leak a partial result');
                const missingWorkspace = lookup('DLC_ONLY');
                assert.strictEqual(tryLookup('DLC_ONLY'), undefined);
                release();
                assert.strictEqual(await missingWorkspace, `${folder}/dlc.${extension}`);
                assert.strictEqual(await lookup('BASE_ONLY'), `${folder}/base.${extension}`);
                assert.strictEqual(await lookup('SHARED'), `${folder}/mod.${extension}`);
                harness.services[0].invalidate('workspace');
                assert.strictEqual(tryLookup('SHARED'), undefined, 'global data must not bypass an invalidated workspace layer');
                harness.enabled = false;
                const readCount = harness.reads.length;
                assert.strictEqual(await lookup('SHARED'), undefined);
                assert.strictEqual(tryLookup('SHARED'), undefined);
                assert.strictEqual(harness.reads.length, readCount, 'disabled indexes must not schedule reads');
            } finally { release(); }
        });
    }
});
