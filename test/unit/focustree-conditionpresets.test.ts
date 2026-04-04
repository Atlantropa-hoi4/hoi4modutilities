import * as assert from 'assert';

const {
    normalizeConditionExprKeys,
    filterConditionPresetExprKeys,
    findMatchingConditionPreset,
    areConditionExprKeySetsEqual,
} = require('../../src/previewdef/focustree/conditionpresets') as typeof import('../../src/previewdef/focustree/conditionpresets');

describe('focus tree condition presets', () => {
    it('normalizes expr keys by deduping and sorting them', () => {
        assert.deepStrictEqual(
            normalizeConditionExprKeys(['b!|two', 'a!|one', 'b!|two']),
            ['a!|one', 'b!|two'],
        );
    });

    it('filters preset expr keys against the currently available tree condition keys', () => {
        assert.deepStrictEqual(
            filterConditionPresetExprKeys(
                ['root!|a', 'root!|missing', 'root!|b'],
                ['root!|b', 'root!|a'],
            ),
            ['root!|a', 'root!|b'],
        );
    });

    it('matches presets by exact expr key set regardless of order', () => {
        const preset = findMatchingConditionPreset(
            [
                { id: 'one', name: 'Path A', exprKeys: ['root!|b', 'root!|a'] },
                { id: 'two', name: 'Path B', exprKeys: ['root!|c'] },
            ],
            ['root!|a', 'root!|b'],
        );

        assert.strictEqual(preset?.id, 'one');
    });

    it('treats different expr key sets as different presets', () => {
        assert.strictEqual(
            areConditionExprKeySetsEqual(['root!|a', 'root!|b'], ['root!|a']),
            false,
        );
    });
});
