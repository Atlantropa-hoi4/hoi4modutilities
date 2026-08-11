import * as assert from 'assert';
import { restoreArrayState, restoreSelectionIndex } from '../../webviewsrc/util/restoredstate';

describe('webview restored state normalization', () => {
    it('restores arrays and rejects incompatible legacy values', () => {
        const values = [{ id: 'one' }];
        assert.strictEqual(restoreArrayState(values), values);
        assert.deepStrictEqual(restoreArrayState({ id: 'legacy' }), []);
        assert.deepStrictEqual(restoreArrayState(undefined), []);
    });

    it('clamps selection indexes to a valid integer item', () => {
        assert.strictEqual(restoreSelectionIndex(2, 4), 2);
        assert.strictEqual(restoreSelectionIndex(9, 4), 3);
        assert.strictEqual(restoreSelectionIndex(-3, 4), 0);
        assert.strictEqual(restoreSelectionIndex(1.8, 4), 1);
        assert.strictEqual(restoreSelectionIndex(Number.NaN, 4), 0);
        assert.strictEqual(restoreSelectionIndex('2', 4), 0);
        assert.strictEqual(restoreSelectionIndex(0, 0), 0);
    });
});
