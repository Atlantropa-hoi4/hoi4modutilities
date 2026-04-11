import * as assert from 'assert';
import { getFocusTreeViewportAnchorId } from '../../src/previewdef/focustree/viewanchor';

describe('focus tree viewport anchor helpers', () => {
    it('prefers the selected focus ids when they are available', () => {
        const anchorFocusId = getFocusTreeViewportAnchorId(
            {
                FOCUS_LEFT: { x: -5, y: 2 },
                FOCUS_SELECTED: { x: 8, y: 1 },
                FOCUS_TOP: { x: 3, y: 0 },
            },
            ['FOCUS_SELECTED'],
        );

        assert.strictEqual(anchorFocusId, 'FOCUS_SELECTED');
    });

    it('falls back to the top-most and then left-most focus position', () => {
        const anchorFocusId = getFocusTreeViewportAnchorId({
            FOCUS_RIGHT: { x: 6, y: 0 },
            FOCUS_LEFT: { x: 2, y: 0 },
            FOCUS_LOWER: { x: -10, y: 3 },
        });

        assert.strictEqual(anchorFocusId, 'FOCUS_LEFT');
    });

    it('returns undefined when there are no focus positions', () => {
        assert.strictEqual(getFocusTreeViewportAnchorId({}), undefined);
    });
});
