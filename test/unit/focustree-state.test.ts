import * as assert from 'assert';
import { createFocusTreeWebviewInitialState } from '../../webviewsrc/focustree/state';

function withWindowState(windowState: Record<string, unknown>, callback: () => void) {
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = windowState;

    try {
        callback();
    } finally {
        if (previousWindow !== undefined) {
            (globalThis as any).window = previousWindow;
        } else {
            (globalThis as any).window = undefined;
        }
    }
}

function createFocusTrees() {
    return [
        { id: 'TFR_tree_KOR', focuses: { ROOT: { id: 'ROOT' } } },
        { id: 'empty_tree', focuses: {} },
    ];
}

describe('focustree webview initial state', () => {
    it('uses the bootstrap selected tree id and resolves the matching index', () => {
        withWindowState({
            previewedFileUri: 'file:///test/current.txt',
            bootstrapSelectedFocusTreeId: 'TFR_tree_KOR',
            focusTrees: createFocusTrees(),
        }, () => {
            const initialState = createFocusTreeWebviewInitialState(
                {
                    uri: 'file:///test/current.txt',
                    selectedFocusTreeIndex: 1,
                },
                {},
            );

            assert.strictEqual(initialState.selectedFocusTreeIndex, 0);
            assert.strictEqual(initialState.selectedFocusTreeId, 'TFR_tree_KOR');
        });
    });

    it('keeps a restored non-empty selected tree id for the same file', () => {
        withWindowState({
            previewedFileUri: 'file:///test/current.txt',
            bootstrapSelectedFocusTreeId: 'TFR_tree_KOR',
            focusTrees: createFocusTrees(),
        }, () => {
            const initialState = createFocusTreeWebviewInitialState(
                {
                    uri: 'file:///test/current.txt',
                    selectedFocusTreeIndex: 0,
                    selectedFocusTreeId: 'TFR_tree_KOR',
                },
                {},
            );

            assert.strictEqual(initialState.selectedFocusTreeIndex, 0);
            assert.strictEqual(initialState.selectedFocusTreeId, 'TFR_tree_KOR');
        });
    });

    it('drops restored tree state when it belongs to a different file', () => {
        withWindowState({
            previewedFileUri: 'file:///test/current.txt',
            bootstrapSelectedFocusTreeId: 'TFR_tree_KOR',
            focusTrees: createFocusTrees(),
        }, () => {
            const initialState = createFocusTreeWebviewInitialState(
                {
                    uri: 'file:///test/other.txt',
                    selectedExprs: [{ scopeName: '', nodeContent: 'foo = yes' }],
                    selectedFocusTreeIndex: 1,
                    selectedFocusTreeId: 'empty_tree',
                    selectedFocusIdsByTree: { empty_tree: ['ROOT'] },
                    focusPositionEditMode: true,
                    searchboxValue: 'stale',
                },
                {},
            );

            assert.deepStrictEqual(initialState.selectedExprs, []);
            assert.deepStrictEqual(initialState.selectedFocusIdsByTree, {});
            assert.strictEqual(initialState.selectedFocusTreeIndex, 0);
            assert.strictEqual(initialState.selectedFocusTreeId, 'TFR_tree_KOR');
            assert.strictEqual(initialState.focusPositionEditMode, false);
            assert.strictEqual(initialState.searchboxValue, '');
        });
    });

    it('falls back to the first non-empty tree when the restored tree is empty', () => {
        withWindowState({
            previewedFileUri: 'file:///test/current.txt',
            focusTrees: createFocusTrees(),
        }, () => {
            const initialState = createFocusTreeWebviewInitialState(
                {
                    uri: 'file:///test/current.txt',
                    selectedFocusTreeIndex: 1,
                    selectedFocusTreeId: 'empty_tree',
                },
                {},
            );

            assert.strictEqual(initialState.selectedFocusTreeIndex, 0);
            assert.strictEqual(initialState.selectedFocusTreeId, 'TFR_tree_KOR');
        });
    });
});
