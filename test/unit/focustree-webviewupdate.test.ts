import * as assert from 'assert';
import { getFocusTreeContentUpdateDecision } from '../../src/previewdef/focustree/webviewupdate';

describe('focustree webview update decisions', () => {
    const createTree = (overrides?: any) => ({
        id: 'tree_a',
        allowBranchOptions: [],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [],
        focuses: {
            FOCUS_A: {
                id: 'FOCUS_A',
                x: 0,
                y: 0,
                icon: [{ icon: 'GFX_goal_generic_construct_civ_factory', condition: { _type: 'and', items: [] } }],
                prerequisite: [],
                exclusive: [],
                inAllowBranch: [],
                allowBranch: undefined,
                relativePositionId: undefined,
                offset: [],
                token: { start: 1, end: 2 },
                file: 'common/national_focus/test.txt',
                isInCurrentFile: true,
                layoutEditKey: 'layout-key',
                layout: { editable: true, sourceFile: 'common/national_focus/test.txt' },
                lintWarningCount: 0,
                lintInfoCount: 0,
            },
        },
        inlayWindows: [],
        ...overrides,
    });

    it('skips all content work when only another tree changed', () => {
        const currentTree = createTree();
        const result = getFocusTreeContentUpdateDecision(currentTree as any, currentTree as any, {
            mode: 'patch',
            focusTreePatches: [{ treeId: 'tree_b', tree: { id: 'tree_b' } as any }],
            renderedFocusPatch: { FOCUS_B: '<div>B</div>' },
        });

        assert.deepStrictEqual(result, {
            shouldRefreshSelectedTreeUi: false,
            shouldRebuildContent: false,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        });
    });

    it('keeps the current DOM when only selected-tree warnings changed', () => {
        const previousTree = createTree();
        const nextTree = createTree({
            warnings: [{
                severity: 'warning',
                code: 'warn',
                kind: 'lint',
                source: 'focus',
                text: 'Changed warning',
            }],
        });

        const result = getFocusTreeContentUpdateDecision(previousTree as any, nextTree as any, {
            mode: 'patch',
            focusTreePatches: [{ treeId: 'tree_a', tree: nextTree as any }],
        });

        assert.deepStrictEqual(result, {
            shouldRefreshSelectedTreeUi: true,
            shouldRebuildContent: false,
            shouldApplyIncrementalUpdate: true,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        });
    });

    it('falls back to a full rebuild when focus grid structure changes', () => {
        const previousTree = createTree();
        const nextTree = createTree({
            focuses: {
                FOCUS_A: {
                    ...previousTree.focuses.FOCUS_A,
                    prerequisite: [['FOCUS_B']],
                },
            },
        });

        const result = getFocusTreeContentUpdateDecision(previousTree as any, nextTree as any, {
            mode: 'patch',
            focusTreePatches: [{ treeId: 'tree_a', tree: nextTree as any }],
        });

        assert.deepStrictEqual(result, {
            shouldRefreshSelectedTreeUi: true,
            shouldRebuildContent: true,
            shouldApplyIncrementalUpdate: false,
            changedCurrentTreeFocusIds: [],
            shouldRefreshCurrentTreeInlay: false,
        });
    });

    it('allows incremental focus html updates when only rendered focus markup changed', () => {
        const currentTree = createTree();
        const result = getFocusTreeContentUpdateDecision(currentTree as any, currentTree as any, {
            mode: 'patch',
            renderedFocusPatch: {
                FOCUS_A: '<div>updated</div>',
            },
        });

        assert.deepStrictEqual(result, {
            shouldRefreshSelectedTreeUi: false,
            shouldRebuildContent: false,
            shouldApplyIncrementalUpdate: true,
            changedCurrentTreeFocusIds: ['FOCUS_A'],
            shouldRefreshCurrentTreeInlay: false,
        });
    });
});
