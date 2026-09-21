import * as assert from 'assert';
import { collectCompletedFocusIds, isSelectableFocusTreeConditionExpr } from '../../src/previewdef/focustree/conditionexprs';

describe('focus tree condition expression helpers', () => {
    it('collects completed focus ids from root-scope expressions only', () => {
        const result = collectCompletedFocusIds([
            { scopeName: '', nodeContent: 'has_completed_focus = ROOT_FOCUS' },
            { scopeName: 'FROM', nodeContent: 'has_completed_focus = IGNORED_SCOPED' },
            { scopeName: '', nodeContent: 'has_focus_tree = test_tree' },
            { scopeName: '', nodeContent: 'has_completed_focus = ROOT_FOCUS' },
            { scopeName: '', nodeContent: 'has_completed_focus = SECOND_FOCUS ' },
        ]);

        assert.deepStrictEqual(Array.from(result), ['ROOT_FOCUS', 'SECOND_FOCUS']);
    });

    it('exposes target focus-tree conditions for standalone shared and joint previews only', () => {
        const targetTreeCondition = { scopeName: '', nodeContent: 'has_focus_tree = DNV_focus_tree' };

        assert.strictEqual(isSelectableFocusTreeConditionExpr('focus', targetTreeCondition), false);
        assert.strictEqual(isSelectableFocusTreeConditionExpr('shared', targetTreeCondition), true);
        assert.strictEqual(isSelectableFocusTreeConditionExpr('joint', targetTreeCondition), true);
        assert.strictEqual(isSelectableFocusTreeConditionExpr('joint', {
            scopeName: '',
            nodeContent: 'has_completed_focus = DNV_root',
        }), false);
    });
});
