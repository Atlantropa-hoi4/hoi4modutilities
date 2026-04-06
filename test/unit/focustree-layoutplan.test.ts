import * as assert from 'assert';
import { ConditionItem } from '../../src/hoiformat/condition';
import { getCachedFocusTreeLayoutPlan, invalidateCachedFocusTreeLayoutPlan } from '../../src/previewdef/focustree/layoutplan';

describe('focustree layout plan cache', () => {
    const emptyCondition = { type: 'and', items: [] } as any;

    const createTree = () => ({
        id: 'focus_tree_alpha',
        allowBranchOptions: ['FOCUS_GATE'],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [],
        inlayWindows: [],
        focuses: {
            FOCUS_ROOT: {
                id: 'FOCUS_ROOT',
                x: 1,
                y: 2,
                icon: [{ icon: 'GFX_goal_generic', condition: emptyCondition }],
                prerequisite: [],
                exclusive: [],
                inAllowBranch: [],
                allowBranch: undefined,
                relativePositionId: undefined,
                offset: [],
            },
            FOCUS_CHILD: {
                id: 'FOCUS_CHILD',
                x: 2,
                y: 0,
                icon: [{ icon: 'GFX_goal_generic', condition: emptyCondition }],
                prerequisite: [['FOCUS_ROOT']],
                exclusive: ['FOCUS_GATE'],
                inAllowBranch: [],
                allowBranch: undefined,
                relativePositionId: 'FOCUS_ROOT',
                offset: [],
            },
            FOCUS_GATE: {
                id: 'FOCUS_GATE',
                x: 4,
                y: 1,
                icon: [{ icon: 'GFX_goal_generic', condition: emptyCondition }],
                prerequisite: [],
                exclusive: ['FOCUS_CHILD'],
                inAllowBranch: ['FOCUS_GATE'],
                allowBranch: { scopeName: '', nodeContent: 'has_completed_focus = FOCUS_ROOT' },
                relativePositionId: undefined,
                offset: [],
            },
        },
    });

    it('reuses the cached plan for the same tree and equivalent expr set', () => {
        const focusTree = createTree() as any;
        const exprsA: ConditionItem[] = [
            { scopeName: '', nodeContent: 'has_focus_tree = focus_tree_alpha' },
            { scopeName: '', nodeContent: 'custom_condition = yes' },
        ];
        const exprsB: ConditionItem[] = [
            { scopeName: '', nodeContent: 'custom_condition = yes' },
            { scopeName: '', nodeContent: 'has_focus_tree = focus_tree_alpha' },
        ];

        const firstPlan = getCachedFocusTreeLayoutPlan(focusTree, exprsA, true);
        const secondPlan = getCachedFocusTreeLayoutPlan(focusTree, exprsB, true);

        assert.strictEqual(firstPlan, secondPlan);
    });

    it('recomputes positions after cache invalidation on a mutated tree', () => {
        const focusTree = createTree() as any;
        const exprs: ConditionItem[] = [{ scopeName: '', nodeContent: 'has_focus_tree = focus_tree_alpha' }];

        const firstPlan = getCachedFocusTreeLayoutPlan(focusTree, exprs, true);
        assert.deepStrictEqual(firstPlan.focusPosition.FOCUS_CHILD, { x: 3, y: 2 });

        focusTree.focuses.FOCUS_ROOT.x = 5;
        invalidateCachedFocusTreeLayoutPlan(focusTree);

        const secondPlan = getCachedFocusTreeLayoutPlan(focusTree, exprs, true);
        assert.notStrictEqual(firstPlan, secondPlan);
        assert.deepStrictEqual(secondPlan.focusPosition.FOCUS_CHILD, { x: 7, y: 2 });
    });

    it('keeps disallowed focuses hidden only when the caller requests condition visibility filtering', () => {
        const focusTree = createTree() as any;
        const exprs: ConditionItem[] = [{ scopeName: '', nodeContent: 'has_focus_tree = focus_tree_alpha' }];

        const hiddenPlan = getCachedFocusTreeLayoutPlan(focusTree, exprs, true);
        assert.deepStrictEqual(hiddenPlan.focusGridBoxItems.map(item => item.id), ['FOCUS_ROOT', 'FOCUS_CHILD']);

        const shownPlan = getCachedFocusTreeLayoutPlan(focusTree, exprs, false);
        assert.deepStrictEqual(shownPlan.focusGridBoxItems.map(item => item.id), ['FOCUS_ROOT', 'FOCUS_CHILD', 'FOCUS_GATE']);
    });
});
