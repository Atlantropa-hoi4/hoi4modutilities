import * as assert from 'assert';
import { WorldMapMessage } from '../../src/previewdef/worldmap/definitions';

declare global {
    function acquireVsCodeApi(): {
        postMessage<T>(message: T): void;
        getState(): unknown;
        setState(state: unknown): void;
    };

    interface Window {
        previewedFileUri?: string;
    }
}

describe('world map webview loader batching', () => {
    const previousAcquireVsCodeApi = (global as any).acquireVsCodeApi;
    const previousWindow = (global as any).window;
    const previousRequestAnimationFrame = (global as any).requestAnimationFrame;

    afterEach(() => {
        (global as any).acquireVsCodeApi = previousAcquireVsCodeApi;
        (global as any).window = previousWindow;
        (global as any).requestAnimationFrame = previousRequestAnimationFrame;
        delete require.cache[require.resolve('../../webviewsrc/util/vscode')];
        delete require.cache[require.resolve('../../webviewsrc/worldmap/loader')];
    });

    it('does not emit a full world map for every received chunk', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();
        const frameCallbacks: FrameRequestCallback[] = [];

        (global as any).acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        (global as any).window = windowTarget;
        (global as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        };

        const { Loader } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const loader = new Loader();
        let worldMapEmits = 0;
        loader.worldMap$.subscribe(() => worldMapEmits++);

        dispatchWindowMessage(windowTarget, {
            command: 'provincemapsummary',
            loadGeneration: 1,
            data: {
                width: 10,
                height: 10,
                provinces: [],
                states: [],
                countries: [],
                strategicRegions: [],
                supplyAreas: [],
                railways: [],
                supplyNodes: [],
                provincesCount: 3,
                statesCount: 3,
                countriesCount: 0,
                strategicRegionsCount: 0,
                supplyAreasCount: 0,
                railwaysCount: 0,
                supplyNodesCount: 0,
                badProvincesCount: 0,
                badStatesCount: 0,
                badStrategicRegionsCount: 0,
                badSupplyAreasCount: 0,
                continents: [],
                terrains: [],
                resources: [],
                rivers: [],
                conditionExprs: [],
                bookmarks: [],
                warnings: [],
            },
        } as WorldMapMessage);

        const stateRequest = postedMessages[postedMessages.length - 1] as any;
        assert.strictEqual(stateRequest.command, 'requeststates');

        dispatchWindowMessage(windowTarget, {
            command: 'states',
            start: stateRequest.start,
            end: stateRequest.end,
            loadGeneration: 1,
            data: JSON.stringify([undefined, undefined, undefined]),
        } as WorldMapMessage);

        assert.strictEqual(worldMapEmits, 0);

        const provinceRequest = postedMessages[postedMessages.length - 1] as any;
        assert.strictEqual(provinceRequest.command, 'requestprovinces');

        dispatchWindowMessage(windowTarget, {
            command: 'provinces',
            start: provinceRequest.start,
            end: provinceRequest.end,
            loadGeneration: 1,
            data: JSON.stringify([undefined, undefined, undefined]),
        } as WorldMapMessage);

        assert.strictEqual(loader.batchStats.chunksReceived, 2);
        assert.strictEqual(loader.batchStats.worldMapEmits, 1);
        assert.strictEqual(worldMapEmits, 1);
    });

    it('applies current condition and bookmark updates while ignoring stale generations', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();

        (global as any).acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        (global as any).window = windowTarget;
        (global as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        };

        const { Loader } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const loader = new Loader();
        dispatchWindowMessage(windowTarget, {
            command: 'provincemapsummary',
            loadGeneration: 2,
            data: emptyWorldMapSummary(),
        } as WorldMapMessage);

        dispatchWindowMessage(windowTarget, {
            command: 'conditionexprs',
            loadGeneration: 1,
            data: JSON.stringify([{ scopeName: '', nodeContent: 'stale' }]),
            start: 0,
            end: 0,
        });
        assert.deepStrictEqual(loader.worldMap.conditionExprs, []);

        const conditionExprs = [{ scopeName: '', nodeContent: '1936.1.1.0' }];
        dispatchWindowMessage(windowTarget, {
            command: 'conditionexprs',
            loadGeneration: 2,
            data: JSON.stringify(conditionExprs),
            start: 0,
            end: 0,
        });
        const bookmarks = [{
            name: 'GATHERING_STORM',
            date: { year: 1936, month: 1, day: 1, hour: 0 },
        }];
        dispatchWindowMessage(windowTarget, {
            command: 'bookmarks',
            loadGeneration: 2,
            data: JSON.stringify(bookmarks),
            start: 0,
            end: 0,
        });

        assert.deepStrictEqual(loader.worldMap.conditionExprs, conditionExprs);
        assert.deepStrictEqual(loader.worldMap.bookmarks, bookmarks);
    });
});

function emptyWorldMapSummary(): any {
    return {
        width: 10,
        height: 10,
        provinces: [],
        states: [],
        countries: [],
        strategicRegions: [],
        supplyAreas: [],
        railways: [],
        supplyNodes: [],
        provincesCount: 0,
        statesCount: 0,
        countriesCount: 0,
        strategicRegionsCount: 0,
        supplyAreasCount: 0,
        railwaysCount: 0,
        supplyNodesCount: 0,
        badProvincesCount: 0,
        badStatesCount: 0,
        badStrategicRegionsCount: 0,
        badSupplyAreasCount: 0,
        continents: [],
        terrains: [],
        resources: [],
        rivers: [],
        warnings: [],
    };
}

function dispatchWindowMessage(windowTarget: EventTarget, data: WorldMapMessage): void {
    const event = new Event('message') as Event & { data: WorldMapMessage };
    event.data = data;
    windowTarget.dispatchEvent(event);
}
