import * as assert from 'assert';
import {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    removeFocusFileFromIndex,
} from '../../src/util/sharedFocusIndexState';

describe('shared focus index helpers', () => {
    it('stores reverse focus id lookups per file', () => {
        const index = createEmptyFocusIndexState();

        applyFocusFileToIndex(index, 'common/national_focus/a.txt', ['FOCUS_A', 'FOCUS_B']);

        assert.deepStrictEqual(index.byFile['common/national_focus/a.txt'], ['FOCUS_A', 'FOCUS_B']);
        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_A'), 'common/national_focus/a.txt');
        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_B'), 'common/national_focus/a.txt');
    });

    it('replaces previous file entries without leaving stale reverse mappings behind', () => {
        const index = createEmptyFocusIndexState();

        applyFocusFileToIndex(index, 'common/national_focus/a.txt', ['FOCUS_A', 'FOCUS_B']);
        applyFocusFileToIndex(index, 'common/national_focus/a.txt', ['FOCUS_B', 'FOCUS_C']);

        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_A'), undefined);
        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_B'), 'common/national_focus/a.txt');
        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_C'), 'common/national_focus/a.txt');
    });

    it('keeps other files visible when one file is removed from a shared id', () => {
        const index = createEmptyFocusIndexState();

        applyFocusFileToIndex(index, 'common/national_focus/a.txt', ['FOCUS_SHARED']);
        applyFocusFileToIndex(index, 'common/national_focus/b.txt', ['FOCUS_SHARED']);
        removeFocusFileFromIndex(index, 'common/national_focus/a.txt');

        assert.strictEqual(findFileByFocusKeyInIndex(index, 'FOCUS_SHARED'), 'common/national_focus/b.txt');
        assert.strictEqual(index.byFile['common/national_focus/a.txt'], undefined);
    });
});
