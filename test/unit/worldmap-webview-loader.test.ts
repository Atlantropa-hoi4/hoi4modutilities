import * as assert from 'assert';
import type { RequestMapItemMessage, WorldMapMessage, WorldMapData } from '../../src/previewdef/worldmap/definitions';
import type { Loader as WebviewLoader } from '../../webviewsrc/worldmap/loader';

type IndexedCollection = 'provinces' | 'states' | 'countries' | 'strategicRegions' | 'supplyAreas' | 'railways' | 'supplyNodes';
const testGlobals = global as unknown as {
    acquireVsCodeApi: () => { postMessage(message: WorldMapMessage): void; getState(): unknown; setState(state: unknown): void };
    window: EventTarget;
};

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

    it('pipelines at most four chunk requests and emits one completed world map', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();

        (global as any).acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        (global as any).window = windowTarget;

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
                provinceDefinitionsFile: 'map/definition.csv',
                provinces: [],
                states: [],
                countries: [],
                strategicRegions: [],
                supplyAreas: [],
                railways: [],
                supplyNodes: [],
                provincesCount: 5000,
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
                conditionExprs: [],
                bookmarks: [],
                warnings: [],
            },
        } as WorldMapMessage);

        assert.strictEqual(postedMessages.length, 5, 'loaded plus four in-flight requests');
        let requestIndex = 1;
        while (loader.loading$.value) {
            const request = postedMessages[requestIndex++] as RequestMapItemMessage | undefined;
            assert.ok(request, 'a completed request should release the next queued request');
            assert.strictEqual(request.command, 'requestprovinces');
            const itemCount = request.end - request.start;
            const chunk = new Array(itemCount);
            if (request.start === 0) {
                chunk[1] = { id: 1, color: 101 };
            }
            dispatchWindowMessage(windowTarget, {
                command: 'provinces',
                start: request.start,
                end: request.end,
                loadGeneration: 1,
                data: requestIndex === 2 ? JSON.stringify(chunk) : chunk,
            });
            if (requestIndex === 2) {
                assert.strictEqual(worldMapEmits, 0);
            }
        }

        assert.strictEqual(requestIndex, 6);
        assert.strictEqual(loader.batchStats.chunksReceived, 5);
        assert.strictEqual(loader.batchStats.maxInFlightRequests, 4);
        assert.strictEqual(loader.batchStats.worldMapEmits, 1);
        assert.strictEqual(worldMapEmits, 1);
        assert.deepStrictEqual(postedMessages[postedMessages.length - 1], {
            command: 'mapready',
            loadGeneration: 1,
        });

        dispatchWindowMessage(windowTarget, {
            command: 'states',
            start: 1,
            end: 2,
            count: 2,
            data: [{ id: 1, provinces: [1] }],
        });
        assert.strictEqual(loader.worldMap.statesCount, 2);
        assert.deepStrictEqual(loader.worldMap.getStateById(1), { id: 1, provinces: [1] });
        assert.strictEqual(worldMapEmits, 2, 'live editor updates should rebuild webview indexes immediately');

        const committedProvince = loader.worldMap.getProvinceById(1);
        assert.deepStrictEqual(committedProvince, { id: 1, color: 101 });
        dispatchWindowMessage(windowTarget, {
            command: 'progress',
            loadGeneration: 2,
            data: 'Comparing changes...',
        });
        dispatchWindowMessage(windowTarget, {
            command: 'provinces',
            start: 1,
            end: 2,
            loadGeneration: 2,
            data: [{ id: 1, color: 202 }],
        });
        assert.strictEqual(loader.worldMap.getProvinceById(1), committedProvince);
        dispatchWindowMessage(windowTarget, {
            command: 'mapupdatecomplete',
            loadGeneration: 2,
        });
        assert.deepStrictEqual(loader.worldMap.getProvinceById(1), { id: 1, color: 202 });
        loader.dispose();
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
        let worldMapEmits = 0;
        loader.worldMap$.subscribe(() => worldMapEmits++);
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
            command: 'progress',
            loadGeneration: 3,
            data: 'Comparing changes...',
        });
        dispatchWindowMessage(windowTarget, {
            command: 'provincemapsummary',
            loadGeneration: 2,
            data: { ...emptyWorldMapSummary(), width: 99 },
        });
        dispatchWindowMessage(windowTarget, {
            command: 'conditionexprs',
            loadGeneration: 3,
            data: conditionExprs,
            start: 0,
            end: 0,
        });
        const bookmarks = [{
            name: 'GATHERING_STORM',
            date: { year: 1936, month: 1, day: 1, hour: 0 },
        }];
        dispatchWindowMessage(windowTarget, {
            command: 'bookmarks',
            loadGeneration: 3,
            data: JSON.stringify(bookmarks),
            start: 0,
            end: 0,
        });

        assert.deepStrictEqual(loader.worldMap.conditionExprs, []);
        assert.deepStrictEqual(loader.worldMap.bookmarks, []);
        dispatchWindowMessage(windowTarget, {
            command: 'mapupdatecomplete',
            loadGeneration: 2,
        });
        assert.deepStrictEqual(loader.worldMap.conditionExprs, []);

        dispatchWindowMessage(windowTarget, {
            command: 'mapupdatecomplete',
            loadGeneration: 3,
        });
        assert.deepStrictEqual(loader.worldMap.conditionExprs, conditionExprs);
        assert.deepStrictEqual(loader.worldMap.bookmarks, bookmarks);
        assert.strictEqual(loader.worldMap.width, 10);
        assert.strictEqual(worldMapEmits, 2, 'one initial map and one committed diff');
        assert.deepStrictEqual(postedMessages.filter(message => message.command === 'mapready'), [
            { command: 'mapready', loadGeneration: 2 },
            { command: 'mapready', loadGeneration: 3 },
        ]);
        loader.dispose();
    });

    it('stages every generation-tagged collection, including states and regions, without mutating published aliases', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();
        testGlobals.acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        testGlobals.window = windowTarget;
        const { Loader } = require('../../webviewsrc/worldmap/loader') as { Loader: typeof WebviewLoader };
        const loader = new Loader();
        let emits = 0;
        loader.worldMap$.subscribe(() => emits++);
        dispatchWindowMessage(windowTarget, { command: 'provincemapsummary', loadGeneration: 1, data: emptyWorldMapSummary() });
        dispatchWindowMessage(windowTarget, { command: 'states', start: -1, end: 0, data: [{ id: -1, provinces: [] }] });
        // The wrapper retains these private collection arrays from its WorldMapData constructor argument.
        const published = loader.worldMap as unknown as WorldMapData;
        const collections: Record<string, IndexedCollection> = {
            provinces: 'provinces', states: 'states', countries: 'countries', strategicregions: 'strategicRegions',
            supplyareas: 'supplyAreas', railways: 'railways', supplynodes: 'supplyNodes',
        };
        const previous = new Map<IndexedCollection, WorldMapData[IndexedCollection]>(
            Object.values(collections).map(key => [key, published[key]]));
        const diffItem = { id: 1, tag: 'NEW', provinces: [], states: [], level: 1 };
        const replacements = {
            warnings: [{ source: [], relatedFiles: [], text: 'New warning' }],
            continents: ['new_continent'],
            terrains: [{ name: 'new_terrain', color: 1, isNaval: false, file: 'map/terrain.txt' }],
            resources: [{ name: 'new_resource', iconFrame: 0, imageUri: 'image.png', file: 'common/resources.txt' }],
            rivers: [{ colors: { 1: 2 }, ends: [1], boundingBox: { x: 0, y: 0, w: 1, h: 1 } }],
            conditionExprs: [{ scopeName: '', nodeContent: '1936.1.1.0' }],
            bookmarks: [{ name: 'new_bookmark', date: { year: 1936, month: 1, day: 1, hour: 0 } }],
        } satisfies Pick<WorldMapData, 'warnings' | 'continents' | 'terrains' | 'resources' | 'rivers' | 'conditionExprs' | 'bookmarks'>;
        const beforeDiff = emits;
        dispatchWindowMessage(windowTarget, { command: 'progress', loadGeneration: 2, data: 'Comparing changes...' });
        for (const [command, collection] of Object.entries(collections)) {
            dispatchWindowMessage(windowTarget, {
                command, start: 1, end: 2, count: 2, loadGeneration: 2,
                data: [diffItem],
            } as WorldMapMessage);
            assert.strictEqual(loader.worldMap, published, command);
            assert.strictEqual(emits, beforeDiff, command);
            assert.strictEqual(previous.get(collection)![1], undefined, `${command}: published array is not staging`);
        }
        for (const [key, data] of Object.entries(replacements)) {
            // Keys come only from the checked WorldMapData collection fixture above.
            const collection = key as keyof typeof replacements;
            dispatchWindowMessage(windowTarget, {
                command: collection === 'conditionExprs' ? 'conditionexprs' : collection,
                data, start: 0, end: 0, loadGeneration: 2,
            });
            assert.strictEqual(loader.worldMap, published, collection);
            assert.strictEqual(emits, beforeDiff, collection);
            assert.deepStrictEqual(published[collection], [], `${collection}: published array remains untouched`);
        }
        assert.strictEqual(published.statesCount, 0);
        assert.strictEqual(published.strategicRegionsCount, 0);
        dispatchWindowMessage(windowTarget, { command: 'mapupdatecomplete', loadGeneration: 1 });
        assert.strictEqual(emits, beforeDiff, 'stale completion must not publish staging');
        dispatchWindowMessage(windowTarget, { command: 'mapupdatecomplete', loadGeneration: 2 });
        assert.strictEqual(emits, beforeDiff + 1);
        assert.strictEqual(loader.worldMap.statesCount, 2);
        assert.strictEqual(loader.worldMap.strategicRegionsCount, 2);
        const updated = loader.worldMap as unknown as WorldMapData;
        assert.deepStrictEqual(updated.states[-1], { id: -1, provinces: [] }, 'negative IDs survive staging clones');
        for (const collection of Object.values(collections)) {
            assert.strictEqual(previous.get(collection)![1], undefined, `${collection}: old published alias remains immutable`);
            assert.deepStrictEqual(updated[collection][1], diffItem);
        }
        for (const [key, data] of Object.entries(replacements)) {
            const collection = key as keyof typeof replacements;
            assert.deepStrictEqual(updated[collection], data);
            assert.deepStrictEqual(published[collection], [], `${collection}: old published alias remains untouched after commit`);
        }
        dispatchWindowMessage(windowTarget, { command: 'mapupdatecomplete', loadGeneration: 2 });
        dispatchWindowMessage(windowTarget, { command: 'states', start: 1, end: 2, loadGeneration: 2, data: [{ id: 99 }] });
        assert.strictEqual(emits, beforeDiff + 1, 'duplicate completion publishes and acknowledges only once');
        assert.strictEqual(loader.worldMap.getStateById(1)?.id, 1);
        assert.strictEqual(postedMessages.filter(message => message.command === 'mapready' && message.loadGeneration === 2).length, 1);

        const beforeEditor = loader.worldMap;
        dispatchWindowMessage(windowTarget, { command: 'strategicregions', start: 1, end: 2, count: 3, data: [{ id: 1, provinces: [7] }] });
        assert.strictEqual(emits, beforeDiff + 2, 'generationless region edits remain immediate');
        assert.strictEqual(loader.worldMap.strategicRegionsCount, 3);
        assert.deepStrictEqual(loader.worldMap.getStrategicRegionById(1)?.provinces, [7]);
        assert.deepStrictEqual(beforeEditor.getStrategicRegionById(1)?.provinces, [], 'direct edits also preserve old published aliases');
        loader.dispose();
    });

    it('ignores stale initial chunks without releasing current generation request slots', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();
        testGlobals.acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        testGlobals.window = windowTarget;
        const { Loader } = require('../../webviewsrc/worldmap/loader') as { Loader: typeof WebviewLoader };
        const loader = new Loader();
        let emits = 0;
        loader.worldMap$.subscribe(() => emits++);
        const summary = { ...emptyWorldMapSummary(), provincesCount: 5000 };
        dispatchWindowMessage(windowTarget, { command: 'provincemapsummary', loadGeneration: 1, data: summary });
        dispatchWindowMessage(windowTarget, { command: 'provincemapsummary', loadGeneration: 2, data: summary });
        const requestCount = postedMessages.length;
        dispatchWindowMessage(windowTarget, { command: 'provinces', start: 0, end: 1000, data: [], loadGeneration: 1 });
        assert.strictEqual(postedMessages.length, requestCount);
        assert.strictEqual(emits, 0);
        let index = postedMessages.findIndex(message => message.command === 'requestprovinces' && message.loadGeneration === 2);
        while (loader.loading$.value) {
            const request = postedMessages[index++] as RequestMapItemMessage;
            dispatchWindowMessage(windowTarget, { command: 'provinces', start: request.start, end: request.end, data: [], loadGeneration: 2 });
        }
        assert.strictEqual(emits, 1);
        assert.strictEqual(loader.batchStats.maxInFlightRequests, 4);
        dispatchWindowMessage(windowTarget, { command: 'mapupdatecomplete', loadGeneration: 2 });
        assert.strictEqual(emits, 1);
        loader.dispose();
    });

    it('accepts progress and errors from a new generation before receiving its summary', () => {
        const postedMessages: WorldMapMessage[] = [];
        const windowTarget = new EventTarget();

        (global as any).acquireVsCodeApi = () => ({
            postMessage: (message: WorldMapMessage) => postedMessages.push(message),
            getState: () => ({}),
            setState: () => undefined,
        });
        (global as any).window = windowTarget;

        const { Loader } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const loader = new Loader();

        dispatchWindowMessage(windowTarget, {
            command: 'progress',
            loadGeneration: 1,
            data: 'Loading default.map...',
        });
        assert.strictEqual(loader.progressText, 'Loading default.map...');

        dispatchWindowMessage(windowTarget, {
            command: 'progress',
            loadGeneration: 0,
            data: 'Stale progress',
        });
        assert.strictEqual(loader.progressText, 'Loading default.map...');

        dispatchWindowMessage(windowTarget, {
            command: 'error',
            loadGeneration: 1,
            data: 'Failed to load world map',
        });
        assert.strictEqual(loader.progressText, 'Failed to load world map');
        assert.strictEqual(loader.loading$.value, false);
        loader.dispose();
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
