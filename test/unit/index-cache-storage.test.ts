import * as assert from 'assert';
import * as path from 'node:path';
import Module = require('module');
import { createHash } from 'node:crypto';
import type * as CacheModule from '../../src/services/indexCache';
import type { Uri } from 'vscode';
import { registerIndexSerialization } from '../../src/services/indexSerialization';
import { maxIndexCacheBytes } from '../../src/services/indexSerializationProtocol';

interface MemoryUri {
    path: string;
    toString(): string;
    with(change: { path: string }): MemoryUri;
}
interface StorageHarness {
    files: Map<string, Uint8Array>;
    renames: string[];
    reads: number;
    reportedSize?: number;
    beforeWrite?: () => Promise<void>;
    beforeRename?: () => Promise<void>;
}

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function withStorage(run: (api: typeof CacheModule, uri: Uri, harness: StorageHarness) => Promise<void>): Promise<void> {
    const harness: StorageHarness = { files: new Map(), renames: [], reads: 0 };
    const uri = (file: string): MemoryUri => ({ path: file, toString: () => file, with: change => uri(change.path) });
    const mocks = {
        Uri: { joinPath: (base: MemoryUri, ...parts: string[]) => uri(path.posix.join(base.path, ...parts)) },
        workspace: {
            getConfiguration: () => ({ installPath: '/game', modFile: 'mod', previewLocalisation: 'Korean' }),
            workspaceFolders: [{ uri: uri('/workspace') }],
            fs: {
                stat: async (file: MemoryUri) => {
                    const bytes = harness.files.get(file.path);
                    if (!bytes) { throw new Error('Absent cache.'); }
                    return { size: harness.reportedSize ?? bytes.byteLength };
                },
                readFile: async (file: MemoryUri) => { harness.reads++; return harness.files.get(file.path)!; },
                createDirectory: async () => undefined,
                writeFile: async (file: MemoryUri, bytes: Uint8Array) => {
                    await harness.beforeWrite?.();
                    harness.files.set(file.path, bytes.slice());
                },
                rename: async (from: MemoryUri, to: MemoryUri) => {
                    await harness.beforeRename?.();
                    const bytes = harness.files.get(from.path)!;
                    harness.files.set(to.path, bytes);
                    harness.files.delete(from.path);
                    harness.renames.push(to.path);
                },
                delete: async (file: MemoryUri) => { harness.files.delete(file.path); },
            },
        },
    };
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const originalLoad = loader._load;
    const modulePath = require.resolve('../../src/services/indexCache');
    const cachedModule = require.cache[modulePath];
    delete require.cache[modulePath];
    loader._load = function(request, parent, main) {
        if (request === 'vscode') { return mocks; }
        if (request.endsWith('/context')) { return { contextContainer: { current: { globalStorageUri: uri('/storage') } } }; }
        return originalLoad.call(this, request, parent, main);
    };
    const registration = registerIndexSerialization(path.resolve(__dirname, '../../..'));
    try {
        const api = require('../../src/services/indexCache') as typeof CacheModule;
        const target = api.indexCacheUri('localisation')!;
        assert.ok(target.path.includes('/indexes-v2/'));
        assert.ok(target.path.endsWith('.cache'));
        await run(api, target, harness);
    } finally {
        registration.dispose();
        loader._load = originalLoad;
        delete require.cache[modulePath];
        if (cachedModule) { require.cache[modulePath] = cachedModule; }
    }
}

const fingerprint = createHash('sha256').update('real source').digest('hex');

describe('index cache storage publication', () => {
    it('roundtrips the real worker snapshot and ignores fingerprint/corruption/stat and read oversize failures', async () => {
        await withStorage(async (api, uri, harness) => {
            const snapshot = { index: { id: { l_korean: '캐시 원문', l_english: 'cache value' } } };
            const signal = new AbortController().signal;
            await api.saveIndexCache(uri, fingerprint, snapshot, signal);
            assert.deepStrictEqual(await api.readIndexCache(uri, fingerprint), snapshot);
            assert.strictEqual(await api.readIndexCache(uri, '0'.repeat(64)), undefined);
            const bytes = harness.files.get(uri.path)!;
            bytes[bytes.length - 2] ^= 1;
            assert.strictEqual(await api.readIndexCache(uri, fingerprint), undefined);
            const reads = harness.reads;
            harness.reportedSize = maxIndexCacheBytes + 1;
            assert.strictEqual(await api.readIndexCache(uri, fingerprint), undefined);
            assert.strictEqual(harness.reads, reads, 'oversized stat must reject before read');
            harness.reportedSize = 1;
            harness.files.set(uri.path, new Uint8Array(maxIndexCacheBytes + 1));
            assert.strictEqual(await api.readIndexCache(uri, fingerprint), undefined);
            assert.deepStrictEqual([...harness.files.keys()], [uri.path]);
        });
    });

    it('cancels a held temporary write before rename and serializes a newer snapshot behind cleanup', async () => {
        await withStorage(async (api, uri, harness) => {
            const entered = gate();
            const release = gate();
            harness.beforeWrite = async () => { entered.resolve(); await release.promise; };
            const oldController = new AbortController();
            const old = api.saveIndexCache(uri, fingerprint, { index: { id: 'old' } }, oldController.signal);
            await entered.promise;
            oldController.abort();
            const newest = { index: { id: 'new' } };
            const next = api.saveIndexCache(uri, fingerprint, newest, new AbortController().signal);
            release.resolve();
            await Promise.all([old, next]);
            assert.strictEqual(harness.renames.length, 1);
            assert.deepStrictEqual(await api.readIndexCache(uri, fingerprint), newest);
            assert.deepStrictEqual([...harness.files.keys()], [uri.path], 'cancelled temporary file must be deleted');
        });
    });

    it('retires a rename cancelled while the filesystem operation is already in progress', async () => {
        await withStorage(async (api, uri, harness) => {
            const entered = gate();
            const release = gate();
            harness.beforeRename = async () => { entered.resolve(); await release.promise; };
            const controller = new AbortController();
            const pending = api.saveIndexCache(uri, fingerprint, { index: { id: 'cancelled' } }, controller.signal);
            await entered.promise;
            controller.abort();
            release.resolve();
            await pending;
            assert.strictEqual(harness.files.has(uri.path), false);
            assert.deepStrictEqual([...harness.files.keys()], []);
        });
    });

    it('cannot let an already-started stale rename overwrite a newer publication', async () => {
        await withStorage(async (api, uri, harness) => {
            const entered = gate();
            const release = gate();
            let calls = 0;
            harness.beforeRename = async () => { if (++calls === 1) { entered.resolve(); await release.promise; } };
            const oldController = new AbortController();
            const old = api.saveIndexCache(uri, fingerprint, { index: { id: 'old' } }, oldController.signal);
            await entered.promise;
            oldController.abort();
            const newest = { index: { id: 'new' } };
            const next = api.saveIndexCache(uri, fingerprint, newest, new AbortController().signal);
            assert.strictEqual(calls, 1, 'the newer rename must wait for the older filesystem operation');
            release.resolve();
            await Promise.all([old, next]);
            assert.strictEqual(calls, 2);
            assert.deepStrictEqual(await api.readIndexCache(uri, fingerprint), newest);
            assert.deepStrictEqual([...harness.files.keys()], [uri.path]);
        });
    });
});
