import * as assert from 'assert';
import {
    createFullFocusTreeRenderUpdate,
    createFocusTreeRenderCache,
    createFocusTreeRenderUpdate,
} from '../../src/previewdef/focustree/renderpayloadpatch';
import { getPerfSnapshot, resetPerfMetrics } from '../../src/util/perf';

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

    it('uses a full update when the localisation index becomes ready', async () => {
        const focusTree = createTree('tree_a', 'FOCUS_A');
        const previous = createFocusTreeRenderCache({
            focusTrees: [focusTree],
            renderedFocus: { FOCUS_A: '<div>FOCUS_A</div>' },
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
            deferredAssetLoad: false,
            localisationIndexReady: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const result = await createFocusTreeRenderUpdate(previous, {
            focusTrees: [focusTree],
            focusById: focusTree.focuses,
            allFocuses: Object.values(focusTree.focuses),
            allInlays: [],
            gfxFiles: [],
            gridBox: previous.gridBox,
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: false,
            localisationIndexReady: true,
        } as any);

        assert.strictEqual(result.kind, 'full');
    });

    it('emits a slot-based partial update when tree order is stable and one tree changed', async () => {
        const previous = createFocusTreeRenderCache({
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

        const result = await createFocusTreeRenderUpdate(previous, next);

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }

        assert.deepStrictEqual(result.update.focusTreePatches?.map(patch => patch.treeId), ['tree_b']);
        assert.deepStrictEqual(result.update.changedTreeIds, ['tree_b']);
        assert.strictEqual(result.update.structurallyChangedTreeIds, undefined);
        assert.match(result.update.renderedFocusPatch?.FOCUS_B ?? '', /common\/national_focus\/other\.txt/);
        assert.strictEqual(result.update.documentVersion, 4);
        assert.strictEqual(result.update.focusPositionActiveFile, 'common/national_focus/test.txt');
        assert.deepStrictEqual(result.update.changedSlots, ['treeDefinitions', 'selector', 'warnings', 'treeBody']);
        assert.strictEqual(result.update.snapshotVersion, previous.snapshotVersion + 1);
    });

    it('marks structural tree changes so the webview can rebuild only the affected selection', async () => {
        const previous = createFocusTreeRenderCache({
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
        const result = await createFocusTreeRenderUpdate(previous, {
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

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }

        assert.strictEqual(result.update.focusPositionActiveFile, 'common/national_focus/test.txt');
        assert.deepStrictEqual(result.update.structurallyChangedTreeIds, ['tree_a']);
        assert.deepStrictEqual(result.update.changedSlots, ['treeDefinitions', 'selector', 'warnings']);
    });

    it('falls back to a full snapshot when tree order changes', async () => {
        const previous = createFocusTreeRenderCache({
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

        const result = await createFocusTreeRenderUpdate(previous, next);

        assert.strictEqual(result.kind, 'full');
    });

    it('falls back to a full snapshot when icon asset dependencies change', async () => {
        const previous = createFocusTreeRenderCache({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
            },
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            gfxFiles: ['interface/old.gfx'],
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const result = await createFocusTreeRenderUpdate(previous, {
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            focusById: {
                FOCUS_A: createTree('tree_a', 'FOCUS_A').focuses.FOCUS_A,
            },
            allFocuses: [
                createTree('tree_a', 'FOCUS_A').focuses.FOCUS_A,
            ],
            allInlays: [],
            gfxFiles: ['interface/new.gfx'],
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

        assert.strictEqual(result.kind, 'full');
    });

    it('falls back to a full snapshot when a focus overlay dependency changes', async () => {
        const previousTree = createTree('tree_a', 'FOCUS_A');
        const previous = createFocusTreeRenderCache({
            focusTrees: [previousTree],
            renderedFocus: { FOCUS_A: '<div>A</div>' },
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
            ...previousTree.focuses.FOCUS_A,
            overlay: 'GFX_focus_overlay',
        };
        const nextTree = {
            ...previousTree,
            focuses: { FOCUS_A: nextFocus },
        };

        const result = await createFocusTreeRenderUpdate(previous, {
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

        assert.strictEqual(result.kind, 'full');
    });

    it('records approximate payload size metrics for full snapshots', () => {
        resetPerfMetrics();

        createFullFocusTreeRenderUpdate({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
            },
            renderedInlayWindows: {},
            gfxFiles: [],
            focusIconGfxFileByName: {},
            focusIconAssetResolution: {} as any,
            focusIconStyleSignature: '',
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.focus { opacity: 1; }',
            styleNonce: 'nonce',
            xGridSize: 96,
            yGridSize: 130,
            focusToolbarHeight: 68,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            deferredAssetLoad: true,
        } as any);

        const payloadMetric = getPerfSnapshot({ limit: 5 }).entries.find(entry => entry.label === 'focustree.payloadSize');
        assert.ok(payloadMetric);
        assert.strictEqual(payloadMetric.tags.kind, 'full');
        assert.strictEqual(payloadMetric.tags.deferredAssetLoad, true);
        assert.ok((payloadMetric.tags.focusTreeBytes as number) > 0);
        assert.ok((payloadMetric.tags.renderedFocusBytes as number) > 0);
        assert.ok((payloadMetric.tags.dynamicStyleBytes as number) > 0);
    });

    it('falls back to a full snapshot when icon texture expiry changes', async () => {
        const previous = createFocusTreeRenderCache({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
            },
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            gfxFiles: ['interface/shared.gfx'],
            focusIconGfxFileByName: { GFX_FOCUS_A: 'interface/shared.gfx' },
            focusIconStyleSignature: 'texture@mtime-1',
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const tree = createTree('tree_a', 'FOCUS_A');
        const result = await createFocusTreeRenderUpdate(previous, {
            focusTrees: [tree],
            focusById: {
                FOCUS_A: tree.focuses.FOCUS_A,
            },
            allFocuses: [
                tree.focuses.FOCUS_A,
            ],
            allInlays: [],
            gfxFiles: ['interface/shared.gfx'],
            focusIconGfxFileByName: { GFX_FOCUS_A: 'interface/shared.gfx' },
            focusIconStyleSignature: 'texture@mtime-2',
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

        assert.strictEqual(result.kind, 'full');
    });

    it('falls back to a full snapshot when a focus icon resolves to a different gfx file', async () => {
        const previous = createFocusTreeRenderCache({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            renderedFocus: {
                FOCUS_A: '<div>A</div>',
            },
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            gfxFiles: ['interface/shared.gfx', 'interface/override.gfx'],
            focusIconGfxFileByName: { GFX_FOCUS_A: 'interface/shared.gfx' },
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            styleNonce: 'nonce',
            focusToolbarHeight: 68,
        } as any);

        const tree = createTree('tree_a', 'FOCUS_A');
        const result = await createFocusTreeRenderUpdate(previous, {
            focusTrees: [tree],
            focusById: {
                FOCUS_A: tree.focuses.FOCUS_A,
            },
            allFocuses: [
                tree.focuses.FOCUS_A,
            ],
            allInlays: [],
            gfxFiles: ['interface/shared.gfx', 'interface/override.gfx'],
            focusIconGfxFileByName: { GFX_FOCUS_A: 'interface/override.gfx' },
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

        assert.strictEqual(result.kind, 'full');
    });

    it('stops large signature planning at a cooperative cancellation checkpoint', async () => {
        const focusTree = createTree('tree_cancel', 'FOCUS_0') as any;
        focusTree.focuses = Object.fromEntries(Array.from({ length: 512 }, (_, index) => {
            const id = `FOCUS_${index}`;
            return [id, {
                ...focusTree.focuses.FOCUS_0,
                id,
                layoutEditKey: id.toLowerCase(),
                x: index,
                icon: [],
            }];
        }));
        let cancelled = false;
        const isCancelled = () => cancelled;
        setTimeout(() => {
            cancelled = true;
        }, 0);

        await assert.rejects(
            createFocusTreeRenderUpdate(undefined, {
                focusTrees: [focusTree],
                focusById: focusTree.focuses,
                allFocuses: Object.values(focusTree.focuses),
                allInlays: [],
                gfxFiles: [],
                focusIconGfxFileByName: {},
                gridBox: { position: { x: 0, y: 0 } },
                xGridSize: 96,
                yGridSize: 130,
                focusPositionDocumentVersion: 1,
                focusPositionActiveFile: 'common/national_focus/test.txt',
                conditionPresetsByTree: {},
                hasFocusSelector: false,
                hasWarningsButton: false,
                loadDurationMs: 1,
                deferredAssetLoad: true,
                localisationIndexReady: true,
            } as any, isCancelled),
            /Focus tree render cancelled/,
        );
    });
});
