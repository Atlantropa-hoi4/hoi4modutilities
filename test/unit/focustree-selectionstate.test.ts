import * as assert from 'assert';
import { clampFocusTreeIndex } from '../../src/previewdef/focustree/selectionstate';

describe('focustree selection state', () => {
    it('clamps negative restored indexes back to zero for single-tree previews', () => {
        assert.strictEqual(clampFocusTreeIndex(-1, 1), 0);
    });

    it('clamps out-of-range indexes to the last available focus tree', () => {
        assert.strictEqual(clampFocusTreeIndex(9, 3), 2);
    });

    it('falls back to zero when the stored index is not finite or there are no trees', () => {
        assert.strictEqual(clampFocusTreeIndex(Number.NaN, 3), 0);
        assert.strictEqual(clampFocusTreeIndex(1, 0), 0);
    });
});
