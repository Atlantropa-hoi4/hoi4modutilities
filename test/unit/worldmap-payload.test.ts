import * as assert from 'assert';
import { WorldMapData } from '../../src/previewdef/worldmap/definitions';
import {
    createWorldMapSummary,
    getWorldMapMessageMetrics,
    resolveWorldMapRequest,
} from '../../src/previewdef/worldmap/worldmappayload';

describe('world map payload helpers', () => {
    it('removes every chunked collection from the initial summary', () => {
        const worldMap = createWorldMapForTest();
        const summary = createWorldMapSummary(worldMap);

        assert.deepStrictEqual(summary.provinces, []);
        assert.deepStrictEqual(summary.states, []);
        assert.deepStrictEqual(summary.countries, []);
        assert.deepStrictEqual(summary.strategicRegions, []);
        assert.deepStrictEqual(summary.supplyAreas, []);
        assert.deepStrictEqual(summary.railways, []);
        assert.deepStrictEqual(summary.supplyNodes, []);
        assert.strictEqual(summary.rivers, worldMap.rivers);
        assert.strictEqual(summary.warnings, worldMap.warnings);
    });

    it('resolves chunk requests directly from the retained map', () => {
        const worldMap = createWorldMapForTest();
        const resolved = resolveWorldMapRequest(worldMap, {
            command: 'requestrailways',
            start: 0,
            end: 1,
            loadGeneration: 7,
        });

        assert.strictEqual(resolved.command, 'railways');
        assert.strictEqual(resolved.value, worldMap.railways);
    });

    it('measures structured chunks without serializing their contents', () => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);

        assert.deepStrictEqual(getWorldMapMessageMetrics({
            command: 'provinces',
            data: cyclic,
            start: 0,
            end: 1,
        }), { itemCount: 1 });
    });
});

function createWorldMapForTest(): WorldMapData {
    return {
        width: 10,
        height: 10,
        provinces: [null],
        states: [null],
        countries: [{ tag: 'TAG', color: 1 }],
        strategicRegions: [null],
        supplyAreas: [null],
        railways: [{ level: 1, provinces: [1, 2] }],
        supplyNodes: [{ level: 1, province: 1 }],
        provincesCount: 1,
        statesCount: 1,
        countriesCount: 1,
        strategicRegionsCount: 1,
        supplyAreasCount: 1,
        railwaysCount: 1,
        supplyNodesCount: 1,
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
    };
}
