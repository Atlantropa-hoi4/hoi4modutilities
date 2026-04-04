import * as assert from 'assert';
import { areEqualWithinBudget, createWorldMapComparisonBudget } from '../../src/previewdef/worldmap/worldmapdiff';

describe('world map diff helpers', () => {
    it('returns false on obvious shallow differences without consuming deep-comparison budget', () => {
        const budget = createWorldMapComparisonBudget(1);
        const result = areEqualWithinBudget(
            { id: 1, provinces: [1, 2], owner: 'GER' },
            { id: 1, provinces: [1, 2, 3], owner: 'GER' },
            budget,
        );

        assert.strictEqual(result, false);
        assert.strictEqual(budget.remaining, 1);
    });

    it('uses deep comparison budget for structurally similar objects', () => {
        const budget = createWorldMapComparisonBudget(2);
        const result = areEqualWithinBudget(
            { id: 1, provinces: [1, 2], owner: 'GER' },
            { id: 1, provinces: [1, 2], owner: 'GER' },
            budget,
        );

        assert.strictEqual(result, true);
        assert.strictEqual(budget.remaining, 1);
    });

    it('returns undefined when the deep-comparison budget is exhausted', () => {
        const budget = createWorldMapComparisonBudget(0);
        const result = areEqualWithinBudget(
            { id: 1, provinces: [1, 2], owner: 'GER' },
            { id: 1, provinces: [1, 2], owner: 'GER' },
            budget,
        );

        assert.strictEqual(result, undefined);
    });
});
