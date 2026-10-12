import * as assert from 'assert';
import {
    applyFocusTreeSceneAssets,
    computeFocusAssetDemand,
    FocusAssetMaterializationState,
    FocusAssetRequestTracker,
    FocusSceneReadinessTracker,
    getFocusSceneAssetReadiness,
    type FocusAssetDemandNode,
    type FocusRenderedAssetCounts,
    type FocusTreeSceneAssetsApplyContext,
} from '../../webviewsrc/focustree/assetdemand';
import { focusTreeProtocolVersion } from '../../src/previewdef/focustree/viewmodel';
import type { FocusTreeSceneAssetsMessage } from '../../src/previewdef/focustree/webviewupdate';

const slotWidth = 100;
const slotHeight = 130;

/** One laid-out focus per grid slot, as the scene geometry produces them. */
function gridNodes(layout: Record<string, [column: number, row: number]>, hidden: readonly string[] = []): FocusAssetDemandNode[] {
    return Object.entries(layout).map(([id, [column, row]]) => ({
        id,
        slot: { x: column * slotWidth, y: row * slotHeight, width: slotWidth, height: slotHeight },
        hidden: hidden.includes(id),
    }));
}

function sceneAssets(overrides: Partial<FocusTreeSceneAssetsMessage>): FocusTreeSceneAssetsMessage {
    return {
        command: 'focusTreeSceneAssets',
        protocolVersion: focusTreeProtocolVersion,
        requestId: 3,
        assetRequestId: 1,
        treeId: 'tree',
        documentVersion: 7,
        baseSnapshotVersion: 4,
        snapshotVersion: 5,
        status: 'applied',
        final: true,
        materializedFocusIds: ['B'],
        dynamicStyleCssPatch: '.st-focus-icon-GFX_B { background-image: url(b.png); }',
        ...overrides,
    };
}

function applyContext(state: { documentVersion: number; snapshotVersion: number; latestRequestId: number }) {
    const css: string[] = [];
    const materialized = new FocusAssetMaterializationState();
    materialized.replace({ deferred: false, focusIds: ['A'] });
    const context: FocusTreeSceneAssetsApplyContext = {
        getDocumentVersion: () => state.documentVersion,
        getSnapshotVersion: () => state.snapshotVersion,
        setSnapshotVersion: snapshotVersion => { state.snapshotVersion = snapshotVersion; },
        getLatestRequestId: () => state.latestRequestId,
        appendDynamicStyleCss: value => css.push(value),
        addMaterializedFocusIds: focusIds => materialized.add(focusIds),
    };
    return { context, css, materialized };
}

describe('focus tree asset demand', () => {
    it('requests the focuses a scroll reveals, on-screen ones before the prefetch margin', () => {
        const nodes = gridNodes({ A: [0, 0], B: [1, 0], C: [6, 0], D: [9, 0], FAR: [30, 0] });
        const materialized = new FocusAssetMaterializationState();
        materialized.replace({ deferred: false, focusIds: ['A', 'B'] });
        const isPending = (focusId: string) => materialized.isPending(focusId);

        const before = computeFocusAssetDemand({ nodes, viewport: { x: 0, y: 0, width: 300, height: 400 }, isPending });
        assert.deepStrictEqual(before.visible, [], 'the first screen is fully loaded');
        assert.deepStrictEqual(before.nearby, [], 'C starts beyond the 225px margin');
        assert.strictEqual(before.visibleCount, 2);

        const scrolled = computeFocusAssetDemand({ nodes, viewport: { x: 550, y: 0, width: 300, height: 400 }, isPending });
        assert.deepStrictEqual(scrolled.visible, ['C']);
        assert.deepStrictEqual(scrolled.nearby, ['D'], 'D is within the margin; FAR is not requested');
        assert.strictEqual(scrolled.visiblePendingCount, 1);

        // Zooming out widens the scene-space viewport; closest focuses come first.
        const zoomedOut = computeFocusAssetDemand({ nodes, viewport: { x: 0, y: 0, width: 1200, height: 1000 }, isPending });
        assert.deepStrictEqual(zoomedOut.visible, ['C', 'D']);
    });

    it('requests a focus that a condition change lays out on screen', () => {
        const materialized = new FocusAssetMaterializationState();
        materialized.replace({ deferred: false, focusIds: ['A'] });
        const viewport = { x: 0, y: 0, width: 400, height: 400 };
        const isPending = (focusId: string) => materialized.isPending(focusId);

        const hiddenByCondition = computeFocusAssetDemand({ nodes: gridNodes({ A: [0, 0] }), viewport, isPending });
        assert.deepStrictEqual(hiddenByCondition.visible, []);
        const revealed = computeFocusAssetDemand({ nodes: gridNodes({ A: [0, 0], X: [1, 1] }), viewport, isPending });
        assert.deepStrictEqual(revealed.visible, ['X']);
    });

    it('ignores focuses in hidden allow-branches until the branch is shown', () => {
        const materialized = new FocusAssetMaterializationState();
        materialized.replace({ deferred: false, focusIds: [] });
        const viewport = { x: 0, y: 0, width: 400, height: 400 };
        const isPending = (focusId: string) => materialized.isPending(focusId);
        const layout = { A: [0, 0], BRANCH: [1, 0] } as Record<string, [number, number]>;

        const hidden = computeFocusAssetDemand({ nodes: gridNodes(layout, ['BRANCH']), viewport, isPending });
        assert.deepStrictEqual(hidden.visible, ['A']);
        assert.strictEqual(hidden.visibleCount, 1);
        assert.strictEqual(hidden.layoutCount, 1, 'hidden branches are not part of the shown scene');
        const shown = computeFocusAssetDemand({ nodes: gridNodes(layout), viewport, isPending });
        assert.deepStrictEqual(shown.visible, ['BRANCH', 'A'], 'closest to the screen center first');
    });

    it('bounds one request while counting every pending on-screen focus', () => {
        const layout = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`F${index}`, [index % 5, Math.floor(index / 5)] as [number, number]]));
        const demand = computeFocusAssetDemand({
            nodes: gridNodes(layout),
            viewport: { x: 0, y: 0, width: 500, height: 520 },
            isPending: () => true,
            maxVisible: 4,
        });
        assert.strictEqual(demand.visible.length, 4);
        assert.strictEqual(demand.visiblePendingCount, 20);
    });

    it('treats every focus as pending while the scene is structural only', () => {
        const state = new FocusAssetMaterializationState();
        assert.strictEqual(state.isDeferred(), true);
        assert.strictEqual(state.isPending('A'), true);
        state.replace({ deferred: false, focusIds: ['A'] });
        assert.strictEqual(state.isPending('A'), false);
        assert.strictEqual(state.isPending('B'), true);
        state.add(['B']);
        assert.strictEqual(state.isPending('B'), false);
        state.replace({ deferred: false });
        assert.strictEqual(state.isPending('UNLISTED'), false, 'an omitted set means every focus is loaded');
        state.replace({ deferred: true, focusIds: [] });
        assert.strictEqual(state.isPending('A'), true);
    });
});

describe('focus tree asset requests', () => {
    const target = { treeId: 'tree', documentVersion: 7, snapshotVersion: 4 };

    it('keeps one request outstanding and sends another only for uncovered focuses', () => {
        const tracker = new FocusAssetRequestTracker();
        const first = tracker.createRequest({ visible: ['A'], nearby: ['B'] }, target);
        assert.ok(first);
        assert.strictEqual(first.protocolVersion, focusTreeProtocolVersion);
        assert.deepStrictEqual([first.visibleFocusIds, first.nearbyFocusIds], [['A'], ['B']]);
        assert.strictEqual(tracker.createRequest({ visible: ['A'], nearby: [] }, target), undefined, 'covered by the outstanding request');

        const second = tracker.createRequest({ visible: ['A', 'C'], nearby: [] }, target);
        assert.ok(second);
        assert.notStrictEqual(second.assetRequestId, first.assetRequestId);

        tracker.onResponse({ assetRequestId: first.assetRequestId, status: 'applied', final: true, materializedFocusIds: ['A'] });
        assert.strictEqual(tracker.isRequestPending, true, 'an answer to a superseded request does not clear the newer one');
        tracker.onResponse({ assetRequestId: second.assetRequestId, status: 'applied', final: false, materializedFocusIds: ['A'] });
        assert.strictEqual(tracker.createRequest({ visible: ['C'], nearby: [] }, target), undefined, 'C is still being loaded');
        tracker.onResponse({ assetRequestId: second.assetRequestId, status: 'applied', final: true, materializedFocusIds: ['C'] });
        assert.strictEqual(tracker.isRequestPending, false);
    });

    it('waits for host content after a stale answer and retries failed focuses only on demand', () => {
        const tracker = new FocusAssetRequestTracker();
        const stale = tracker.createRequest({ visible: ['A'], nearby: [] }, target)!;
        tracker.onResponse({ assetRequestId: stale.assetRequestId, status: 'stale', final: true });
        assert.strictEqual(tracker.createRequest({ visible: ['A'], nearby: [] }, target), undefined);
        tracker.onContentApplied(true);

        const failed = tracker.createRequest({ visible: ['A'], nearby: [] }, { ...target, documentVersion: 8 })!;
        assert.ok(failed);
        tracker.onResponse({ assetRequestId: failed.assetRequestId, status: 'failed', final: true });
        assert.strictEqual(tracker.isFailed('A'), true);
        assert.strictEqual(tracker.createRequest({ visible: ['A'], nearby: [] }, { ...target, documentVersion: 8 }), undefined,
            'a failed focus is not requested in a loop');
        tracker.onContentApplied(false);
        assert.strictEqual(tracker.isFailed('A'), true, 'patches of the same document keep failures');
        tracker.retryFailed();
        assert.ok(tracker.createRequest({ visible: ['A'], nearby: [] }, { ...target, documentVersion: 8 }));
    });

    it('does not ask again in a loop for focuses a final answer left unloaded', () => {
        const tracker = new FocusAssetRequestTracker();
        const request = tracker.createRequest({ visible: ['A', 'B'], nearby: [] }, target)!;
        tracker.onResponse({ assetRequestId: request.assetRequestId, status: 'applied', final: true, materializedFocusIds: ['A'] });
        assert.strictEqual(tracker.createRequest({ visible: ['B'], nearby: [] }, target), undefined,
            'the host could not serve B for this scene');
        const empty = tracker.createRequest({ visible: ['C'], nearby: [] }, target)!;
        tracker.onResponse({ assetRequestId: empty.assetRequestId, status: 'empty', final: true });
        assert.strictEqual(tracker.createRequest({ visible: ['C'], nearby: [] }, target), undefined);
        tracker.onContentApplied(false);
        assert.ok(tracker.createRequest({ visible: ['B', 'C'], nearby: [] }, target), 'new content allows another attempt');
    });

    it('drops a request that host content superseded so the new scene is asked for again', () => {
        const tracker = new FocusAssetRequestTracker();
        assert.ok(tracker.createRequest({ visible: ['A'], nearby: [] }, target));
        tracker.onContentApplied(false);
        assert.ok(tracker.createRequest({ visible: ['A'], nearby: [] }, target));
    });
});

describe('focus tree scene readiness', () => {
    const readiness = (
        treeId: string,
        visiblePendingCount: number,
        options: {
            deferred?: boolean;
            selectedTreeId?: string;
            visibleCount?: number;
            layoutCount?: number;
            renderedAssets?: FocusRenderedAssetCounts | null;
        } = {},
    ) => getFocusSceneAssetReadiness({
        renderedTreeId: treeId,
        selectedTreeId: options.selectedTreeId ?? treeId,
        deferred: options.deferred ?? false,
        demand: { visibleCount: options.visibleCount ?? 3, visiblePendingCount, layoutCount: options.layoutCount ?? 36 },
        renderedAssets: options.renderedAssets === null ? undefined : options.renderedAssets ?? { unrendered: 0, unavailable: 0 },
    });

    it('counts only icons the screen actually renders from decoded images', () => {
        assert.strictEqual(readiness('A', 0, { renderedAssets: null }).ready, false, 'uninspected icons are not proof');
        const greyBox = readiness('A', 0, { renderedAssets: { unrendered: 0, unavailable: 1 } });
        assert.strictEqual(greyBox.ready, false, 'a grey box drawn for an undecodable image is not a loaded asset');
        assert.strictEqual(greyBox.visibleUnavailableCount, 1);
        assert.strictEqual(readiness('A', 0, { renderedAssets: { unrendered: 2, unavailable: 0 } }).ready, false,
            'materialized focuses whose card or rule is not applied yet');
        assert.strictEqual(readiness('A', 0, { renderedAssets: { unrendered: 0, unavailable: 0 } }).ready, true);
    });

    it('never certifies an empty structural canvas or a viewport its scene has not reached yet', () => {
        // Cold open: shared focuses are unresolved, so the structural scene lays out nothing.
        assert.strictEqual(readiness('GNG_suzuki_tree', 0, { deferred: true, visibleCount: 0, layoutCount: 0 }).ready, false);
        // The complete scene lays out 36 focuses, but its anchor is not scrolled into view yet.
        assert.strictEqual(readiness('GNG_suzuki_tree', 0, { visibleCount: 0, layoutCount: 36 }).ready, false);
        // After the reveal, 3 on-screen focuses still show placeholders.
        assert.strictEqual(readiness('GNG_suzuki_tree', 3, { visibleCount: 3 }).ready, false);
        assert.strictEqual(readiness('GNG_suzuki_tree', 0, { visibleCount: 3 }).ready, true);
    });

    it('treats a complete scene without any laid-out focus as legitimately ready', () => {
        assert.strictEqual(readiness('EMPTY_TREE', 0, { visibleCount: 0, layoutCount: 0 }).ready, true);
    });

    it('starts a new epoch when the complete scene replaces a structural one of the same tree', () => {
        const tracker = new FocusSceneReadinessTracker();
        assert.strictEqual(tracker.onSceneRendered('GNG_suzuki_tree', true), true);
        assert.strictEqual(tracker.markRendered('GNG_suzuki_tree'), true);
        assert.strictEqual(tracker.claimReady(readiness('GNG_suzuki_tree', 0, { deferred: true, visibleCount: 0, layoutCount: 0 })), false);
        assert.strictEqual(tracker.onSceneRendered('GNG_suzuki_tree', true), false, 'structural rebuilds keep the epoch');
        assert.strictEqual(tracker.onSceneRendered('GNG_suzuki_tree', false), true, 'the complete scene reports again');
        assert.strictEqual(tracker.claimReady(readiness('GNG_suzuki_tree', 0)), false, 'not before its own paint was reported');
        assert.strictEqual(tracker.markRendered('GNG_suzuki_tree'), true);
        assert.strictEqual(tracker.claimReady(readiness('GNG_suzuki_tree', 0)), true);
        assert.strictEqual(tracker.onSceneRendered('GNG_suzuki_tree', false), false);
    });

    it('reports paint and asset readiness once for every switch and revisit', () => {
        const tracker = new FocusSceneReadinessTracker();
        assert.strictEqual(tracker.onSceneRendered('A'), true);
        assert.strictEqual(tracker.claimReady(readiness('A', 0)), false, 'never before the paint was reported');
        assert.strictEqual(tracker.markRendered('A'), true);
        assert.strictEqual(tracker.claimReady(readiness('A', 2)), false, 'placeholders are on screen');
        assert.strictEqual(tracker.claimReady(readiness('A', 0, { deferred: true })), false, 'a structural scene is not ready');
        assert.strictEqual(tracker.claimReady(readiness('A', 0)), true);
        assert.strictEqual(tracker.claimReady(readiness('A', 0)), false, 'once per epoch');
        assert.strictEqual(tracker.onSceneRendered('A'), false, 'rebuilding the same tree keeps its epoch');

        // Rapid switch to B and back to A before B's paint was reported.
        assert.strictEqual(tracker.onSceneRendered('B'), true);
        assert.strictEqual(tracker.onSceneRendered('A'), true);
        assert.strictEqual(tracker.markRendered('B'), false, 'a superseded paint is not reported');
        assert.strictEqual(tracker.claimReady(readiness('B', 0)), false);
        assert.strictEqual(tracker.markRendered('A'), true);
        assert.strictEqual(tracker.claimReady(readiness('A', 0)), true, 'a revisit reports again');
    });

    it('is not ready while the selected tree is still requested or the scene is unknown', () => {
        assert.strictEqual(readiness('GNG_yasuda_crisis_tree', 0, { selectedTreeId: 'GNG_morita_silicon_years' }).ready, false);
        assert.strictEqual(getFocusSceneAssetReadiness({
            renderedTreeId: 'A', selectedTreeId: 'A', deferred: false, demand: undefined,
            renderedAssets: { unrendered: 0, unavailable: 0 },
        }).ready, false);
    });
});

describe('focus tree asset patch application', () => {
    it('adds rules and focuses and advances the snapshot from its base', () => {
        const state = { documentVersion: 7, snapshotVersion: 4, latestRequestId: 3 };
        const { context, css, materialized } = applyContext(state);
        assert.strictEqual(applyFocusTreeSceneAssets(sceneAssets({}), context), true);
        assert.deepStrictEqual(css, ['.st-focus-icon-GFX_B { background-image: url(b.png); }']);
        assert.strictEqual(materialized.isPending('B'), false);
        assert.strictEqual(state.snapshotVersion, 5);
    });

    it('keeps the snapshot when the patch was computed from another base', () => {
        const state = { documentVersion: 7, snapshotVersion: 6, latestRequestId: 3 };
        const { context, css, materialized } = applyContext(state);
        assert.strictEqual(applyFocusTreeSceneAssets(sceneAssets({}), context), true);
        assert.strictEqual(css.length, 1, 'ordered delivery makes the rules current for this document');
        assert.strictEqual(materialized.isPending('B'), false);
        assert.strictEqual(state.snapshotVersion, 6, 'later host deltas detect the divergence instead');
    });

    it('rejects patches of another document, an older refresh, or without assets', () => {
        for (const [overrides, state] of [
            [{ documentVersion: 6 }, { documentVersion: 7, snapshotVersion: 4, latestRequestId: 3 }],
            [{ requestId: 2 }, { documentVersion: 7, snapshotVersion: 4, latestRequestId: 3 }],
            [{ status: 'stale', materializedFocusIds: undefined }, { documentVersion: 7, snapshotVersion: 4, latestRequestId: 3 }],
            [{ protocolVersion: 3 as unknown as typeof focusTreeProtocolVersion }, { documentVersion: 7, snapshotVersion: 4, latestRequestId: 3 }],
        ] as Array<[Partial<FocusTreeSceneAssetsMessage>, { documentVersion: number; snapshotVersion: number; latestRequestId: number }]>) {
            const { context, css, materialized } = applyContext(state);
            assert.strictEqual(applyFocusTreeSceneAssets(sceneAssets(overrides), context), false, JSON.stringify(overrides));
            assert.deepStrictEqual(css, []);
            assert.strictEqual(materialized.isPending('B'), true);
            assert.strictEqual(state.snapshotVersion, 4);
        }
    });
});
