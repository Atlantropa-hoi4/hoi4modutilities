import * as assert from 'assert';
import { applyCondition, ConditionComplexExpr, extractConditionalExprs } from '../../src/hoiformat/condition';

describe('condition evaluation', () => {
    const tag = { scopeName: '', nodeContent: 'tag = GER' };
    const war = { scopeName: 'ROOT', nodeContent: 'has_war = yes' };

    it('matches leaves by scope and content', () => {
        const condition: ConditionComplexExpr = { type: 'and', items: [tag, { type: 'or', items: [war, false] }] };

        assert.strictEqual(applyCondition(condition, [{ ...tag }, { ...war }]), true);
        assert.strictEqual(applyCondition(condition, [{ ...tag }, { scopeName: '', nodeContent: 'has_war = yes' }]), false);
        assert.strictEqual(applyCondition({ type: 'count', amount: 2, items: [tag, war] }, [tag, war]), true);
        assert.strictEqual(applyCondition({ type: 'count', amount: 2, items: [tag, war] }, [tag]), false);
    });

    it('extracts each distinct leaf once in first-seen order', () => {
        const condition: ConditionComplexExpr = {
            type: 'or',
            items: [war, { type: 'and', items: [{ ...tag }, { ...war }, true] }, tag],
        };

        assert.deepStrictEqual(extractConditionalExprs(condition), [war, tag]);
        assert.deepStrictEqual(extractConditionalExprs(condition, [{ ...tag }]), [tag, war]);
    });
});
