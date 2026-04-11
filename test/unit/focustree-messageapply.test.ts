import * as assert from 'assert';
import { applyFocusTreeContentUpdate } from '../../webviewsrc/focustree/messageapply';

describe('focustree message apply', () => {
    it('rejects stale snapshot or document updates before mutating state', () => {
        let selectorRefreshed = false;
        const result = applyFocusTreeContentUpdate({
            snapshotVersion: 2,
            documentVersion: 3,
            changedSlots: ['selector'],
        }, {
            getSnapshotVersion: () => 3,
            setSnapshotVersion: () => {
                throw new Error('should not update snapshot version');
            },
            getDocumentVersion: () => 4,
            setDocumentVersion: () => {
                throw new Error('should not update document version');
            },
            getCurrentSelectionTreeId: () => undefined,
            setSelectedFocusTreeById: () => {
                throw new Error('should not change selected tree');
            },
            setFocusTrees: () => {
                throw new Error('should not update trees');
            },
            applyFocusTreePatches: () => {
                throw new Error('should not patch trees');
            },
            setRenderedFocus: () => undefined,
            patchRenderedFocus: () => undefined,
            setRenderedInlayWindows: () => undefined,
            patchRenderedInlayWindows: () => undefined,
            refreshFocusTreeSelectorOptions: () => {
                selectorRefreshed = true;
            },
            refreshWarningsButtonVisibility: () => undefined,
            setGridBox: () => undefined,
            setGridSizeX: () => undefined,
            setGridSizeY: () => undefined,
            replaceDynamicStyleCss: () => undefined,
        });

        assert.strictEqual(result, false);
        assert.strictEqual(selectorRefreshed, false);
    });

    it('applies changed slots through the supplied callbacks', () => {
        const applied: Record<string, unknown> = {};
        const result = applyFocusTreeContentUpdate({
            snapshotVersion: 6,
            documentVersion: 9,
            changedSlots: ['treeDefinitions', 'treeBody', 'selector', 'warnings', 'layout', 'styleDeps'],
            focusTrees: [{ id: 'tree_b', focuses: {}, warnings: [], inlayWindows: [] } as any],
            renderedFocus: { FOCUS_A: '<div>A</div>' },
            gridBox: { position: { x: 10, y: 20 } },
            xGridSize: 120,
            yGridSize: 144,
            dynamicStyleCss: '.focus { opacity: 1; }',
            selectedTreeId: 'tree_b',
        }, {
            getSnapshotVersion: () => 4,
            setSnapshotVersion: snapshotVersion => {
                applied.snapshotVersion = snapshotVersion;
            },
            getDocumentVersion: () => 7,
            setDocumentVersion: documentVersion => {
                applied.documentVersion = documentVersion;
            },
            getCurrentSelectionTreeId: () => 'tree_a',
            setSelectedFocusTreeById: treeId => {
                applied.selectedTreeId = treeId;
            },
            setFocusTrees: focusTrees => {
                applied.focusTrees = focusTrees;
            },
            applyFocusTreePatches: () => {
                throw new Error('should prefer full tree replacement when focusTrees are present');
            },
            setRenderedFocus: renderedFocus => {
                applied.renderedFocus = renderedFocus;
            },
            patchRenderedFocus: () => {
                throw new Error('should not patch rendered focus when full map is present');
            },
            setRenderedInlayWindows: () => undefined,
            patchRenderedInlayWindows: () => undefined,
            refreshFocusTreeSelectorOptions: () => {
                applied.selectorRefreshed = true;
            },
            refreshWarningsButtonVisibility: () => {
                applied.warningsRefreshed = true;
            },
            setGridBox: gridBox => {
                applied.gridBox = gridBox;
            },
            setGridSizeX: xGridSize => {
                applied.xGridSize = xGridSize;
            },
            setGridSizeY: yGridSize => {
                applied.yGridSize = yGridSize;
            },
            replaceDynamicStyleCss: dynamicStyleCss => {
                applied.dynamicStyleCss = dynamicStyleCss;
            },
        });

        assert.strictEqual(result, true);
        assert.deepStrictEqual(applied.focusTrees, [{ id: 'tree_b', focuses: {}, warnings: [], inlayWindows: [] }]);
        assert.deepStrictEqual(applied.renderedFocus, { FOCUS_A: '<div>A</div>' });
        assert.deepStrictEqual(applied.gridBox, { position: { x: 10, y: 20 } });
        assert.strictEqual(applied.xGridSize, 120);
        assert.strictEqual(applied.yGridSize, 144);
        assert.strictEqual(applied.selectedTreeId, 'tree_b');
        assert.strictEqual(applied.selectorRefreshed, true);
        assert.strictEqual(applied.warningsRefreshed, true);
        assert.strictEqual(applied.dynamicStyleCss, '.focus { opacity: 1; }');
        assert.strictEqual(applied.snapshotVersion, 6);
        assert.strictEqual(applied.documentVersion, 9);
    });

    it('falls back to the host-selected tree when the restored selection id no longer exists in a full tree update', () => {
        let selectedTreeId: string | undefined;
        const result = applyFocusTreeContentUpdate({
            snapshotVersion: 2,
            documentVersion: 3,
            changedSlots: ['treeDefinitions'],
            selectedTreeId: 'tree_beta',
            focusTrees: [
                { id: 'tree_alpha', focuses: {}, warnings: [], inlayWindows: [] } as any,
                { id: 'tree_beta', focuses: {}, warnings: [], inlayWindows: [] } as any,
            ],
        }, {
            getSnapshotVersion: () => 1,
            setSnapshotVersion: () => undefined,
            getDocumentVersion: () => 1,
            setDocumentVersion: () => undefined,
            getCurrentSelectionTreeId: () => 'missing_tree',
            setSelectedFocusTreeById: treeId => {
                selectedTreeId = treeId;
            },
            setFocusTrees: () => undefined,
            applyFocusTreePatches: () => undefined,
            setRenderedFocus: () => undefined,
            patchRenderedFocus: () => undefined,
            setRenderedInlayWindows: () => undefined,
            patchRenderedInlayWindows: () => undefined,
            refreshFocusTreeSelectorOptions: () => undefined,
            refreshWarningsButtonVisibility: () => undefined,
            setGridBox: () => undefined,
            setGridSizeX: () => undefined,
            setGridSizeY: () => undefined,
            replaceDynamicStyleCss: () => undefined,
        });

        assert.strictEqual(result, true);
        assert.strictEqual(selectedTreeId, 'tree_beta');
    });
});
