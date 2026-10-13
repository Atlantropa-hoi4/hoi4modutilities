import * as assert from 'assert';
import Module = require('module');
import type * as CacheModule from '../../src/services/indexCache';
import { isEventIndexSnapshot, isLocalisationIndexSnapshot } from '../../src/services/indexSnapshotValidation';

type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
};

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            window: {
                setStatusBarMessage: () => undefined,
            },
        };
    }

    if (request.endsWith('/localizer') || request.endsWith('\\localizer')) {
        return {
            localizer: {
                t: (message: string) => message,
            },
        };
    }

    if (request.endsWith('/telemetry') || request.endsWith('\\telemetry')) {
        return {
            sendEvent: () => undefined,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    IndexService,
} = require('../../src/services/indexService') as typeof import('../../src/services/indexService');
nodeModule._load = originalLoad;

describe('index service', () => {
    it('cancels an in-flight build without committing it and permits a fresh retry', async () => {
        const deferred = createDeferred<string>();
        const commits: string[] = [];
        let builds = 0;
        let signal: AbortSignal | undefined;
        const service = new IndexService({ test: {
            build: async (_size, currentSignal) => { signal = currentSignal; return builds++ === 0 ? deferred.promise : 'retry'; },
            commit: snapshot => commits.push(snapshot), reset: () => undefined,
            statusMessage: 'Building', telemetryEvent: 'test',
        } });
        const pending = service.ensure('test', { showStatusBar: false });
        const rejected = assert.rejects(pending, /cancelled/);
        service.cancel('test');
        assert.strictEqual(signal?.aborted, true);
        deferred.resolve('cancelled snapshot');
        await rejected;
        assert.deepStrictEqual(commits, []);
        assert.strictEqual(service.isReady('test'), false);
        await service.ensure('test', { showStatusBar: false });
        assert.deepStrictEqual(commits, ['retry']);
    });
    it('commits only the newest snapshot and makes stale callers wait for it', async () => {
        const builds: Deferred<string>[] = [];
        const commits: string[] = [];
        let activeSnapshot: string | undefined;
        let resetCount = 0;
        const service = new IndexService({
            workspace: {
                build: async (estimatedSize: [number]) => {
                    estimatedSize[0] = builds.length + 1;
                    const deferred = createDeferred<string>();
                    builds.push(deferred);
                    return deferred.promise;
                },
                commit: snapshot => {
                    commits.push(snapshot);
                    activeSnapshot = snapshot;
                },
                reset: () => {
                    resetCount += 1;
                    activeSnapshot = undefined;
                },
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const firstEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(builds.length, 1);
        assert.strictEqual(service.isActive('workspace'), true);

        service.invalidate('workspace');
        assert.strictEqual(resetCount, 1);
        assert.strictEqual(service.isReady('workspace'), false);
        assert.strictEqual(service.isActive('workspace'), false);

        const secondEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(builds.length, 2);
        assert.notStrictEqual(firstEnsure, secondEnsure);
        assert.strictEqual(service.isActive('workspace'), true);

        let firstEnsureSettled = false;
        firstEnsure.finally(() => {
            firstEnsureSettled = true;
        });
        builds[0].resolve('stale');
        await waitForMicrotasks();
        assert.strictEqual(firstEnsureSettled, false);
        assert.deepStrictEqual(commits, []);
        assert.strictEqual(activeSnapshot, undefined);
        assert.strictEqual(service.isReady('workspace'), false);

        builds[1].resolve('current');
        await Promise.all([firstEnsure, secondEnsure]);
        assert.deepStrictEqual(commits, ['current']);
        assert.strictEqual(activeSnapshot, 'current');
        assert.strictEqual(service.isReady('workspace'), true);
        assert.strictEqual(service.isActive('workspace'), true);
    });

    it('reuses the same in-flight build within one generation', async () => {
        const deferred = createDeferred<string>();
        let buildCount = 0;
        const commits: string[] = [];
        const service = new IndexService({
            workspace: {
                build: async () => {
                    buildCount += 1;
                    return deferred.promise;
                },
                commit: snapshot => commits.push(snapshot),
                reset: () => undefined,
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const firstEnsure = service.ensure('workspace', { showStatusBar: false });
        const secondEnsure = service.ensure('workspace', { showStatusBar: false });

        assert.strictEqual(buildCount, 1);
        assert.strictEqual(firstEnsure, secondEnsure);

        deferred.resolve('current');
        await firstEnsure;
        assert.deepStrictEqual(commits, ['current']);
    });

    it('automatically rebuilds the latest generation for a stale caller', async () => {
        const builds: Deferred<string>[] = [];
        const commits: string[] = [];
        const service = new IndexService({
            workspace: {
                build: async () => {
                    const deferred = createDeferred<string>();
                    builds.push(deferred);
                    return deferred.promise;
                },
                commit: snapshot => commits.push(snapshot),
                reset: () => undefined,
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const ensure = service.ensure('workspace', { showStatusBar: false });
        service.invalidate('workspace');
        builds[0].resolve('stale');

        await waitForMicrotasks();
        assert.strictEqual(builds.length, 2);
        assert.deepStrictEqual(commits, []);

        builds[1].resolve('current');
        await ensure;
        assert.deepStrictEqual(commits, ['current']);
        assert.strictEqual(service.isReady('workspace'), true);
    });

    it('propagates a current-generation build failure and permits an explicit retry', async () => {
        const builds: Deferred<string>[] = [];
        const commits: string[] = [];
        const service = new IndexService({
            workspace: {
                build: async () => {
                    const deferred = createDeferred<string>();
                    builds.push(deferred);
                    return deferred.promise;
                },
                commit: snapshot => commits.push(snapshot),
                reset: () => undefined,
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const firstEnsure = service.ensure('workspace', { showStatusBar: false });
        builds[0].reject(new Error('build failed'));
        await assert.rejects(firstEnsure, /build failed/);
        assert.strictEqual(builds.length, 1);
        assert.strictEqual(service.isReady('workspace'), false);

        const secondEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(builds.length, 2);
        builds[1].resolve('recovered');
        await secondEnsure;
        assert.deepStrictEqual(commits, ['recovered']);
    });

    it('rebuilds an active target without eagerly starting an unused target', async () => {
        const builds: Deferred<string>[] = [];
        const commits: string[] = [];
        let resetCount = 0;
        const service = new IndexService({
            workspace: {
                build: async () => {
                    const deferred = createDeferred<string>();
                    builds.push(deferred);
                    return deferred.promise;
                },
                commit: snapshot => commits.push(snapshot),
                reset: () => {
                    resetCount += 1;
                },
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        assert.strictEqual(service.rebuildIfActive('workspace', { showStatusBar: false }), false);
        assert.strictEqual(builds.length, 0);

        const staleEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(service.rebuildIfActive('workspace', { showStatusBar: false }), true);
        assert.strictEqual(resetCount, 1);
        await waitForMicrotasks();
        assert.strictEqual(builds.length, 2);

        builds[0].resolve('stale');
        builds[1].resolve('current');
        await staleEnsure;
        assert.deepStrictEqual(commits, ['current']);
    });

    it('publishes the exact usable snapshot and settles ensure/warm before a held storage save', async () => {
        await withCachePersistence(async harness => {
            const snapshot = { index: { id: { l_korean: '실제 값', l_english: 'real value' } } };
            let visible: typeof snapshot | undefined;
            const service = new IndexService({ workspace: {
                cache: { folder: 'localisation', extension: '.yml', layer: 'workspace' },
                validateCacheSnapshot: (value): value is typeof snapshot => isLocalisationIndexSnapshot(value)
                    && typeof value.index.id?.l_korean === 'string' && typeof value.index.id?.l_english === 'string',
                build: async () => snapshot, commit: value => { visible = value; }, reset: () => { visible = undefined; },
                statusMessage: 'Building', telemetryEvent: 'workspace',
            } });
            try {
                await service.ensure('workspace', { showStatusBar: false });
                assert.strictEqual(service.isReady('workspace'), true);
                assert.strictEqual(visible, snapshot);
                assert.ok(visible);
                assert.strictEqual(visible.index.id.l_korean, '실제 값');
                await service.warm(['workspace'], { showStatusBar: false });
                await harness.entered.promise;
                assert.strictEqual(harness.saves[0].value, snapshot);
                assert.strictEqual(harness.finished, false, 'readiness must not wait for storage completion');
                service.cancel('workspace');
                assert.strictEqual(harness.saves[0].signal.aborted, true);
                assert.strictEqual(service.isReady('workspace'), true, 'cache cancellation must not discard memory');
            } finally {
                harness.release.resolve();
                service.dispose();
            }
        });
    });

    it('aborts detached saves on invalidation/disposal and only publishes the latest in-memory generation', async () => {
        await withCachePersistence(async harness => {
            let builds = 0;
            const snapshots = [{ index: { current: 'old' } }, { index: { current: 'new' } }];
            const commits: typeof snapshots = [];
            const service = new IndexService({ workspace: {
                cache: { folder: 'localisation', extension: '.yml', layer: 'workspace' },
                validateCacheSnapshot: (value): value is (typeof snapshots)[number] => isEventIndexSnapshot(value)
                    && typeof value.index.current === 'string',
                build: async () => snapshots[builds++], commit: value => commits.push(value), reset: () => undefined,
                statusMessage: 'Building', telemetryEvent: 'workspace',
            } });
            await service.ensure('workspace', { showStatusBar: false });
            await harness.entered.promise;
            service.invalidate('workspace');
            assert.strictEqual(harness.saves[0].signal.aborted, true);
            await service.ensure('workspace', { showStatusBar: false });
            assert.deepStrictEqual(commits, snapshots);
            assert.strictEqual(service.isReady('workspace'), true);
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.strictEqual(harness.saves.length, 2);
            assert.strictEqual(harness.saves[1].value, snapshots[1]);
            service.dispose();
            assert.strictEqual(harness.saves[1].signal.aborted, true);
            assert.strictEqual(service.isReady('workspace'), false);
            harness.release.resolve();
            await assert.rejects(service.ensure('workspace'), /cancelled/);
        });
    });

    it('rejects cross-source snapshots before committing and rebuilds against the current fingerprint', async () => {
        await withCachePersistence(async harness => {
            harness.fingerprints = ['old', 'new', 'new', 'new'];
            const commits: string[] = [];
            let builds = 0;
            const service = new IndexService({ workspace: {
                cache: { folder: 'events', extension: '.txt', layer: 'all' },
                validateCacheSnapshot: (value): value is string => typeof value === 'string',
                build: async () => ++builds === 1 ? 'cross-source' : 'current',
                commit: value => commits.push(value), reset: () => undefined,
                statusMessage: 'Building', telemetryEvent: 'workspace',
            } });
            try {
                await service.ensure('workspace', { showStatusBar: false });
                assert.strictEqual(builds, 2);
                assert.deepStrictEqual(commits, ['current']);
                assert.strictEqual(service.isReady('workspace'), true);
                await harness.entered.promise;
                assert.strictEqual(harness.saves[0].fingerprint, 'new');
            } finally { harness.release.resolve(); service.dispose(); }
        });
    });

    it('contains detached persistence rejection without changing ready state', async () => {
        await withCachePersistence(async harness => {
            const service = new IndexService({ workspace: {
                cache: { folder: 'events', extension: '.txt', layer: 'all' },
                validateCacheSnapshot: isEventIndexSnapshot,
                build: async () => ({ index: { id: 'value' } }), commit: () => undefined, reset: () => undefined,
                statusMessage: 'Building', telemetryEvent: 'workspace',
            } });
            await service.ensure('workspace', { showStatusBar: false });
            await harness.entered.promise;
            harness.release.reject(new Error('storage failure'));
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.strictEqual(service.isReady('workspace'), true);
            service.dispose();
        });
    });

    it('validates cache target schemas before committing and rebuilds malformed persisted snapshots', async () => {
        await withCachePersistence(async harness => {
            const rebuiltIndex: Record<string, string> = Object.create(null);
            rebuiltIndex['namespace.1'] = 'events/sample.txt';
            const rebuilt = { index: rebuiltIndex };
            const commits: { index: Record<string, string> }[] = [];
            let builds = 0;
            const service = new IndexService<{ index: Record<string, string> }>({ events: {
                cache: { folder: 'events', extension: '.txt', layer: 'all' },
                validateCacheSnapshot: isEventIndexSnapshot,
                build: async () => { builds++; return rebuilt; },
                commit: snapshot => commits.push(snapshot), reset: () => undefined,
                statusMessage: 'Building', telemetryEvent: 'events',
            } });
            try {
                for (const malformed of [{}, { index: [] }, { index: { id: 7 } }, { index: { id: { file: 'wrong target' } } }]) {
                    harness.cached = malformed;
                    service.invalidate('events');
                    await service.ensure('events', { showStatusBar: false });
                    assert.strictEqual(commits[commits.length - 1], rebuilt, 'a malformed cache must not be committed or replaced by an empty index');
                }
                assert.strictEqual(builds, 4);
                assert.strictEqual(service.isReady('events'), true);
            } finally { service.dispose(); }
        });
    });

    it('commits a validated real event cache without rebuilding or fabricating a replacement snapshot', async () => {
        await withCachePersistence(async harness => {
            const cached = { index: { 'namespace.1': 'events/sample.txt' } };
            harness.cached = cached;
            let builds = 0;
            let visible: { index: Record<string, string> } | undefined;
            const service = new IndexService<{ index: Record<string, string> }>({ events: {
                cache: { folder: 'events', extension: '.txt', layer: 'all' },
                validateCacheSnapshot: isEventIndexSnapshot,
                build: async () => { builds++; return cached; },
                commit: snapshot => { visible = snapshot; }, reset: () => { visible = undefined; },
                statusMessage: 'Building', telemetryEvent: 'events',
            } });
            try {
                await service.ensure('events', { showStatusBar: false });
                assert.strictEqual(builds, 0);
                assert.strictEqual(visible, cached);
                assert.strictEqual(service.isReady('events'), true);
                assert.deepStrictEqual(harness.saves, []);
            } finally { service.dispose(); }
        });
    });
});

async function waitForMicrotasks(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await Promise.resolve();
    }
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

interface PersistenceHarness {
    entered: Deferred<void>;
    release: Deferred<void>;
    saves: { fingerprint: string; value: unknown; signal: AbortSignal }[];
    fingerprints: string[];
    finished: boolean;
    cached?: unknown;
}

async function withCachePersistence(run: (harness: PersistenceHarness) => Promise<void>): Promise<void> {
    const api = require('../../src/services/indexCache') as typeof CacheModule;
    const original = { indexCacheUri: api.indexCacheUri, indexFingerprint: api.indexFingerprint,
        readIndexCache: api.readIndexCache, saveIndexCache: api.saveIndexCache };
    const harness: PersistenceHarness = { entered: createDeferred<void>(), release: createDeferred<void>(),
        saves: [], fingerprints: [], finished: false };
    Object.assign(api, {
        indexCacheUri: () => ({ toString: () => 'cache://workspace' }),
        indexFingerprint: async () => harness.fingerprints.shift() ?? 'stable',
        readIndexCache: async () => harness.cached,
        saveIndexCache: async (_uri: unknown, fingerprint: string, value: unknown, signal: AbortSignal) => {
            harness.saves.push({ fingerprint, value, signal });
            harness.entered.resolve();
            await harness.release.promise;
            harness.finished = true;
        },
    });
    try { await run(harness); }
    finally { harness.release.resolve(); Object.assign(api, original); }
}
