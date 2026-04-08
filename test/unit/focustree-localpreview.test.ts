import * as assert from 'assert';
import {
    applyLocalFocusDeletion,
    createPlaceholderFocus,
    isPendingPlaceholderFocus,
    renderPendingPlaceholderFocusTemplate,
} from '../../src/previewdef/focustree/localpreview';

describe('focustree local preview helpers', () => {
    it('creates a placeholder focus at the requested absolute position', () => {
        const focus = createPlaceholderFocus({
            id: 'tree_a',
            kind: 'focus',
            focuses: {},
            createTemplate: {
                editKey: 'tree-edit',
                editable: true,
                kind: 'focus',
                sourceFile: 'common/national_focus/test.txt',
            },
            allowBranchOptions: [],
            conditionExprs: [],
            inlayConditionExprs: [],
            inlayWindowRefs: [],
            inlayWindows: [],
            isSharedFocues: false,
            warnings: [],
        } as any, 'TAG_FOCUS_ID', 7, 9, 'common/national_focus/test.txt');

        assert.strictEqual(focus.id, 'TAG_FOCUS_ID');
        assert.strictEqual(focus.x, 7);
        assert.strictEqual(focus.y, 9);
        assert.strictEqual(focus.file, 'common/national_focus/test.txt');
        assert.deepStrictEqual(focus.prerequisite, []);
        assert.deepStrictEqual(focus.exclusive, []);
    });

    it('marks freshly created placeholder focuses as pending and renders a fallback template', () => {
        const focus = createPlaceholderFocus({
            id: 'tree_a',
            kind: 'focus',
            focuses: {},
            createTemplate: {
                editKey: 'tree-edit',
                editable: true,
                kind: 'focus',
                sourceFile: 'common/national_focus/test.txt',
            },
            allowBranchOptions: [],
            conditionExprs: [],
            inlayConditionExprs: [],
            inlayWindowRefs: [],
            inlayWindows: [],
            isSharedFocues: false,
            warnings: [],
        } as any, 'TAG_FOCUS_ID', 7, 9, 'common/national_focus/test.txt');

        assert.strictEqual(isPendingPlaceholderFocus(focus), true);
        const template = renderPendingPlaceholderFocusTemplate(focus);
        assert.match(template, /data-focus-id="TAG_FOCUS_ID"/);
        assert.match(template, /TAG_FOCUS_ID/);
        assert.match(template, /data-focus-editable="false"/);
    });

    it('removes deleted focuses and strips their references from surviving nodes', () => {
        const focusTree = {
            focuses: {
                FOCUS_A: {
                    id: 'FOCUS_A',
                    prerequisite: [],
                    prerequisiteGroupCount: 0,
                    prerequisiteFocusCount: 0,
                    exclusive: ['FOCUS_B'],
                    exclusiveCount: 1,
                    inAllowBranch: ['FOCUS_B'],
                    relativePositionId: 'FOCUS_B',
                },
                FOCUS_B: {
                    id: 'FOCUS_B',
                    prerequisite: [['FOCUS_A']],
                    prerequisiteGroupCount: 1,
                    prerequisiteFocusCount: 1,
                    exclusive: [],
                    exclusiveCount: 0,
                    inAllowBranch: [],
                    relativePositionId: undefined,
                },
                FOCUS_C: {
                    id: 'FOCUS_C',
                    prerequisite: [['FOCUS_A', 'FOCUS_B']],
                    prerequisiteGroupCount: 1,
                    prerequisiteFocusCount: 2,
                    exclusive: ['FOCUS_B'],
                    exclusiveCount: 1,
                    inAllowBranch: ['FOCUS_B'],
                    relativePositionId: 'FOCUS_B',
                },
            },
        } as any;

        applyLocalFocusDeletion(focusTree, ['FOCUS_B']);

        assert.strictEqual(focusTree.focuses.FOCUS_B, undefined);
        assert.deepStrictEqual(focusTree.focuses.FOCUS_A.exclusive, []);
        assert.strictEqual(focusTree.focuses.FOCUS_A.relativePositionId, undefined);
        assert.deepStrictEqual(focusTree.focuses.FOCUS_C.prerequisite, [['FOCUS_A']]);
        assert.strictEqual(focusTree.focuses.FOCUS_C.prerequisiteGroupCount, 1);
        assert.strictEqual(focusTree.focuses.FOCUS_C.prerequisiteFocusCount, 1);
        assert.deepStrictEqual(focusTree.focuses.FOCUS_C.exclusive, []);
        assert.deepStrictEqual(focusTree.focuses.FOCUS_C.inAllowBranch, []);
        assert.strictEqual(focusTree.focuses.FOCUS_C.relativePositionId, undefined);
    });
});
