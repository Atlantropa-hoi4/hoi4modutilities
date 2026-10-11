import * as assert from 'assert';
import Module = require('module');
import type { WorldMapData } from '../../src/previewdef/worldmap/definitions';

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
});
