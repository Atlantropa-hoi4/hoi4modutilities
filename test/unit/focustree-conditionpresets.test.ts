import * as assert from 'assert';

const {
    areConditionExprKeySetsEqual,
    conditionItemToExprKey,
    deleteConditionPreset,
    filterConditionExprKeys,
    findMatchingConditionPresetId,
} = require('../../src/previewdef/focustree/conditionpresets') as typeof import('../../src/previewdef/focustree/conditionpresets');

describe('focus tree condition preset helpers', () => {
    it('matches condition sets regardless of order', () => {
        const first = [
            conditionItemToExprKey({ scopeName: '', nodeContent: 'has_country_flag = ENG_path_fixed' }),
            conditionItemToExprKey({ scopeName: '', nodeContent: 'check_variable = { ENG_focus_branch = 0 }' }),
        ];
        const second = [first[1], first[0]];

        assert.strictEqual(areConditionExprKeySetsEqual(first, second), true);
    });

    it('filters preset expr keys against the currently available keys', () => {
        const available = [
            conditionItemToExprKey({ scopeName: '', nodeContent: 'has_country_flag = ENG_path_fixed' }),
            conditionItemToExprKey({ scopeName: '', nodeContent: 'check_variable = { ENG_focus_branch = 0 }' }),
        ];
        const filtered = filterConditionExprKeys(
            [
                available[1],
                conditionItemToExprKey({ scopeName: '', nodeContent: 'missing_condition = yes' }),
                available[0],
            ],
            available,
        );

        assert.deepStrictEqual(filtered, [available[0], available[1]].sort());
    });

    it('returns undefined when stale preset keys collapse to an empty selection', () => {
        const presetExprKeys = [conditionItemToExprKey({ scopeName: '', nodeContent: 'missing_condition = yes' })];
        const filtered = filterConditionExprKeys(presetExprKeys, []);

        assert.deepStrictEqual(filtered, []);
    });

    it('removes deleted presets and clears their selection match', () => {
        const exprKeys = [conditionItemToExprKey({ scopeName: '', nodeContent: 'has_country_flag = ENG_path_fixed' })];
        const presets = [
            { id: 'preset-a', name: 'A', exprKeys },
            { id: 'preset-b', name: 'B', exprKeys: [conditionItemToExprKey({ scopeName: '', nodeContent: 'other = yes' })] },
        ];
        const remainingPresets = deleteConditionPreset(presets, 'preset-a');

        assert.deepStrictEqual(remainingPresets.map(preset => preset.id), ['preset-b']);
        assert.strictEqual(findMatchingConditionPresetId(remainingPresets, exprKeys), undefined);
    });
});
