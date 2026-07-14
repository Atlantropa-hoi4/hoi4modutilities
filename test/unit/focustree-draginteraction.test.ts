import * as assert from 'assert';
import {
    getScaledFocusDragDelta,
    getSnappedFocusDragPosition,
    hasFocusDragPassedThreshold,
} from '../../src/previewdef/focustree/draginteraction';

describe('focustree drag interaction', () => {
    it('uses the largest pointer axis for the drag threshold', () => {
        assert.strictEqual(hasFocusDragPassedThreshold(3, -3, 4), false);
        assert.strictEqual(hasFocusDragPassedThreshold(4, 0, 4), true);
        assert.strictEqual(hasFocusDragPassedThreshold(0, -5, 4), true);
    });

    it('normalizes pointer movement before snapping it to the focus grid', () => {
        const scaledDelta = getScaledFocusDragDelta(192, -260, 2);
        assert.deepStrictEqual(scaledDelta, { x: 96, y: -130 });
        assert.deepStrictEqual(
            getSnappedFocusDragPosition({ x: 4, y: 7 }, scaledDelta, 96, 130),
            { x: 5, y: 6 },
        );
    });
});
