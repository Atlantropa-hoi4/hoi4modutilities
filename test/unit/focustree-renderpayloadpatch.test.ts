import * as assert from 'assert';
import { createFocusTreeRenderPatch } from '../../src/previewdef/focustree/renderpayloadpatch';

describe('focus tree render payload patching', () => {
    it('emits a patch when tree order is stable and only one tree or html fragment changed', () => {
        const previous = {
            focusTrees: [
                { id: 'tree_a', warnings: [], focuses: { FOCUS_A: { id: 'FOCUS_A' } } },
                { id: 'tree_b', warnings: [], focuses: { FOCUS_B: { id: 'FOCUS_B' } } },
            ],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
                FOCUS_B: '<div>B old</div>',
            },
            renderedInlayWindows: {
                inlay_a: '<div>old</div>',
            },
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 3,
            hasFocusSelector: true,
            hasWarningsButton: false,
        } as any;

        const next = {
            ...previous,
            focusTrees: [
                previous.focusTrees[0],
                { id: 'tree_b', warnings: [{ code: 'changed' }], focuses: { FOCUS_B: { id: 'FOCUS_B' } } },
            ],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
                FOCUS_B: '<div>B new</div>',
            },
            renderedInlayWindows: {},
            dynamicStyleCss: '.b {}',
            focusPositionDocumentVersion: 4,
        } as any;

        const result = createFocusTreeRenderPatch(previous, next);

        assert.strictEqual(result.mode, 'patch');
        assert.deepStrictEqual(result.focusTreePatches?.map(patch => patch.treeId), ['tree_b']);
        assert.deepStrictEqual(result.renderedFocusPatch, {
            FOCUS_B: '<div>B new</div>',
        });
        assert.deepStrictEqual(result.removedRenderedInlayWindowIds, ['inlay_a']);
        assert.strictEqual(result.documentVersion, 4);
        assert.strictEqual(result.dynamicStyleCss, '.b {}');
    });

    it('falls back to a full payload when tree order changes', () => {
        const previous = {
            focusTrees: [{ id: 'tree_a' }, { id: 'tree_b' }],
            renderedFocus: {},
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            hasFocusSelector: true,
            hasWarningsButton: false,
        } as any;

        const next = {
            ...previous,
            focusTrees: [{ id: 'tree_b' }, { id: 'tree_a' }],
            focusPositionDocumentVersion: 2,
        } as any;

        const result = createFocusTreeRenderPatch(previous, next);

        assert.strictEqual(result.mode, 'full');
        assert.strictEqual(result.focusTrees, next.focusTrees);
        assert.strictEqual(result.renderedFocus, next.renderedFocus);
        assert.strictEqual(result.documentVersion, 2);
    });
});
