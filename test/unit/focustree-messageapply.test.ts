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
            setFocusPositionActiveFile: () => {
                throw new Error('should not update active file');
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
            setFocusTemplates: () => undefined,
            patchFocusTemplates: () => undefined,
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
            focusPositionActiveFile: 'common/national_focus/test.txt',
            changedSlots: ['treeDefinitions', 'treeBody', 'selector', 'warnings', 'layout', 'styleDeps'],
            focusTrees: [{ id: 'tree_b', focuses: {}, warnings: [], inlayWindows: [] } as any],
            focusTemplates: { card: '<div>A</div>' },
            focusTemplateKeyById: { FOCUS_A: 'card' },
            gridBox: { position: { x: 10, y: 20 } },
            xGridSize: 120,
            yGridSize: 144,
            dynamicStyleCss: '.focus { opacity: 1; }',
            selectedTreeId: 'tree_b',
            perf: {
                source: 'initialize',
                assetLoadMode: 'deferred',
                updateKind: 'full',
                changedSlotCount: 6,
                payloadBytes: 1024,
                patchPlanDurationMs: 1,
                snapshotBuildDurationMs: 2,
            },
        }, {
            getSnapshotVersion: () => 4,
            setSnapshotVersion: snapshotVersion => {
                applied.snapshotVersion = snapshotVersion;
            },
            getDocumentVersion: () => 7,
            setDocumentVersion: documentVersion => {
                applied.documentVersion = documentVersion;
            },
            setFocusPositionActiveFile: focusPositionActiveFile => {
                applied.focusPositionActiveFile = focusPositionActiveFile;
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
            setFocusTemplates: (templates, keyById) => {
                applied.focusTemplates = [templates, keyById];
            },
            patchFocusTemplates: () => {
                throw new Error('should not patch focus templates when full maps are present');
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
        assert.deepStrictEqual(applied.focusTemplates, [{ card: '<div>A</div>' }, { FOCUS_A: 'card' }]);
        assert.deepStrictEqual(applied.gridBox, { position: { x: 10, y: 20 } });
        assert.strictEqual(applied.xGridSize, 120);
        assert.strictEqual(applied.yGridSize, 144);
        assert.strictEqual(applied.selectedTreeId, 'tree_b');
        assert.strictEqual(applied.selectorRefreshed, true);
        assert.strictEqual(applied.warningsRefreshed, true);
        assert.strictEqual(applied.dynamicStyleCss, '.focus { opacity: 1; }');
        assert.strictEqual(applied.snapshotVersion, 6);
        assert.strictEqual(applied.documentVersion, 9);
        assert.strictEqual(applied.focusPositionActiveFile, 'common/national_focus/test.txt');
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
            setFocusPositionActiveFile: () => undefined,
            getCurrentSelectionTreeId: () => 'missing_tree',
            setSelectedFocusTreeById: treeId => {
                selectedTreeId = treeId;
            },
            setFocusTrees: () => undefined,
            applyFocusTreePatches: () => undefined,
            setFocusTemplates: () => undefined,
            patchFocusTemplates: () => undefined,
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

    describe('selection while catalog scenes are requested', () => {
        const tree = (id: string) => ({ id, focuses: {}, warnings: [], inlayWindows: [] } as any);
        const catalog = ['GNG_guangdong', 'GNG_yasuda_crisis_tree', 'GNG_morita_silicon_years']
            .map(id => ({ id, kind: 'focus', focusCount: 1, warningCount: 0 } as const));
        const applyScene = (
            selection: { rendered: string | undefined; requested: string | undefined },
            sceneTreeIds: string[],
            selectedTreeId: string,
            sceneCatalog: typeof catalog = catalog,
        ) => {
            const state = { ...selection };
            const result = applyFocusTreeContentUpdate({
                snapshotVersion: 5,
                documentVersion: 1,
                sceneMode: 'merge',
                changedSlots: ['treeDefinitions', 'selector'],
                selectedTreeId,
                catalog: sceneCatalog,
                focusTrees: sceneTreeIds.map(tree),
            }, {
                getSnapshotVersion: () => 4,
                setSnapshotVersion: () => undefined,
                getDocumentVersion: () => 1,
                setDocumentVersion: () => undefined,
                setFocusPositionActiveFile: () => undefined,
                getCurrentSelectionTreeId: () => state.rendered ?? state.requested,
                getRequestedSelectionTreeId: () => state.requested,
                setSelectedFocusTreeById: treeId => { state.requested = treeId; },
                setFocusTrees: () => undefined,
                applyFocusTreePatches: () => undefined,
                setFocusTemplates: () => undefined,
                patchFocusTemplates: () => undefined,
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
            return state.requested;
        };

        it('selects the requested tree although the previously rendered tree is in the merged scene', () => {
            // Index 1 is still rendered while the scene of the newly selected index 2 arrives.
            assert.strictEqual(applyScene(
                { rendered: 'GNG_yasuda_crisis_tree', requested: 'GNG_morita_silicon_years' },
                ['GNG_guangdong', 'GNG_yasuda_crisis_tree', 'GNG_morita_silicon_years'],
                'GNG_morita_silicon_years',
            ), 'GNG_morita_silicon_years');
        });

        it('keeps the latest of rapid requests selected while an earlier scene arrives', () => {
            const selection = { rendered: 'GNG_guangdong', requested: 'GNG_morita_silicon_years' };
            assert.strictEqual(applyScene(selection, ['GNG_guangdong', 'GNG_yasuda_crisis_tree'], 'GNG_yasuda_crisis_tree'),
                'GNG_morita_silicon_years', 'the yasuda answer must not revert the newer morita selection');
            assert.strictEqual(applyScene(selection, ['GNG_guangdong', 'GNG_yasuda_crisis_tree', 'GNG_morita_silicon_years'],
                'GNG_morita_silicon_years'), 'GNG_morita_silicon_years');
        });

        it('keeps a client-side return to a loaded tree while a requested scene arrives', () => {
            assert.strictEqual(applyScene(
                { rendered: 'GNG_guangdong', requested: 'GNG_guangdong' },
                ['GNG_guangdong', 'GNG_morita_silicon_years'],
                'GNG_morita_silicon_years',
            ), 'GNG_guangdong');
        });

        it('falls back to the host selection when the requested tree left the catalog', () => {
            assert.strictEqual(applyScene(
                { rendered: 'GNG_guangdong', requested: 'GNG_removed' },
                ['GNG_guangdong', 'GNG_morita_silicon_years'],
                'GNG_morita_silicon_years',
            ), 'GNG_morita_silicon_years');
        });
    });

    it('preserves the selected tree during partial tree patch updates', () => {
        let selectedTreeId: string | undefined;
        const result = applyFocusTreeContentUpdate({
            snapshotVersion: 3,
            documentVersion: 4,
            changedSlots: ['treeDefinitions'],
            selectedTreeId: 'tree_alpha',
            focusTreePatches: [
                { treeId: 'tree_beta', tree: { id: 'tree_beta', focuses: {}, warnings: [], inlayWindows: [] } as any },
            ],
        }, {
            getSnapshotVersion: () => 2,
            setSnapshotVersion: () => undefined,
            getDocumentVersion: () => 3,
            setDocumentVersion: () => undefined,
            setFocusPositionActiveFile: () => undefined,
            getCurrentSelectionTreeId: () => 'tree_beta',
            setSelectedFocusTreeById: treeId => {
                selectedTreeId = treeId;
            },
            setFocusTrees: () => {
                throw new Error('should patch trees instead of replacing them');
            },
            applyFocusTreePatches: () => undefined,
            setFocusTemplates: () => undefined,
            patchFocusTemplates: () => undefined,
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
