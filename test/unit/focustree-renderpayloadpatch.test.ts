import * as assert from 'assert';
import {
    createFocusTreeRenderPatch,
    createFocusTreeRenderStateSnapshot,
} from '../../src/previewdef/focustree/renderpayloadpatch';

describe('focus tree render payload patching', () => {
    const createTree = (treeId: string, focusId: string) => ({
        id: treeId,
        kind: 'focus',
        allowBranchOptions: [],
        conditionExprs: [],
        isSharedFocues: false,
        continuousFocusPositionX: undefined,
        continuousFocusPositionY: undefined,
        createTemplate: undefined,
        continuousLayout: undefined,
        inlayWindowRefs: [],
        inlayWindows: [],
        warnings: [],
        focuses: {
            [focusId]: {
                id: focusId,
                layoutEditKey: focusId.toLowerCase(),
                x: 0,
                y: 0,
                icon: [{ icon: `GFX_${focusId}`, condition: { _type: 'and', items: [] } }],
                availableIfCapitulated: false,
                hasAiWillDo: false,
                hasCompletionReward: false,
                prerequisite: [],
                prerequisiteGroupCount: 0,
                prerequisiteFocusCount: 0,
                exclusive: [],
                exclusiveCount: 0,
                hasAllowBranch: false,
                inAllowBranch: [],
                offset: [],
                file: 'common/national_focus/test.txt',
                isInCurrentFile: true,
                lintWarningCount: 0,
                lintInfoCount: 0,
            },
        },
    });

    it('emits a patch when tree order is stable and only one tree or html fragment changed', () => {
        const previous = createFocusTreeRenderStateSnapshot({
            focusTrees: [
                createTree('tree_a', 'FOCUS_A'),
                createTree('tree_b', 'FOCUS_B'),
            ],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
                FOCUS_B: '<div>B old</div>',
            },
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 3,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const next = {
            focusTrees: [
                previous.focusTrees[0],
                {
                    ...previous.focusTrees[1],
                    warnings: [{ code: 'changed' }],
                    focuses: {
                        FOCUS_B: {
                            ...previous.focusTrees[1].focuses.FOCUS_B,
                            file: 'common/national_focus/other.txt',
                        },
                    },
                },
            ],
            focusPositionDocumentVersion: 4,
            focusById: {
                FOCUS_A: previous.focusTrees[0].focuses.FOCUS_A,
                FOCUS_B: {
                    ...previous.focusTrees[1].focuses.FOCUS_B,
                    file: 'common/national_focus/other.txt',
                },
            },
            allFocuses: [
                previous.focusTrees[0].focuses.FOCUS_A,
                {
                    ...previous.focusTrees[1].focuses.FOCUS_B,
                    file: 'common/national_focus/other.txt',
                },
            ],
            allInlays: [],
            gfxFiles: [],
            gridBox: previous.gridBox,
            xGridSize: 96,
            yGridSize: 130,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: false,
            loadDurationMs: 1,
        } as any;

        const result = createFocusTreeRenderPatch(previous, next);

        assert.strictEqual(result.mode, 'patch');
        assert.deepStrictEqual(result.patch.focusTreePatches?.map(patch => patch.treeId), ['tree_b']);
        assert.strictEqual(result.patch.structurallyChangedTreeIds, undefined);
        assert.match(result.patch.renderedFocusPatch?.FOCUS_B ?? '', /common\/national_focus\/other\.txt/);
        assert.strictEqual(result.patch.documentVersion, 4);
        assert.strictEqual(result.patch.dynamicStyleCss, '.a {}');
    });

    it('marks structural tree changes so the webview can rebuild only the affected selection', () => {
        const previous = createFocusTreeRenderStateSnapshot({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
            },
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const nextFocus = {
            ...previous.focusTrees[0].focuses.FOCUS_A,
            prerequisite: [['FOCUS_B']],
        };
        const nextTree = {
            ...previous.focusTrees[0],
            focuses: {
                FOCUS_A: nextFocus,
            },
        };
        const result = createFocusTreeRenderPatch(previous, {
            focusTrees: [nextTree],
            focusById: { FOCUS_A: nextFocus },
            allFocuses: [nextFocus],
            allInlays: [],
            gfxFiles: [],
            gridBox: previous.gridBox,
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 2,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
        } as any);

        assert.strictEqual(result.mode, 'patch');
        assert.deepStrictEqual(result.patch.structurallyChangedTreeIds, ['tree_a']);
    });

    it('falls back to a full payload when tree order changes', () => {
        const previous = createFocusTreeRenderStateSnapshot({
            focusTrees: [createTree('tree_a', 'FOCUS_A'), createTree('tree_b', 'FOCUS_B')],
            renderedFocus: {},
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const next = {
            focusTrees: [createTree('tree_b', 'FOCUS_B'), createTree('tree_a', 'FOCUS_A')],
            focusPositionDocumentVersion: 2,
            focusById: {},
            allFocuses: [],
            allInlays: [],
            gfxFiles: [],
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: false,
            loadDurationMs: 1,
        } as any;

        const result = createFocusTreeRenderPatch(previous, next);

        assert.strictEqual(result.mode, 'full');
    });
});
