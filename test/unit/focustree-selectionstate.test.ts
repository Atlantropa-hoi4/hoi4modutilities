import * as assert from 'assert';
import { clampFocusTreeIndex, resolveFocusTreeSelection } from '../../src/previewdef/focustree/selectionstate';

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

    it('preserves the selected tree by id when refresh reorders the tree list', () => {
        const selection = resolveFocusTreeSelection(
            [
                { id: 'focus_tree_beta' },
                { id: 'focus_tree_alpha' },
            ],
            'focus_tree_alpha',
            0,
        );

        assert.deepStrictEqual(selection, {
            selectedFocusTreeIndex: 1,
            selectedFocusTreeId: 'focus_tree_alpha',
        });
    });

    it('falls back to the clamped index when the stored tree id no longer exists', () => {
        const selection = resolveFocusTreeSelection(
            [
                { id: 'focus_tree_alpha' },
                { id: 'focus_tree_beta' },
            ],
            'missing_tree',
            9,
        );

        assert.deepStrictEqual(selection, {
            selectedFocusTreeIndex: 1,
            selectedFocusTreeId: 'focus_tree_beta',
        });
    });
});
