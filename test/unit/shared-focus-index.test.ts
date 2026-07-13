import * as assert from 'assert';
import {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    findFileByFocusKeyInLayeredIndexes,
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

    it('resolves workspace, DLC, and base-game indexes in layer order', () => {
        const workspaceIndex = createEmptyFocusIndexState();
        const dlcIndex = createEmptyFocusIndexState();
        const baseIndex = createEmptyFocusIndexState();
        applyFocusFileToIndex(baseIndex, 'common/national_focus/base.txt', ['BASE_ONLY', 'SHARED']);
        applyFocusFileToIndex(dlcIndex, 'common/national_focus/dlc.txt', ['DLC_ONLY', 'SHARED']);
        applyFocusFileToIndex(workspaceIndex, 'common/national_focus/mod.txt', ['SHARED']);

        assert.strictEqual(
            findFileByFocusKeyInLayeredIndexes([workspaceIndex, dlcIndex, baseIndex], 'SHARED'),
            'common/national_focus/mod.txt',
        );
        assert.strictEqual(
            findFileByFocusKeyInLayeredIndexes([workspaceIndex, dlcIndex, baseIndex], 'DLC_ONLY'),
            'common/national_focus/dlc.txt',
        );
        assert.strictEqual(
            findFileByFocusKeyInLayeredIndexes([workspaceIndex, dlcIndex, baseIndex], 'BASE_ONLY'),
            'common/national_focus/base.txt',
        );
    });
});
