import * as assert from 'assert';
import {
    applyFocusTreeViewDelta,
    FocusTreeView,
    toFocusTreeView,
} from '../../src/previewdef/focustree/viewmodel';

function createView(): FocusTreeView {
    const focus = (id: string, start: number) => ({
        id,
        x: 0,
        y: 0,
        icon: [],
        prerequisite: [],
        prerequisiteGroupCount: 0,
        prerequisiteFocusCount: 0,
        exclusive: [],
        exclusiveCount: 0,
        inAllowBranch: [],
        offset: [],
        searchFilters: [],
        file: 'common/national_focus/test.txt',
        start,
        end: start + 5,
    });
    return {
        id: 'tree_a',
        kind: 'focus',
        focuses: { FOCUS_A: focus('FOCUS_A', 10), FOCUS_B: focus('FOCUS_B', 40) },
        inlayWindows: [],
        allowBranchOptions: [],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [{
            code: 'lint',
            kind: 'lint',
            severity: 'warning',
            source: 'FOCUS_B',
            text: 'warning',
            navigations: [{ file: 'common/national_focus/test.txt', start: 40, end: 45 }],
        }],
        searchFilters: [],
    };
}

describe('focus tree view model', () => {
    it('omits source ranges and offset-based keys from edit metadata', () => {
        const view = toFocusTreeView({
            ...createView(),
            focuses: {
                FOCUS_A: {
                    ...createView().focuses.FOCUS_A,
                    layoutEditKey: 'focus:test:10',
                    token: { start: 10, end: 15 },
                    isInCurrentFile: true,
                    layout: { editable: true, sourceFile: 'common/national_focus/test.txt' },
                },
            },
            createTemplate: {
                editKey: 'focus-tree:test:focus:0',
                editable: true,
                kind: 'focus',
                sourceFile: 'common/national_focus/test.txt',
                sourceRange: { start: 0, end: 100 },
            },
            continuousLayout: {
                editKey: 'focus-tree:test:focus:0',
                editable: true,
                sourceFile: 'common/national_focus/test.txt',
                focusTreeRange: { start: 0, end: 100 },
                sourceRange: { start: 50, end: 60 },
                x: { nodeRange: { start: 50, end: 55 }, valueRange: { start: 54, end: 55 } },
                basePosition: { x: 1, y: 2 },
            },
            inlayConditionExprs: [],
            inlayWindowRefs: [],
        } as any);

        assert.deepStrictEqual(view.createTemplate, {
            editKey: 'focus-tree:test:focus:0',
            editable: true,
            kind: 'focus',
            sourceFile: 'common/national_focus/test.txt',
            focusIdPrefix: undefined,
        });
        assert.deepStrictEqual(view.continuousLayout, {
            editKey: 'focus-tree:test:focus:0',
            editable: true,
            sourceFile: 'common/national_focus/test.txt',
            basePosition: { x: 1, y: 2 },
        });
        assert.strictEqual('layoutEditKey' in view.focuses.FOCUS_A, false);
        assert.strictEqual(view.focuses.FOCUS_A.start, 10);
        assert.strictEqual(view.focuses.FOCUS_A.editable, true);
    });

    it('applies focus, range, and warning deltas without replacing unchanged fields', () => {
        const tree = createView();
        const unchangedFocus = tree.focuses.FOCUS_A;
        const warnings = tree.warnings;
        const conditionExprs = tree.conditionExprs;
        const next = applyFocusTreeViewDelta(tree, {
            focuses: {
                FOCUS_B: { ...tree.focuses.FOCUS_B, x: 3 },
                FOCUS_UNKNOWN: { ...tree.focuses.FOCUS_B, id: 'FOCUS_UNKNOWN' },
            },
            ranges: { FOCUS_A: [13, null] },
            warningRanges: [[[43, 48]]],
        });

        assert.notStrictEqual(next, tree);
        assert.deepStrictEqual(Object.keys(next.focuses), ['FOCUS_A', 'FOCUS_B']);
        assert.strictEqual(next.focuses.FOCUS_B.x, 3);
        assert.strictEqual(next.focuses.FOCUS_A.start, 13);
        assert.strictEqual(next.focuses.FOCUS_A.end, undefined);
        assert.strictEqual(unchangedFocus.start, 10);
        assert.strictEqual(next.warnings, warnings);
        assert.deepStrictEqual(next.warnings[0].navigations, [{ file: 'common/national_focus/test.txt', start: 43, end: 48 }]);
        assert.strictEqual(next.conditionExprs, conditionExprs);
    });

    it('replaces the header and warnings when they change', () => {
        const tree = createView();
        const { focuses: _focuses, warnings: _warnings, ...header } = tree;
        const next = applyFocusTreeViewDelta(tree, {
            header: { ...header, allowBranchOptions: ['FOCUS_A'] },
            warnings: [],
        });

        assert.deepStrictEqual(next.allowBranchOptions, ['FOCUS_A']);
        assert.deepStrictEqual(next.warnings, []);
        assert.strictEqual(next.focuses.FOCUS_A, tree.focuses.FOCUS_A);
    });
});
