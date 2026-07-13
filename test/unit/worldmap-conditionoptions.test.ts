import * as assert from 'assert';
import { conditionItemToStringValue } from '../../src/hoiformat/condition';
import { buildWorldMapConditionOptions } from '../../webviewsrc/worldmap/conditionoptions';

describe('world map condition options', () => {
    it('keeps condition selection untouched while refresh exposes an empty placeholder map', () => {
        assert.strictEqual(buildWorldMapConditionOptions({
            width: 0,
            height: 0,
            conditionExprs: [],
            bookmarks: [],
        }), undefined);
    });

    it('labels scenario conditions with matching bookmark names', () => {
        const scenario = { scopeName: '', nodeContent: '1939.1.1.0' };
        const scriptedCondition = { scopeName: '', nodeContent: 'has_global_flag = alternate_path' };

        assert.deepStrictEqual(buildWorldMapConditionOptions({
            width: 64,
            height: 32,
            conditionExprs: [scenario, scriptedCondition],
            bookmarks: [
                { name: 'BLITZKRIEG', date: { year: 1939, month: 1, day: 1, hour: 0 } },
                { name: 'SECOND_NAME', date: { year: 1939, month: 1, day: 1, hour: 0 } },
            ],
        }), [
            {
                value: conditionItemToStringValue(scenario),
                text: 'BLITZKRIEG / SECOND_NAME (1939.1.1.0)',
            },
            {
                value: conditionItemToStringValue(scriptedCondition),
                text: 'has_global_flag = alternate_path',
            },
        ]);
    });
});
