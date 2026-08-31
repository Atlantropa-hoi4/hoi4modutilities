import * as assert from 'assert';
import Module = require('module');
import { applyCondition, ConditionItem } from '../../src/hoiformat/condition';
import { Bookmark, WithCondition } from '../../src/previewdef/worldmap/definitions';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            Uri: {
                joinPath: (...parts: any[]) => ({ fsPath: parts.map(p => p.fsPath ?? p.path ?? p.toString()).join('/') }),
            },
            workspace: {
                workspaceFolders: [],
                fs: {
                    readFile: async () => Buffer.from(''),
                    readDirectory: async () => [],
                    stat: async () => ({ type: 0, mtime: 0 }),
                },
                getConfiguration: () => ({
                    get: (_key: string, defaultValue: unknown) => defaultValue,
                    has: () => false,
                    inspect: () => undefined,
                    update: async () => undefined,
                }),
            },
            FileType: {
                File: 1,
                Directory: 2,
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { parseStateFileContentForTest } = require('../../src/previewdef/worldmap/loader/states') as typeof import('../../src/previewdef/worldmap/loader/states');
const { parseStrategicRegionFileContentForTest } = require('../../src/previewdef/worldmap/loader/strategicregion') as typeof import('../../src/previewdef/worldmap/loader/strategicregion');
const { parseBookmarkFileContentForTest } = require('../../src/previewdef/worldmap/loader/bookmarks') as typeof import('../../src/previewdef/worldmap/loader/bookmarks');
const { inferDefaultMapFromConventionalFilesForTest } = require('../../src/previewdef/worldmap/loader/provincemap') as typeof import('../../src/previewdef/worldmap/loader/provincemap');

nodeModule._load = originalLoad;

describe('world map modern HOI4 syntax parsing', () => {
    it('preserves modern state supply, buildings, province buildings, and dated history', () => {
        const content = `
state = {
    id = 1
    name = "STATE_TEST"
    manpower = 1000
    state_category = city
    local_supplies = 3.5
    buildings_max_level_factor = 1.25
    history = {
        owner = TAG
        controller = TAG
        add_core_of = TAG
        add_claim_by = CLM
        set_demilitarized_zone = yes
        victory_points = { 10 5 }
        buildings = {
            infrastructure = 4
            arms_factory = 2
            10 = {
                supply_node = 1
                naval_base = 3
            }
        }
        1939.1.1 = {
            owner = OTH
            controller = OTH
            add_core_of = OTH
            set_demilitarized_zone = no
            buildings = {
                infrastructure = 5
                10 = {
                    supply_node = 1
                }
            }
        }
    }
    provinces = { 10 11 }
    resources = {
        steel = 8
    }
}`;
        const states = parseStateFileContentForTest(content);

        assert.strictEqual(states.length, 1);
        const state = states[0];
        assert.strictEqual(state.localSupplies, 3.5);
        assert.strictEqual(state.buildingsMaxLevelFactor, 1.25);
        assert.deepStrictEqual(state.buildings, { infrastructure: 4, arms_factory: 2 });
        assert.deepStrictEqual(state.provinceBuildings[10], { supply_node: 1, naval_base: 3 });
        assert.strictEqual(state.demilitarized, true);
        assert.deepStrictEqual(state.owner, [{ value: 'TAG', condition: true }]);
        assert.deepStrictEqual(state.controller, [{ value: 'TAG', condition: true }]);
        assert.deepStrictEqual(state.cores, [{ value: 'TAG', condition: true }]);
        assert.deepStrictEqual(state.claimBy, [{ value: 'CLM', condition: true }]);
        assert.strictEqual(state.datedHistory.length, 1);
        assert.strictEqual(state.datedHistory[0].date, '1939.1.1');
        assert.strictEqual(state.datedHistory[0].owner, 'OTH');
        assert.strictEqual(state.datedHistory[0].controller, 'OTH');
        assert.deepStrictEqual(state.datedHistory[0].cores, ['OTH']);
        assert.strictEqual(state.datedHistory[0].demilitarized, false);
        assert.deepStrictEqual(state.datedHistory[0].buildings, { infrastructure: 5 });
        assert.deepStrictEqual(state.datedHistory[0].provinceBuildings[10], { supply_node: 1 });
        assert.strictEqual(content.slice(state.provinceTokens[10].start, state.provinceTokens[10].end), '10');
        assert.strictEqual(content.slice(state.provinceTokens[11].start, state.provinceTokens[11].end), '11');
        assert.strictEqual(state.provinceTokens[10].start, content.indexOf('10 11'));
    });

    it('parses bookmarks and resolves conditional state history for each scenario date', () => {
        const bookmarks = parseBookmarkFileContentForTest(`
bookmarks = {
    bookmark = { name = "BLITZKRIEG" date = 1939.1.1 }
    bookmark = { name = "GATHERING_STORM" date = 1936.1.1 }
    bookmark = { name = "LATE_GAME" date = 1941.1.1 }
}`);
        const conditionExprs: ConditionItem[] = [];
        const states = parseStateFileContentForTest(`
state = {
    id = 3
    name = "STATE_HISTORY_TEST"
    manpower = 1
    state_category = town
    history = {
        owner = GER
        controller = GER
        add_core_of = GER
        add_claim_by = POL
        1937.1.1 = {
            owner = FRA
            add_core_of = FRA
            add_claim_by = CZE
        }
        1939.1.1 = {
            owner = ENG
            controller = ITA
            remove_core_of = GER
            remove_claim_by = POL
        }
        1940.1.1 = {
            if = {
                limit = { has_global_flag = alternate_path }
                controller = USA
            }
        }
    }
    provinces = { 30 }
}`, 'state_history_test.txt', bookmarks, conditionExprs);

        assert.strictEqual(bookmarks.length, 3);
        assert.strictEqual(bookmarks[0].name, 'BLITZKRIEG');
        const state = states[0];
        const scenario = (date: string, extra: ConditionItem[] = []): ConditionItem[] => [
            { scopeName: '', nodeContent: date },
            ...extra,
        ];
        const solve = <T>(items: WithCondition<T>[], selected: ConditionItem[]): T | undefined =>
            items.find(item => applyCondition(item.condition, selected))?.value;
        const solveSet = <T>(items: WithCondition<T>[], selected: ConditionItem[]): T[] =>
            items.filter(item => applyCondition(item.condition, selected)).map(item => item.value);

        const gatheringStorm = scenario('1936.1.1.0');
        assert.strictEqual(solve(state.owner, gatheringStorm), 'GER');
        assert.strictEqual(solve(state.controller, gatheringStorm), 'GER');
        assert.deepStrictEqual(solveSet(state.cores, gatheringStorm), ['GER']);
        assert.deepStrictEqual(solveSet(state.claimBy, gatheringStorm), ['POL']);

        const blitzkrieg = scenario('1939.1.1.0');
        assert.strictEqual(solve(state.owner, blitzkrieg), 'FRA');
        assert.strictEqual(solve(state.controller, blitzkrieg), 'GER');
        assert.deepStrictEqual(solveSet(state.cores, blitzkrieg), ['GER', 'FRA']);
        assert.deepStrictEqual(solveSet(state.claimBy, blitzkrieg), ['POL', 'CZE']);

        const lateGame = scenario('1941.1.1.0');
        assert.strictEqual(solve(state.owner, lateGame), 'ENG');
        assert.strictEqual(solve(state.controller, lateGame), 'ITA');
        assert.deepStrictEqual(solveSet(state.cores, lateGame), ['FRA']);
        assert.deepStrictEqual(solveSet(state.claimBy, lateGame), ['CZE']);
        assert.strictEqual(solve(state.controller, scenario('1941.1.1.0', [
            { scopeName: '', nodeContent: 'has_global_flag = alternate_path' },
        ])), 'USA');
        assert.ok(conditionExprs.some(item => item.nodeContent === 'has_global_flag = alternate_path'));
    });

    it('preserves province token positions with multiline province lists and comments', () => {
        const content = `
state = {
    id = 2
    name = "STATE_TOKEN_TEST"
    manpower = 1
    state_category = town
    history = {
        owner = TAG
    }
    provinces = {
        101 # first province
        202
    }
}`;
        const states = parseStateFileContentForTest(content);

        assert.strictEqual(states.length, 1);
        const state = states[0];
        assert.strictEqual(content.slice(state.provinceTokens[101].start, state.provinceTokens[101].end), '101');
        assert.strictEqual(content.slice(state.provinceTokens[202].start, state.provinceTokens[202].end), '202');
        assert.strictEqual(state.provinceTokens[101].start, content.indexOf('101'));
        assert.strictEqual(state.provinceTokens[202].start, content.indexOf('202'));
    });

    it('preserves strategic region naval terrain, static modifiers, and weather periods', () => {
        const strategicRegions = parseStrategicRegionFileContentForTest(`
strategic_region = {
    id = 7
    name = "REGION_TEST"
    provinces = { 10 11 }
    naval_terrain = naval_shallow_sea
    static_modifiers = {
        naval_base_supply_score = 0.5
        local_supplies = 1
    }
    weather = {
        period = {
            between = { 0 30 }
            temperature = { -5 10 }
            no_phenomenon = 0.8
            rain_light = { 0.1 0.2 }
        }
        period = {
            between = { 31 60 }
            no_phenomenon = 1
        }
    }
}`);

        assert.strictEqual(strategicRegions.length, 1);
        const strategicRegion = strategicRegions[0];
        assert.strictEqual(strategicRegion.navalTerrain, 'naval_shallow_sea');
        assert.deepStrictEqual(strategicRegion.staticModifiers, {
            naval_base_supply_score: 0.5,
            local_supplies: 1,
        });
        assert.strictEqual(strategicRegion.weatherPeriods.length, 2);
        assert.deepStrictEqual(strategicRegion.weatherPeriods[0].between, [0, 30]);
        assert.deepStrictEqual(strategicRegion.weatherPeriods[0].temperature, [-5, 10]);
        assert.strictEqual(strategicRegion.weatherPeriods[0].values.no_phenomenon, 0.8);
        assert.deepStrictEqual(strategicRegion.weatherPeriods[0].values.rain_light, [0.1, 0.2]);
        assert.deepStrictEqual(strategicRegion.weatherPeriods[1].between, [31, 60]);
    });
});

describe('world map default.map fallback', () => {
    const conventionalFiles = new Set([
        'map/definition.csv',
        'map/provinces.bmp',
        'map/adjacencies.csv',
        'map/continent.txt',
        'map/rivers.bmp',
    ]);

    it('infers conventional names when all required map files exist', async () => {
        const result = await inferDefaultMapFromConventionalFilesForTest(
            async file => conventionalFiles.has(file) ? file : undefined,
        );

        assert.deepStrictEqual(result, {
            definitions: 'definition.csv',
            provinces: 'provinces.bmp',
            adjacencies: 'adjacencies.csv',
            continent: 'continent.txt',
            rivers: 'rivers.bmp',
        });
    });

    it('keeps the missing default.map error path when a conventional file is absent', async () => {
        const result = await inferDefaultMapFromConventionalFilesForTest(
            async file => file === 'map/rivers.bmp' || file === 'map/default.map' || !conventionalFiles.has(file) ? undefined : file,
        );

        assert.strictEqual(result, undefined);
    });
});
