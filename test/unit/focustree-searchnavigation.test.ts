import * as assert from 'assert';
import {
    createFocusSearchScene,
    FocusSearchNavigator,
    matchFocusSearch,
} from '../../webviewsrc/focustree/searchnavigation';

/**
 * A retained scene like `FocusScene`: every laid-out node is known, but only some cards are
 * mounted, the way the first 120 nodes are before frame-budgeted work mounts the rest.
 */
function createScene(options: { laidOut: string[]; mounted: string[]; branchClassById?: Record<string, string> }) {
    const mounted = new Set(options.mounted);
    const hiddenBranches = new Set<string>();
    const events: string[] = [];
    const source = {
        isFocusShown: (focusId: string, isHiddenBranchClass: (className: string) => boolean) => {
            const branchClass = options.branchClassById?.[focusId];
            return options.laidOut.includes(focusId) && !(branchClass && isHiddenBranchClass(branchClass));
        },
        ensureMounted: (focusIds: readonly string[]) => {
            focusIds.filter(focusId => !mounted.has(focusId)).forEach(focusId => {
                mounted.add(focusId);
                events.push(`mount:${focusId}`);
            });
        },
        getWrapper: (focusId: string) => mounted.has(focusId)
            ? { scrollIntoView: () => { events.push(`scroll:${focusId}`); } }
            : undefined,
    };
    const scene = createFocusSearchScene(source, className => hiddenBranches.has(className));
    return { scene, events, mounted, hiddenBranches };
}

describe('focus tree search navigation', () => {
    const searchText = {
        GNG_a_bank: 'gng_a_bank bank of canton',
        GNG_b_bank: 'gng_b_bank the second bank',
        GNG_c_other: 'gng_c_other nothing here',
        GNG_d_bank: 'gng_d_bank bank run',
        GNG_e_bank: 'gng_e_bank bank holiday',
    };

    it('matches ids and display names in focus order, ignoring case and surrounding spaces', () => {
        assert.deepStrictEqual([...matchFocusSearch(searchText, '  BANK ')], ['GNG_a_bank', 'GNG_b_bank', 'GNG_d_bank', 'GNG_e_bank']);
        assert.deepStrictEqual([...matchFocusSearch(searchText, 'canton')], ['GNG_a_bank']);
        assert.deepStrictEqual([...matchFocusSearch(searchText, '   ')], []);
    });

    it('walks matches whose cards are mounted later, mounting each before scrolling to it', () => {
        const { scene, events } = createScene({ laidOut: Object.keys(searchText), mounted: ['GNG_a_bank'] });
        const navigator = new FocusSearchNavigator(scene);
        navigator.setResults(matchFocusSearch(searchText, 'bank'), false);

        const visited = [1, 2, 3, 4, 5].map(() => navigator.step(false));
        assert.deepStrictEqual(visited, ['GNG_a_bank', 'GNG_b_bank', 'GNG_d_bank', 'GNG_e_bank', 'GNG_a_bank'],
            'Enter wraps around every match, not only the initially mounted one');
        assert.deepStrictEqual(events.slice(0, 4), ['scroll:GNG_a_bank', 'mount:GNG_b_bank', 'scroll:GNG_b_bank', 'mount:GNG_d_bank']);
        assert.ok(events.every((event, index) => !event.startsWith('scroll:')
            || events.slice(0, index).includes(`mount:${event.slice('scroll:'.length)}`) || event === 'scroll:GNG_a_bank'));
        assert.deepStrictEqual(navigator.getPosition(), { current: 1, total: 4 });
    });

    it('keeps walking every match of a query restored after a rebuild', () => {
        // The rebuild mounted nothing but the anchor yet; the restored query must reach all ids.
        const { scene } = createScene({ laidOut: Object.keys(searchText), mounted: [] });
        const navigator = new FocusSearchNavigator(scene);
        navigator.setResults(matchFocusSearch(searchText, 'bank'), false);
        assert.deepStrictEqual(navigator.getPosition(), { current: undefined, total: 4 }, 'a restored query does not jump');
        assert.strictEqual(navigator.step(false), 'GNG_a_bank');

        // A later rebuild with the same matches keeps the current one.
        navigator.setResults(matchFocusSearch(searchText, 'bank'), false);
        assert.strictEqual(navigator.current, 'GNG_a_bank');
        assert.strictEqual(navigator.step(false), 'GNG_b_bank');
    });

    it('moves backwards with Shift+Enter, starting from the last match', () => {
        const { scene } = createScene({ laidOut: Object.keys(searchText), mounted: Object.keys(searchText) });
        const navigator = new FocusSearchNavigator(scene);
        navigator.setResults(matchFocusSearch(searchText, 'bank'), false);
        assert.strictEqual(navigator.step(true), 'GNG_e_bank', 'the first Shift+Enter lands on the last match');
        assert.strictEqual(navigator.step(true), 'GNG_d_bank');
        assert.strictEqual(navigator.step(false), 'GNG_e_bank');
        assert.strictEqual(navigator.step(false), 'GNG_a_bank', 'Enter wraps forwards');
        assert.strictEqual(navigator.step(true), 'GNG_e_bank', 'Shift+Enter wraps backwards');
    });

    it('skips matches that conditions or hidden branches keep off the scene', () => {
        const { scene, hiddenBranches, events } = createScene({
            // GNG_b_bank is not laid out under the selected conditions.
            laidOut: ['GNG_a_bank', 'GNG_c_other', 'GNG_d_bank', 'GNG_e_bank'],
            mounted: [],
            branchClassById: { GNG_d_bank: 'inbranch_GNG_d_bank' },
        });
        const navigator = new FocusSearchNavigator(scene);
        hiddenBranches.add('inbranch_GNG_d_bank');
        navigator.setResults(matchFocusSearch(searchText, 'bank'), false);
        assert.deepStrictEqual(navigator.getShownResultIds(), ['GNG_a_bank', 'GNG_e_bank']);
        assert.deepStrictEqual([navigator.step(false), navigator.step(false), navigator.step(false)],
            ['GNG_a_bank', 'GNG_e_bank', 'GNG_a_bank']);
        assert.ok(!events.some(event => event.endsWith('GNG_b_bank') || event.endsWith('GNG_d_bank')), 'hidden matches are never mounted');

        // Showing the branch again makes its match reachable; hiding the current match drops it.
        hiddenBranches.delete('inbranch_GNG_d_bank');
        navigator.refresh();
        assert.deepStrictEqual(navigator.getPosition(), { current: 1, total: 3 });
        assert.strictEqual(navigator.step(false), 'GNG_d_bank');
        hiddenBranches.add('inbranch_GNG_d_bank');
        navigator.refresh();
        assert.strictEqual(navigator.current, undefined);
        assert.deepStrictEqual(navigator.getPosition(), { current: undefined, total: 2 });
    });

    it('moves to the first shown match when typing, and when opening without a current match', () => {
        const { scene, events } = createScene({ laidOut: ['GNG_b_bank', 'GNG_d_bank'], mounted: [] });
        const navigator = new FocusSearchNavigator(scene);
        navigator.setResults(matchFocusSearch(searchText, 'bank'), true);
        assert.strictEqual(navigator.current, 'GNG_b_bank', 'typing skips the match the conditions hide');
        assert.deepStrictEqual(events, ['mount:GNG_b_bank', 'scroll:GNG_b_bank']);

        navigator.setResults(matchFocusSearch(searchText, 'nothing'), false);
        assert.strictEqual(navigator.current, undefined, 'a match of another query is not current');
        assert.deepStrictEqual(navigator.getPosition(), { current: undefined, total: 0 });
        navigator.setResults(matchFocusSearch(searchText, 'bank run'), false);
        assert.strictEqual(navigator.ensureCurrent(), 'GNG_d_bank');
        assert.strictEqual(navigator.step(false), 'GNG_d_bank');
    });
});
