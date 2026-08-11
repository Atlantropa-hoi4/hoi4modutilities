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
});
