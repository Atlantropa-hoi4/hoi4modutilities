import * as assert from 'assert';
import type { Mio } from '../../src/previewdef/mio/schema';
import { applyMioLocalPositions } from '../../src/previewdef/mio/localpreview';

describe('MIO immediate position preview', () => {
    it('updates local coordinates immediately and restores them after rejection without changing relative links', () => {
        const mio = { traits: {
            root: { x: 2, y: 1 },
            child: { x: 1, y: 2, relativePositionId: 'root' },
        } } as unknown as Mio;
        const rollback = applyMioLocalPositions(mio, [
            { traitId: 'root', x: 3, y: 2, absoluteX: 3, absoluteY: 2 },
            { traitId: 'child', x: 2, y: 3, absoluteX: 5, absoluteY: 5 },
        ]);
        assert.deepStrictEqual([mio.traits.root.x, mio.traits.root.y, mio.traits.child.x, mio.traits.child.y], [3, 2, 2, 3]);
        assert.strictEqual(mio.traits.child.relativePositionId, 'root');
        rollback();
        assert.deepStrictEqual([mio.traits.root.x, mio.traits.root.y, mio.traits.child.x, mio.traits.child.y], [2, 1, 1, 2]);
        assert.strictEqual(mio.traits.child.relativePositionId, 'root');
    });
});
