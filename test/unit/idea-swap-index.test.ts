import * as assert from 'assert';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return { env: { language: 'en' }, l10n: { bundle: {}, t: (message: string) => message }, workspace: { getConfiguration: () => ({ featureFlags: [] }) } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { extractIdeaSwaps } = require('../../src/util/ideaSwapIndex') as typeof import('../../src/util/ideaSwapIndex');

describe('idea swap index extraction', () => {
    it('finds deeply nested swaps and preserves source positions', () => {
        const source = `focus_tree = { focus = { completion_reward = {
            swap_ideas = { remove_idea = first add_idea = second }
        } } }`;
        const swaps = extractIdeaSwaps(parseHoi4File(source));
        assert.deepStrictEqual(swaps.map(item => [item.from, item.to]), [['first', 'second']]);
        assert.strictEqual(source.slice(swaps[0].start, swaps[0].start + 10), 'swap_ideas');
        assert.ok(swaps[0].end > swaps[0].start);
    });

    it('pairs equal remove/add counts in source order', () => {
        const swaps = extractIdeaSwaps(parseHoi4File(`swap_ideas = {
            remove_idea = a1 remove_idea = a2 add_idea = b1 add_idea = b2
        }`));
        assert.deepStrictEqual(swaps.map(item => [item.from, item.to]), [['a1', 'b1'], ['a2', 'b2']]);
    });

    it('keeps every combination when counts differ', () => {
        const swaps = extractIdeaSwaps(parseHoi4File(
            'swap_ideas = { remove_idea = a add_idea = b1 add_idea = b2 }',
        ));
        assert.deepStrictEqual(swaps.map(item => [item.from, item.to]), [['a', 'b1'], ['a', 'b2']]);
    });
});
