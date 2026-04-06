import * as assert from 'assert';
import { resolveSelectedConditionExprKeys, shouldHideDisallowedFocuses } from '../../src/previewdef/focustree/conditionselection';

describe('focus tree condition selection helpers', () => {
    it('keeps the default selection empty when no condition is chosen', () => {
        const result = resolveSelectedConditionExprKeys([], ['a', 'b'], false);

        assert.deepStrictEqual(result, []);
    });

    it('filters the restored selection against the available conditions', () => {
        const result = resolveSelectedConditionExprKeys(['a', 'missing', 'b'], ['b', 'a'], false);

        assert.deepStrictEqual(result, ['a', 'b']);
    });

    it('can fall back to a default condition when the selection is empty', () => {
        const result = resolveSelectedConditionExprKeys([], ['b', 'a'], false, 'b');

        assert.deepStrictEqual(result, ['b']);
    });

    it('clears the selection when the caller requests it', () => {
        const result = resolveSelectedConditionExprKeys(['a'], ['a', 'b'], true);

        assert.deepStrictEqual(result, []);
    });

    it('keeps allow_branch filtering active even when no condition is selected', () => {
        assert.strictEqual(shouldHideDisallowedFocuses(true, ['a']), true);
        assert.strictEqual(shouldHideDisallowedFocuses(true, []), false);
        assert.strictEqual(shouldHideDisallowedFocuses(false, ['a']), false);
    });
});
