import * as assert from 'assert';
import { clampFocusTreeIndex, resolveFocusTreeSelection, resolveRenderableFocusTreeSelection } from '../../src/previewdef/focustree/selectionstate';

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

    it('keeps the resolved selection when that tree is renderable', () => {
        const selection = resolveRenderableFocusTreeSelection(
            [
                { id: 'focus_tree_alpha', renderable: false },
                { id: 'focus_tree_beta', renderable: true },
            ],
            'focus_tree_beta',
            0,
            focusTree => focusTree.renderable,
        );

        assert.deepStrictEqual(selection, {
            selectedFocusTreeIndex: 1,
            selectedFocusTreeId: 'focus_tree_beta',
        });
    });

    it('falls back to the first renderable tree when the resolved selection cannot be rendered', () => {
        const selection = resolveRenderableFocusTreeSelection(
            [
                { id: 'focus_tree_alpha', renderable: false },
                { id: 'focus_tree_beta', renderable: true },
                { id: 'focus_tree_gamma', renderable: true },
            ],
            'focus_tree_alpha',
            0,
            focusTree => focusTree.renderable,
        );

        assert.deepStrictEqual(selection, {
            selectedFocusTreeIndex: 1,
            selectedFocusTreeId: 'focus_tree_beta',
        });
    });
});
