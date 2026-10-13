import * as assert from 'assert';
import Module = require('module');
import type { WorldMapData, WorldMapMessage } from '../../src/previewdef/worldmap/definitions';
import type { LoaderSession } from '../../src/util/loader/loader';
import type { WebviewPanel } from 'vscode';
import { WorldMapLoadQueue } from '../../src/previewdef/worldmap/worldmaploadqueue';
import type { WorldMapLoadRequest } from '../../src/previewdef/worldmap/worldmaploadqueue';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request, parent, isMain) {
    if (request.endsWith('.html') || request.endsWith('.css')) { return ''; }
    if (request === 'vscode') {
        class EventEmitter<T> {
            public event = (_listener: (value: T) => unknown) => ({ dispose() {} });
            public fire(_value: T): void {}
        }
        return { EventEmitter, env: { language: 'en' }, workspace: { getConfiguration: () => ({}) },
            l10n: { t: (text: string) => text } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
let WorldMap: typeof import('../../src/previewdef/worldmap/worldmap').WorldMap;
try { ({ WorldMap } = require('../../src/previewdef/worldmap/worldmap')); }
finally { nodeModule._load = originalLoad; }

interface TestController {
    cachedWorldMap?: WorldMapData;
    cachedJsonSize?: { worldMap: WorldMapData; bytes: number };
    committedWorldMap?: WorldMapData;
    pendingWorldMap?: { loadGeneration: number; worldMap: WorldMapData };
    loadGeneration: number;
    loadTimings?: { loadGeneration: number; loadStartedAt: number; dataCommittedAt?: number };
    commitPendingWorldMap(generation: number): void;
    sendProvinceMapSummaryToWebview(force: boolean): Promise<void>;
    loadWorldMapGeneration(request: WorldMapLoadRequest, signal: AbortSignal): Promise<void>;
}
interface DebugState {
    cachedWorldMap?: { retainedJsonBytes?: number };
    timings?: { dataCommittedAt?: number };
}
function fixture() {
    let serializations = 0;
    const data = { width: 1, height: 1, provincesCount: 1, statesCount: 0, warnings: [],
        toJSON: () => { serializations++; return { label: '한글', width: 1 }; },
    } as unknown as WorldMapData;
    const controller = Object.create(WorldMap.prototype) as InstanceType<typeof WorldMap>;
    const internals = controller as unknown as TestController;
    Object.assign(controller, { cachedWorldMap: data, loadGeneration: 1,
        loadQueue: { isRunning: false, clearPending() {} }, worldMapLoader: { clearCache() {} },
        reloadChangedDependencies: { cancel() {} } });
    return { controller, internals, data, serializations: () => serializations };
}

describe('world map lightweight debug state', () => {
    it('does not serialize the retained graph during lightweight polling', () => {
        const { controller, serializations } = fixture();
        for (let i = 0; i < 10; i++) {
            const state = controller.getDebugState({ includeRetainedSize: false }) as DebugState;
            assert.strictEqual(state.cachedWorldMap?.retainedJsonBytes, undefined);
        }
        assert.strictEqual(serializations(), 0);
    });

    it('memoizes the opt-in/default size and reports UTF-8 bytes instead of characters', () => {
        const { controller, serializations } = fixture();
        const expected = Buffer.byteLength(JSON.stringify({ label: '한글', width: 1 }), 'utf8');
        for (let i = 0; i < 3; i++) {
            assert.strictEqual((controller.getDebugState() as DebugState).cachedWorldMap?.retainedJsonBytes, expected);
        }
        assert.strictEqual(serializations(), 1);
    });

    it('recomputes replaced graphs and releases the memo when disposed', () => {
        const { controller, internals, data, serializations } = fixture();
        controller.getDebugState();
        internals.cachedWorldMap = { ...data };
        controller.getDebugState();
        assert.strictEqual(serializations(), 2);
        controller.dispose();
        assert.strictEqual(internals.cachedJsonSize, undefined);
        assert.strictEqual((controller.getDebugState() as DebugState).cachedWorldMap, undefined);
    });

    it('records only current-generation data commits, not stale acknowledgements or final paint', () => {
        const { controller, internals, data } = fixture();
        internals.loadGeneration = 2;
        internals.pendingWorldMap = { loadGeneration: 2, worldMap: data };
        internals.loadTimings = { loadGeneration: 2, loadStartedAt: Date.now() - 10 };
        internals.commitPendingWorldMap(1);
        assert.strictEqual(internals.loadTimings.dataCommittedAt, undefined);
        const before = Date.now();
        internals.commitPendingWorldMap(2);
        const state = controller.getDebugState({ includeRetainedSize: false }) as DebugState;
        assert.ok(state.timings?.dataCommittedAt !== undefined && state.timings.dataCommittedAt >= before);
        assert.strictEqual(internals.committedWorldMap, data);
    });

    it('passes generation-owned cancellation into map loading and never posts superseded or disposed results', async () => {
        for (const dispose of [false, true]) {
            const posted: WorldMapMessage[] = [];
            const signals: AbortSignal[] = [];
            let loads = 0;
            const controller = Object.create(WorldMap.prototype) as InstanceType<typeof WorldMap>;
            const internals = controller as unknown as TestController;
            const panel = { webview: { postMessage: async (message: WorldMapMessage) => { posted.push(message); return true; } } } as unknown as WebviewPanel;
            const data = { width: 1, height: 1, warnings: [] } as unknown as WorldMapData;
            const loader = {
                clearCache() {},
                async load(session: LoaderSession) {
                    loads++;
                    signals.push(session.signal!);
                    if (loads === 1) {
                        await new Promise<void>(resolve => session.signal!.addEventListener('abort', () => resolve(), { once: true }));
                    }
                    session.throwIfCancelled();
                    return { result: data, dependencies: [] };
                },
            };
            Object.assign(controller, {
                panel, worldMapLoader: loader, loadGeneration: 0, progressLoadGeneration: 0,
                loaderProgressGenerations: new WeakMap(),
                loadQueue: new WorldMapLoadQueue((request, signal) => internals.loadWorldMapGeneration(request, signal)),
                reloadChangedDependencies: { cancel() {} },
            });
            const loading = internals.sendProvinceMapSummaryToWebview(false);
            assert.strictEqual(signals[0].aborted, false);
            if (dispose) { controller.dispose(); }
            else { void internals.sendProvinceMapSummaryToWebview(false); }
            assert.strictEqual(signals[0].aborted, true);
            await loading;
            assert.deepStrictEqual(posted.map(message => message.command), dispose ? [] : ['provincemapsummary']);
            if (!dispose) {
                assert.strictEqual(signals[1].aborted, false);
                assert.strictEqual('loadGeneration' in posted[0] && posted[0].loadGeneration, 2);
                assert.strictEqual(internals.pendingWorldMap?.loadGeneration, 2);
                assert.strictEqual(internals.committedWorldMap, undefined, 'acknowledgement is still the only host commit boundary');
                controller.dispose();
            }
        }
    });
});
