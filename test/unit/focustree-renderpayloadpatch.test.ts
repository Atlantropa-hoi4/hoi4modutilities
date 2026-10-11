import * as assert from 'assert';
import {
    createFullFocusTreeRenderUpdate,
    createFocusTreeRenderCache,
    createFocusTreeRenderUpdate,
} from '../../src/previewdef/focustree/renderpayloadpatch';
import { toFocusTreeViews } from '../../src/previewdef/focustree/viewmodel';
import { getPerfSnapshot, resetPerfMetrics } from '../../src/util/perf';
import type { FocusTree } from '../../src/previewdef/focustree/schema';
import type { FocusTreeRenderBaseState, FocusTreeRenderPayload } from '../../src/previewdef/focustree/contentbuilder';

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
            focusTemplates: {},
            focusTemplateKeyById: {},
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
            focusTemplates: {},
            focusTemplateKeyById: {},
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.a {}',
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 3,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: true,
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
        assert.strictEqual(result.update.focusTemplateKeyPatch, undefined);
        assert.strictEqual(result.update.focusTreePatches?.[0].tree, undefined);
        assert.strictEqual(
            result.update.focusTreePatches?.[0].delta?.focuses?.FOCUS_B.file,
            'common/national_focus/other.txt',
        );
        assert.deepStrictEqual(result.update.focusTreePatches?.[0].delta?.warnings, [{ code: 'changed' }]);
        assert.strictEqual(result.update.baseSnapshotVersion, previous.snapshotVersion);
        assert.strictEqual(result.update.documentVersion, 4);
        assert.strictEqual(result.update.focusPositionActiveFile, 'common/national_focus/test.txt');
        assert.deepStrictEqual(result.update.changedSlots, ['treeDefinitions', 'selector', 'warnings', 'treeBody']);
        assert.strictEqual(result.update.snapshotVersion, previous.snapshotVersion + 1);
    });

    it('marks structural tree changes so the webview can rebuild only the affected selection', async () => {
        const previous = createFocusTreeRenderCache({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            focusTemplates: {},
            focusTemplateKeyById: {},
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
            focusTemplates: {},
            focusTemplateKeyById: {},
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
            focusTemplates: {},
            focusTemplateKeyById: {},
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

    it('patches only the affected focus when a focus overlay dependency changes', async () => {
        const previousTree = createTree('tree_a', 'FOCUS_A');
        const previous = createFocusTreeRenderCache({
            focusTrees: [previousTree],
            focusTemplates: {},
            focusTemplateKeyById: {},
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

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }
        assert.deepStrictEqual(result.update.changedFocusIds, ['FOCUS_A']);
        assert.ok(result.update.changedSlots.includes('styleDeps'));
        assert.ok((result.update.dynamicStyleCssPatch?.length ?? 0) > 0);
    });

    it('records approximate payload size metrics for full snapshots', () => {
        const previousTraceValue = process.env.HOI4MU_PERF_TRACE;
        process.env.HOI4MU_PERF_TRACE = '1';
        resetPerfMetrics();
        try {
            createFullFocusTreeRenderUpdate({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            focusTemplates: {},
            focusTemplateKeyById: {},
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
            assert.ok((payloadMetric.tags.focusTemplateBytes as number) > 0);
            assert.ok((payloadMetric.tags.dynamicStyleBytes as number) > 0);
        } finally {
            if (previousTraceValue === undefined) {
                delete process.env.HOI4MU_PERF_TRACE;
            } else {
                process.env.HOI4MU_PERF_TRACE = previousTraceValue;
            }
        }
    });

    it('emits an in-place asset update when a deferred tree is hydrated', () => {
        const sourceTree = createTree('tree_a', 'FOCUS_A');
        const deferredPayload = {
            focusTrees: [sourceTree],
            sourceFocusTrees: [sourceTree],
            focusTemplates: {},
            focusTemplateKeyById: {},
            renderedInlayWindows: {},
            gfxFiles: [],
            focusIconGfxFileByName: {},
            focusIconAssetResolution: {} as any,
            focusIconStyleSignature: 'deferred',
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '.deferred {}',
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
            localisationIndexReady: false,
        } as any;
        const deferred = createFullFocusTreeRenderUpdate(deferredPayload);
        const hydrated = createFullFocusTreeRenderUpdate({
            ...deferredPayload,
            focusTemplates: { card: '<div>A</div>' },
            focusTemplateKeyById: { FOCUS_A: 'card' },
            dynamicStyleCss: '.hydrated {}',
            focusIconStyleSignature: 'hydrated',
            deferredAssetLoad: false,
            localisationIndexReady: true,
        }, deferred.cache);

        assert.strictEqual(hydrated.update.updateType, 'assets');
        assert.strictEqual(hydrated.update.focusTrees, undefined);
        assert.deepStrictEqual(hydrated.update.focusTemplates, { card: '<div>A</div>' });
        assert.deepStrictEqual(hydrated.update.focusTemplateKeyById, { FOCUS_A: 'card' });
        assert.strictEqual(hydrated.update.structurallyChangedTreeIds, undefined);
    });

    it('uses a full asset snapshot for changed texture expiry even when focus presentation also changes', async () => {
        const previous = createFocusTreeRenderCache({
            focusTrees: [createTree('tree_a', 'FOCUS_A')],
            focusTemplates: {},
            focusTemplateKeyById: {},
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

        const originalTree = createTree('tree_a', 'FOCUS_A');
        const tree = {
            ...originalTree,
            focuses: { FOCUS_A: { ...originalTree.focuses.FOCUS_A, text: 'EDITED_FOCUS_LABEL' } },
        };
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
            focusTemplates: {},
            focusTemplateKeyById: {},
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

    const createRangedTree = (offset: number, options: { warningOffset?: number; extraFocus?: boolean } = {}) => {
        const tree = createTree('tree_a', 'FOCUS_A') as any;
        const focusA = { ...tree.focuses.FOCUS_A, token: { start: 10 + offset, end: 17 + offset } };
        const focusB = {
            ...tree.focuses.FOCUS_A,
            id: 'FOCUS_B',
            layoutEditKey: `focus:test:${40 + offset}`,
            icon: [{ icon: 'GFX_FOCUS_B', condition: { _type: 'and', items: [] } }],
            prerequisite: [['FOCUS_A']],
            token: { start: 40 + offset, end: 47 + offset },
        };
        tree.focuses = options.extraFocus
            ? { FOCUS_A: focusA, FOCUS_B: focusB, FOCUS_C: { ...focusB, id: 'FOCUS_C', token: { start: 90, end: 97 } } }
            : { FOCUS_A: focusA, FOCUS_B: focusB };
        tree.createTemplate = {
            editKey: 'tree-edit',
            editable: true,
            kind: 'focus',
            sourceFile: 'common/national_focus/test.txt',
            sourceRange: { start: offset, end: 200 + offset },
        };
        const warningOffset = options.warningOffset ?? offset;
        tree.warnings = [{
            code: 'lint',
            kind: 'lint',
            severity: 'warning',
            source: 'FOCUS_B',
            text: 'warning',
            navigations: [{ file: 'common/national_focus/test.txt', start: 40 + warningOffset, end: 47 + warningOffset }],
        }];
        return tree;
    };

    const createBaseState = (tree: any, documentVersion: number) => ({
        focusTrees: [tree],
        focusById: tree.focuses,
        allFocuses: Object.values(tree.focuses),
        allInlays: [],
        gfxFiles: [],
        focusIconGfxFileByName: {},
        gridBox: { position: { x: 0, y: 0 } },
        xGridSize: 96,
        yGridSize: 130,
        focusPositionDocumentVersion: documentVersion,
        focusPositionActiveFile: 'common/national_focus/test.txt',
        conditionPresetsByTree: {},
        hasFocusSelector: false,
        hasWarningsButton: true,
        loadDurationMs: 1,
        deferredAssetLoad: false,
        localisationIndexReady: false,
    }) as any;

    const createRangedCache = (tree: any) => createFocusTreeRenderCache({
        sourceFocusTrees: [tree],
        focusTrees: toFocusTreeViews([tree]),
        focusTemplates: {},
            focusTemplateKeyById: {},
        renderedInlayWindows: {},
        gridBox: { position: { x: 0, y: 0 } },
        dynamicStyleCss: '',
        gfxFiles: [],
        focusIconGfxFileByName: {},
        xGridSize: 96,
        yGridSize: 130,
        focusPositionDocumentVersion: 1,
        focusPositionActiveFile: 'common/national_focus/test.txt',
        conditionPresetsByTree: {},
        hasFocusSelector: false,
        hasWarningsButton: true,
        deferredAssetLoad: false,
        localisationIndexReady: false,
        styleNonce: 'nonce',
        focusToolbarHeight: 68,
    } as any);

    it('sends only moved source ranges when text above the focuses changes', async () => {
        const previous = createRangedCache(createRangedTree(0));
        const result = await createFocusTreeRenderUpdate(previous, createBaseState(createRangedTree(3), 2));

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }
        const patch = result.update.focusTreePatches?.[0];
        assert.strictEqual(patch?.tree, undefined);
        assert.deepStrictEqual(patch?.delta, {
            warningRanges: [[[43, 50]]],
            ranges: { FOCUS_A: [13, 20], FOCUS_B: [43, 50] },
        });
        assert.strictEqual(result.update.changedFocusIds, undefined);
        assert.strictEqual(result.update.focusTemplateKeyPatch, undefined);
        assert.strictEqual(result.update.structurallyChangedTreeIds, undefined);
        assert.strictEqual(result.update.baseSnapshotVersion, previous.snapshotVersion);
        assert.strictEqual(result.cache.focusTrees[0].createTemplate?.sourceRange, undefined);
    });

    it('resends warnings only when their content changes', async () => {
        const previous = createRangedCache(createRangedTree(0));
        const changedTree = createRangedTree(0);
        changedTree.warnings = [{ ...changedTree.warnings[0], text: 'another warning' }];
        const result = await createFocusTreeRenderUpdate(previous, createBaseState(changedTree, 2));

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }
        assert.deepStrictEqual(Object.keys(result.update.focusTreePatches?.[0].delta ?? {}), ['warnings']);
        assert.strictEqual(result.update.focusTreePatches?.[0].delta?.warnings?.[0].text, 'another warning');
    });

    it('replaces the whole tree view when focuses are added', async () => {
        const previous = createRangedCache(createRangedTree(0));
        const result = await createFocusTreeRenderUpdate(previous, createBaseState(createRangedTree(0, { extraFocus: true }), 2));

        assert.strictEqual(result.kind, 'partial');
        if (result.kind !== 'partial') {
            return;
        }
        assert.deepStrictEqual(Object.keys(result.update.focusTreePatches?.[0].tree?.focuses ?? {}), ['FOCUS_A', 'FOCUS_B', 'FOCUS_C']);
        assert.strictEqual(result.update.focusTreePatches?.[0].delta, undefined);
        assert.deepStrictEqual(result.update.structurallyChangedTreeIds, ['tree_a']);
    });

    it('returns prepared views and signatures with full-render plans', async () => {
        const plan = await createFocusTreeRenderUpdate(undefined, createBaseState(createRangedTree(0), 1));

        assert.strictEqual(plan.kind, 'full');
        if (plan.kind !== 'full') {
            return;
        }
        assert.deepStrictEqual(plan.prepared.views.map(view => Object.keys(view.focuses)), [['FOCUS_A', 'FOCUS_B']]);
        assert.deepStrictEqual(Object.keys(plan.prepared.metadata.focusViewSignatures.tree_a), ['FOCUS_A', 'FOCUS_B']);
    });

    it('appends only style rules that the webview does not already have', async () => {
        const initialTree = createTree('tree_a', 'FOCUS_A');
        const previous = createFocusTreeRenderCache({
            focusTrees: [initialTree],
            focusTemplates: {},
            focusTemplateKeyById: {},
            renderedInlayWindows: {},
            gridBox: { position: { x: 0, y: 0 } },
            dynamicStyleCss: '',
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
        const withOverlay = (overlay: string) => {
            const focus = { ...initialTree.focuses.FOCUS_A, overlay };
            const tree = { ...initialTree, focuses: { FOCUS_A: focus } };
            return { ...createBaseState(tree, 2), hasWarningsButton: false };
        };

        const first = await createFocusTreeRenderUpdate(previous, withOverlay('GFX_overlay_a'));
        assert.strictEqual(first.kind, 'partial');
        if (first.kind !== 'partial') {
            return;
        }
        assert.match(first.update.dynamicStyleCssPatch ?? '', /st-focus-icon-GFX_FOCUS_A/);
        assert.match(first.update.dynamicStyleCssPatch ?? '', /st-focus-overlay-GFX_overlay_a/);

        const second = await createFocusTreeRenderUpdate(first.cache, withOverlay('GFX_overlay_b'));
        assert.strictEqual(second.kind, 'partial');
        if (second.kind !== 'partial') {
            return;
        }
        assert.doesNotMatch(second.update.dynamicStyleCssPatch ?? '', /st-focus-icon-GFX_FOCUS_A/);
        assert.match(second.update.dynamicStyleCssPatch ?? '', /st-focus-overlay-GFX_overlay_b/);
        assert.strictEqual(second.cache.dynamicStyleRules.has('st-focus-overlay-GFX_overlay_a'), true);
    });

    it('never caches render signatures for unprepared trees and hydrates a newly selected scope', async () => {
        // This local factory intentionally supplies only source fields used by the renderer.
        const trees = [createTree('tree_a', 'FOCUS_A'), createTree('tree_b', 'FOCUS_B')] as unknown as FocusTree[];
        const baseState = {
            focusTrees: trees,
            allFocuses: trees.flatMap(tree => Object.values(tree.focuses)),
            allInlays: [],
            focusById: { ...trees[0].focuses, ...trees[1].focuses },
            gfxFiles: [],
            focusIconGfxFileByName: {},
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: true,
            hasWarningsButton: false,
            deferredAssetLoad: false,
            localisationIndexReady: true,
            loadDurationMs: 0,
            assetTreeIds: ['tree_a'],
        } as unknown as FocusTreeRenderBaseState;
        const previous = createFocusTreeRenderCache({
            ...baseState,
            sourceFocusTrees: trees,
            focusTrees: toFocusTreeViews(trees),
            focusTemplates: {},
            focusTemplateKeyById: {},
            renderedInlayWindows: {},
            dynamicStyleCss: '',
        } as unknown as FocusTreeRenderPayload);
        assert.deepStrictEqual(Object.keys(previous.focusRenderSignatures), ['FOCUS_A']);
        assert.deepStrictEqual(Object.keys(previous.focusViewSignatures), ['tree_a', 'tree_b']);
        const next = await createFocusTreeRenderUpdate(previous, { ...baseState, assetTreeIds: ['tree_b'] });
        assert.strictEqual(next.kind, 'full');
        if (next.kind === 'full') {
            assert.deepStrictEqual(Object.keys(next.prepared.metadata.focusRenderSignatures), ['FOCUS_B']);
        }
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
        const cancellation = setImmediate(() => {
            cancelled = true;
        });

        try {
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
        } finally {
            clearImmediate(cancellation);
        }
    });
});
