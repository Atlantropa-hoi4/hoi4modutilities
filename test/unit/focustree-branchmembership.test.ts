import * as assert from 'assert';
import { propagateFocusBranchMembership } from '../../src/previewdef/focustree/branchmembership';

describe('focus branch membership propagation', () => {
    const createFocus = (id: string, prerequisite: string[][] = [], inAllowBranch: string[] = []) => ({
        id,
        prerequisite,
        inAllowBranch,
    });

    it('preserves branch order through reverse-ordered, repeated, and missing prerequisites', () => {
        const focuses = {
            CHILD: createFocus('CHILD', [['PARENT', 'MISSING'], ['SECOND', 'PARENT']]),
            PARENT: createFocus('PARENT', [['FIRST']], ['PARENT']),
            FIRST: createFocus('FIRST', [], ['FIRST']),
            SECOND: createFocus('SECOND', [], ['SECOND']),
        };

        propagateFocusBranchMembership(focuses);

        assert.deepStrictEqual(focuses.CHILD.inAllowBranch, ['PARENT', 'SECOND', 'FIRST']);
        assert.deepStrictEqual(focuses.PARENT.inAllowBranch, ['PARENT', 'FIRST']);
        assert.deepStrictEqual(focuses.FIRST.inAllowBranch, ['FIRST']);
    });

    it('converges for cyclic and self-referencing prerequisites without duplicate branches', () => {
        const focuses = {
            A: createFocus('A', [['B', 'A']], ['A']),
            B: createFocus('B', [['C']], ['B']),
            C: createFocus('C', [['A']]),
            ISOLATED: createFocus('ISOLATED', [['ISOLATED']]),
        };

        propagateFocusBranchMembership(focuses);

        assert.deepStrictEqual(focuses.A.inAllowBranch, ['A', 'B']);
        assert.deepStrictEqual(focuses.B.inAllowBranch, ['B', 'A']);
        assert.deepStrictEqual(focuses.C.inAllowBranch, ['A', 'B']);
        assert.deepStrictEqual(focuses.ISOLATED.inAllowBranch, []);
    });

    it('keeps graph reads linear for a large reverse-ordered dependency chain', () => {
        const focusCount = 1000;
        const focuses: Record<string, ReturnType<typeof createFocus>> = {};
        let graphReads = 0;
        for (let index = focusCount - 1; index >= 0; index -= 1) {
            const prerequisite = index === 0 ? [] : [[`FOCUS_${index - 1}`]];
            const inAllowBranch = index === 0 ? ['FOCUS_0'] : [];
            focuses[`FOCUS_${index}`] = {
                id: `FOCUS_${index}`,
                get prerequisite() {
                    graphReads += 1;
                    return prerequisite;
                },
                get inAllowBranch() {
                    graphReads += 1;
                    return inAllowBranch;
                },
            };
        }

        propagateFocusBranchMembership(focuses);

        assert.ok(graphReads <= focusCount * 6, `Propagation made ${graphReads} graph reads`);
        assert.deepStrictEqual(focuses.FOCUS_999.inAllowBranch, ['FOCUS_0']);
        assert.deepStrictEqual(focuses.FOCUS_0.inAllowBranch, ['FOCUS_0']);
    });
});
