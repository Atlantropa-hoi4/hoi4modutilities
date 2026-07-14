import * as assert from 'assert';
import { ConditionItem } from '../../src/hoiformat/condition';
import {
    focusTreeLayoutPlanCacheLimit,
    getCachedFocusTreeLayoutPlan,
    invalidateCachedFocusTreeLayoutPlan,
    resolveFocusTreeLayoutPlan,
} from '../../src/previewdef/focustree/layoutplan';

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

    const createFallbackTree = () => ({
        id: 'focus_tree_beta',
        allowBranchOptions: ['FOCUS_GATE'],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [],
        inlayWindows: [],
        focuses: {
            FOCUS_GATE: {
                id: 'FOCUS_GATE',
                x: 0,
                y: 0,
                icon: [{ icon: 'GFX_goal_generic', condition: emptyCondition }],
                prerequisite: [],
                exclusive: [],
                inAllowBranch: ['FOCUS_GATE'],
                allowBranch: {
                    type: 'ornot',
                    items: [{ scopeName: '', nodeContent: 'custom_condition = yes' }],
                },
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

    it('bounds cached condition layouts per tree with least-recently-used eviction', () => {
        const focusTree = createTree() as any;
        const firstExprs: ConditionItem[] = [{ scopeName: '', nodeContent: 'custom_condition = 0' }];
        const firstPlan = getCachedFocusTreeLayoutPlan(focusTree, firstExprs, true);
        let mostRecentPlan = firstPlan;
        let mostRecentExprs = firstExprs;

        for (let index = 1; index <= focusTreeLayoutPlanCacheLimit; index += 1) {
            mostRecentExprs = [{ scopeName: '', nodeContent: `custom_condition = ${index}` }];
            mostRecentPlan = getCachedFocusTreeLayoutPlan(focusTree, mostRecentExprs, true);
        }

        assert.strictEqual(getCachedFocusTreeLayoutPlan(focusTree, mostRecentExprs, true), mostRecentPlan);
        assert.notStrictEqual(getCachedFocusTreeLayoutPlan(focusTree, firstExprs, true), firstPlan);
    });

    it('propagates allow-branch state through a reverse-ordered dependency chain', () => {
        const focusCount = 1000;
        const focuses: Record<string, any> = {};
        for (let index = focusCount - 1; index >= 0; index -= 1) {
            focuses[`FOCUS_${index}`] = {
                id: `FOCUS_${index}`,
                x: index,
                y: 0,
                icon: [],
                prerequisite: index === 0 ? [] : [[`FOCUS_${index - 1}`]],
                exclusive: [],
                inAllowBranch: [],
                allowBranch: undefined,
                relativePositionId: undefined,
                offset: [],
            };
        }
        const focusTree = {
            id: 'focus_tree_chain',
            allowBranchOptions: ['FOCUS_0'],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
            inlayWindows: [],
            focuses,
        } as any;

        const plan = getCachedFocusTreeLayoutPlan(focusTree, [], true);

        assert.strictEqual(plan.focusGridBoxItems.length, focusCount);
        assert.deepStrictEqual(plan.focusPosition.FOCUS_999, { x: 999, y: 0 });
    });

    it('preserves mixed false and unresolved prerequisite propagation', () => {
        const focusTree = createTree() as any;
        focusTree.focuses.FOCUS_GATE.allowBranch = {
            scopeName: '',
            nodeContent: 'required_condition = yes',
        };
        focusTree.focuses.FOCUS_FALSE = {
            ...focusTree.focuses.FOCUS_ROOT,
            id: 'FOCUS_FALSE',
            prerequisite: [['FOCUS_GATE']],
        };
        focusTree.focuses.FOCUS_LATE_FALSE = {
            ...focusTree.focuses.FOCUS_ROOT,
            id: 'FOCUS_LATE_FALSE',
            prerequisite: [['UNKNOWN'], ['FOCUS_FALSE']],
        };
        focusTree.focuses.FOCUS_UNRESOLVED = {
            ...focusTree.focuses.FOCUS_ROOT,
            id: 'FOCUS_UNRESOLVED',
            prerequisite: [['FOCUS_GATE', 'UNKNOWN']],
        };

        const plan = getCachedFocusTreeLayoutPlan(focusTree, [], true);

        assert.ok(!plan.focusGridBoxItems.some(item => item.id === 'FOCUS_GATE'));
        assert.ok(!plan.focusGridBoxItems.some(item => item.id === 'FOCUS_FALSE'));
        assert.ok(!plan.focusGridBoxItems.some(item => item.id === 'FOCUS_LATE_FALSE'));
        assert.ok(plan.focusGridBoxItems.some(item => item.id === 'FOCUS_UNRESOLVED'));
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

    it('falls back to an empty selection when a persisted condition combination would hide the entire tree', () => {
        const focusTree = createFallbackTree() as any;

        const result = resolveFocusTreeLayoutPlan(
            focusTree,
            [],
            [{ scopeName: '', nodeContent: 'custom_condition = yes' }],
            true,
        );

        assert.strictEqual(result.clearedSelectedExprs, true);
        assert.deepStrictEqual(result.renderExprs, [{ scopeName: '', nodeContent: 'has_focus_tree = focus_tree_beta' }]);
        assert.deepStrictEqual(result.layoutPlan.focusGridBoxItems.map(item => item.id), ['FOCUS_GATE']);
    });

    it('shows the full tree when clearing a condition still leaves every allow branch disallowed', () => {
        const focusTree = createFallbackTree() as any;
        focusTree.focuses.FOCUS_GATE.allowBranch = {
            scopeName: '',
            nodeContent: 'required_condition = yes',
        };

        const result = resolveFocusTreeLayoutPlan(
            focusTree,
            [],
            [{ scopeName: '', nodeContent: 'unrelated_condition = yes' }],
            true,
        );

        assert.strictEqual(result.clearedSelectedExprs, true);
        assert.deepStrictEqual(result.layoutPlan.focusGridBoxItems.map(item => item.id), ['FOCUS_GATE']);
    });
});
