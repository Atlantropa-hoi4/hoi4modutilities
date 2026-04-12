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

describe('index service', () => {
    it('does not let an invalidated in-flight build mark a target ready', async () => {
        const builds: Deferred<void>[] = [];
        let resetCount = 0;
        const service = new IndexService({
            workspace: {
                build: async (estimatedSize: [number]) => {
                    estimatedSize[0] = builds.length + 1;
                    const deferred = createDeferred<void>();
                    builds.push(deferred);
                    return deferred.promise;
                },
                reset: () => {
                    resetCount += 1;
                },
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const firstEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(builds.length, 1);

        service.invalidate('workspace');
        assert.strictEqual(resetCount, 1);
        assert.strictEqual(service.isReady('workspace'), false);

        const secondEnsure = service.ensure('workspace', { showStatusBar: false });
        assert.strictEqual(builds.length, 2);
        assert.notStrictEqual(firstEnsure, secondEnsure);

        builds[0].resolve();
        await firstEnsure;
        assert.strictEqual(service.isReady('workspace'), false);

        builds[1].resolve();
        await secondEnsure;
        assert.strictEqual(service.isReady('workspace'), true);
    });

    it('reuses the same in-flight build within one generation', () => {
        const deferred = createDeferred<void>();
        let buildCount = 0;
        const service = new IndexService({
            workspace: {
                build: async () => {
                    buildCount += 1;
                    return deferred.promise;
                },
                reset: () => undefined,
                statusMessage: 'Building workspace index...',
                telemetryEvent: 'workspaceIndex',
            },
        });

        const firstEnsure = service.ensure('workspace', { showStatusBar: false });
        const secondEnsure = service.ensure('workspace', { showStatusBar: false });

        assert.strictEqual(buildCount, 1);
        assert.strictEqual(firstEnsure, secondEnsure);

        deferred.resolve();
    });
});

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}
