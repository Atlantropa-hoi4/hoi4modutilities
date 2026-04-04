import * as assert from 'assert';

const { getTopMostFocusAnchorId } = require('../../src/previewdef/focustree/relationanchor') as typeof import('../../src/previewdef/focustree/relationanchor');

describe('focus tree relation anchor helpers', () => {
    it('picks the top-most focus by y position for grouped prerequisite anchors', () => {
        const anchor = getTopMostFocusAnchorId(
            ['LOWER', 'UPPER', 'MIDDLE'],
            {
                LOWER: { x: 4, y: 8 },
                UPPER: { x: 6, y: 2 },
                MIDDLE: { x: 5, y: 5 },
            },
            'LOWER',
        );

        assert.strictEqual(anchor, 'UPPER');
    });

    it('breaks ties by x position and falls back when no positions are available', () => {
        const tieAnchor = getTopMostFocusAnchorId(
            ['RIGHT', 'LEFT'],
            {
                RIGHT: { x: 7, y: 3 },
                LEFT: { x: 2, y: 3 },
            },
            'RIGHT',
        );
        const fallbackAnchor = getTopMostFocusAnchorId(['UNKNOWN'], {}, 'UNKNOWN');

        assert.strictEqual(tieAnchor, 'LEFT');
        assert.strictEqual(fallbackAnchor, 'UNKNOWN');
    });
});
