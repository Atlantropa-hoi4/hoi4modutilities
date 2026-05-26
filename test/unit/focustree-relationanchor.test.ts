import * as assert from 'assert';

const {
    getRelativePositionRootFocusId,
    getTopMostBranchRootFocusAnchorId,
    getTopMostFocusAnchorId,
} = require('../../src/previewdef/focustree/relationanchor') as typeof import('../../src/previewdef/focustree/relationanchor');

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

    it('resolves a relative_position_id chain to the branch root focus', () => {
        const focusTree = {
            focuses: {
                ROOT: { id: 'ROOT', relativePositionId: undefined },
                MID: { id: 'MID', relativePositionId: 'ROOT' },
                CHILD: { id: 'CHILD', relativePositionId: 'MID' },
            },
        } as any;

        assert.strictEqual(getRelativePositionRootFocusId('CHILD', focusTree), 'ROOT');
    });

    it('uses branch root focuses before choosing the top-most grouped anchor', () => {
        const focusTree = {
            focuses: {
                ROOT_A: { id: 'ROOT_A', relativePositionId: undefined },
                MID_A: { id: 'MID_A', relativePositionId: 'ROOT_A' },
                CHILD_A: { id: 'CHILD_A', relativePositionId: 'MID_A' },
                ROOT_B: { id: 'ROOT_B', relativePositionId: undefined },
                CHILD_B: { id: 'CHILD_B', relativePositionId: 'ROOT_B' },
            },
        } as any;

        const anchor = getTopMostBranchRootFocusAnchorId(
            ['CHILD_A', 'CHILD_B'],
            focusTree,
            {
                ROOT_A: { x: 8, y: 6 },
                CHILD_A: { x: 9, y: 9 },
                ROOT_B: { x: 2, y: 3 },
                CHILD_B: { x: 2, y: 7 },
            },
            'CHILD_A',
        );

        assert.strictEqual(anchor, 'ROOT_B');
    });
});
