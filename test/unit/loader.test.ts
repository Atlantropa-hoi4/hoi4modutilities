import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let fileExpiryToken = 'v1';

class MockEventEmitter<T> {
    public readonly event = () => ({ dispose: () => undefined });

    public fire(_value: T): void {}
}

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            EventEmitter: MockEventEmitter,
        };
    }

    if (request.endsWith('/fileloader') || request.endsWith('\\fileloader')) {
        return {
            hoiFileExpiryToken: async () => fileExpiryToken,
            listFilesFromModOrHOI4: async () => [],
            readFileFromModOrHOI4: async () => [Buffer.alloc(0), {}],
        };
    }

    if (request.endsWith('/dependency') || request.endsWith('\\dependency')) {
        return {
            getDependenciesFromText: () => [],
        };
    }

    if (request.endsWith('/debug') || request.endsWith('\\debug')) {
        return {
            error: () => undefined,
        };
    }

    if (request.endsWith('/telemetry') || request.endsWith('\\telemetry')) {
        return {
            sendEvent: () => undefined,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/loader/loader')];
const {
    FileLoader,
    Loader,
    LoaderSession,
} = require('../../src/util/loader/loader') as typeof import('../../src/util/loader/loader');
nodeModule._load = originalLoad;

describe('loader error recovery', () => {
    beforeEach(() => {
        fileExpiryToken = 'v1';
    });

    it('clears a failed reload check so the same session can retry it', async () => {
        let checks = 0;
        class ReloadCheckLoader extends Loader<string> {
            protected override async shouldReloadImpl(): Promise<boolean> {
                checks += 1;
                if (checks === 1) {
                    throw new Error('transient stat failure');
                }
                return true;
            }

            protected override async loadImpl() {
                return { result: 'unused', dependencies: [] };
            }
        }

        const loader = new ReloadCheckLoader();
        const session = new LoaderSession(false);
        await assert.rejects(() => loader.shouldReload(session), /transient stat failure/);
        assert.strictEqual(session.shouldReload(loader), undefined);
        assert.strictEqual(await loader.shouldReload(session), true);
        assert.strictEqual(checks, 2);
    });

    it('does not commit a file expiry token until the corresponding load succeeds', async () => {
        let loads = 0;
        class RecoveringFileLoader extends FileLoader<string> {
            protected override async loadFromFile() {
                loads += 1;
                if (loads === 2) {
                    throw new Error('transient read failure');
                }
                return { result: `result-${loads}` };
            }
        }

        const loader = new RecoveringFileLoader('example.txt');
        assert.strictEqual((await loader.load(new LoaderSession(true))).result, 'result-1');

        fileExpiryToken = 'v2';
        await assert.rejects(() => loader.load(new LoaderSession(false)), /transient read failure/);
        assert.strictEqual((await loader.load(new LoaderSession(false))).result, 'result-3');
        assert.strictEqual(loads, 3);
    });
    it('does not publish a load cancelled while reporting progress and permits a later retry', async () => {
        let cancelled = false;
        class ProgressLoader extends Loader<string> {
            protected override async loadImpl() {
                await this.fireOnProgressEvent('Loading');
                return { result: 'ready', dependencies: [] };
            }
        }

        const loader = new ProgressLoader();
        const cancel = setImmediate(() => { cancelled = true; });
        try {
            await assert.rejects(
                loader.load(new LoaderSession(false, () => cancelled)),
                /Load session cancelled/,
            );
            cancelled = false;
            assert.strictEqual((await loader.load(new LoaderSession(false, () => cancelled))).result, 'ready');
        } finally {
            clearImmediate(cancel);
        }
    });

    it('keeps a shared flight alive while another consumer still owns a valid lease', async () => {
        let complete!: () => void;
        let workSignal: AbortSignal | undefined;
        let loads = 0;
        class SharedLoader extends Loader<string> {
            protected override async loadImpl(session: InstanceType<typeof LoaderSession>) {
                loads++;
                workSignal = session.signal;
                await new Promise<void>(resolve => { complete = resolve; });
                session.throwIfCancelled();
                return { result: 'shared', dependencies: [] };
            }
        }
        const loader = new SharedLoader();
        const owner = new AbortController();
        const other = new AbortController();
        const canceledLoad = loader.load(new LoaderSession(false, undefined, owner.signal));
        const validLoad = loader.load(new LoaderSession(false, undefined, other.signal));
        const rejected = assert.rejects(canceledLoad, /Load session cancelled/);
        await Promise.resolve();
        owner.abort();
        assert.strictEqual(workSignal?.aborted, false, 'the shared flight must not inherit the first consumer signal');
        complete();
        assert.strictEqual((await validLoad).result, 'shared');
        await rejected;
        assert.strictEqual(loads, 1);
    });

    it('aborts shared work only after every signal lease is canceled and permits a fresh load', async () => {
        let workSignal: AbortSignal | undefined;
        let loads = 0;
        class CancelableLoader extends Loader<string> {
            protected override async loadImpl(session: InstanceType<typeof LoaderSession>) {
                loads++;
                workSignal = session.signal;
                if (loads === 1) {
                    await new Promise<void>(resolve => session.signal!.addEventListener('abort', () => resolve(), { once: true }));
                }
                session.throwIfCancelled();
                return { result: 'fresh', dependencies: [] };
            }
        }
        const loader = new CancelableLoader();
        const first = new AbortController();
        const second = new AbortController();
        const firstLoad = loader.load(new LoaderSession(false, undefined, first.signal));
        const secondLoad = loader.load(new LoaderSession(false, undefined, second.signal));
        const rejected = [assert.rejects(firstLoad, /Load session cancelled/), assert.rejects(secondLoad, /Load session cancelled/)];
        await Promise.resolve();
        first.abort();
        assert.strictEqual(workSignal?.aborted, false);
        second.abort();
        assert.strictEqual(workSignal?.aborted, true);
        const fresh = loader.load(new LoaderSession(false));
        await Promise.all(rejected);
        assert.strictEqual((await fresh).result, 'fresh');
        assert.strictEqual(loads, 2);
    });
});
