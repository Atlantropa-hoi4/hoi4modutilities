import * as assert from 'assert';
import {
    getMioGridDelta,
    getMovedMioPosition,
    hasMioDragPassedThreshold,
    isMioAbsolutePositionInBounds,
} from '../../src/previewdef/mio/draginteraction';

describe('MIO preview drag interaction', () => {
    it('applies zoom-aware grid snapping', () => {
        assert.deepStrictEqual(getMioGridDelta(174, 234, 2, 87, 117), { x: 1, y: 1 });
        assert.deepStrictEqual(getMovedMioPosition({ x: 2, y: 3 }, { x: -1, y: 2 }), { x: 1, y: 5 });
    });

    it('uses a drag threshold and validates absolute bounds', () => {
        assert.strictEqual(hasMioDragPassedThreshold(3, 3, 4), false);
        assert.strictEqual(hasMioDragPassedThreshold(4, 0, 4), true);
        assert.strictEqual(isMioAbsolutePositionInBounds({ x: 9, y: 0 }), true);
        assert.strictEqual(isMioAbsolutePositionInBounds({ x: 10, y: 0 }), false);
        assert.strictEqual(isMioAbsolutePositionInBounds({ x: 0, y: -1 }), false);
    });
});
