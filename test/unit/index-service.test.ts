import * as assert from 'assert';
import Module = require('module');

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
