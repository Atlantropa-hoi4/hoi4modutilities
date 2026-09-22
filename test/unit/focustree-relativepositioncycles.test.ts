import * as assert from 'assert';
import { findFocusRelativePositionCycles } from '../../src/previewdef/focustree/relativepositioncycles';

describe('focus relative position cycle detection', () => {
    it('reports each cycle from the focus that closes it in file order', () => {
        const focuses = {
            ENTRY: { id: 'ENTRY', relativePositionId: 'A' },
            A: { id: 'A', relativePositionId: 'B' },
            B: { id: 'B', relativePositionId: 'C' },
            C: { id: 'C', relativePositionId: 'A' },
            LATE_ENTRY: { id: 'LATE_ENTRY', relativePositionId: 'B' },
            SELF: { id: 'SELF', relativePositionId: 'SELF' },
            MISSING: { id: 'MISSING', relativePositionId: 'UNKNOWN' },
            ROOT: { id: 'ROOT' },
        };

        assert.deepStrictEqual(findFocusRelativePositionCycles(focuses), [['C', 'A', 'B', 'C'], ['SELF', 'SELF']]);
    });

    it('keeps source reads linear for deep chains and detects a cycle at their final edge', () => {
        const focusCount = 20000;
        let graphReads = 0;
        const focuses: Record<string, { id: string; relativePositionId?: string }> = {};
        for (let index = 0; index < focusCount; index += 1) {
            focuses[`F${index}`] = {
                get id() {
                    graphReads += 1;
                    return `F${index}`;
                },
                get relativePositionId() {
                    graphReads += 1;
                    return index === 0 ? undefined : `F${index - 1}`;
                },
            };
        }

        assert.deepStrictEqual(findFocusRelativePositionCycles(focuses), []);
        assert.ok(graphReads <= focusCount * 3, `Cycle detection made ${graphReads} graph reads`);

        focuses.F0 = { id: 'F0', relativePositionId: `F${focusCount - 1}` };
        const cycles = findFocusRelativePositionCycles(focuses);
        assert.strictEqual(cycles.length, 1);
        assert.strictEqual(cycles[0].length, focusCount + 1);
        assert.strictEqual(cycles[0][0], `F${focusCount - 1}`);
        assert.strictEqual(cycles[0][focusCount], `F${focusCount - 1}`);
    });
});
