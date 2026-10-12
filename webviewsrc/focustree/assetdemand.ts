import type { FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';
import { focusTreeProtocolVersion } from '../../src/previewdef/focustree/viewmodel';
import {
    focusTreeAssetRequestLimits,
    type FocusTreeAssetMaterialization,
    type FocusTreeAssetRequestMessage,
    type FocusTreeSceneAssetsMessage,
} from '../../src/previewdef/focustree/webviewupdate';

/**
 * DOM-free asset loading state of the focus tree webview: which focuses render real icons,
 * which on-screen focuses still need them, and which request is waiting for the host.
 */

export interface FocusAssetDemandNode {
    id: string;
    /** Slot rectangle in scene coordinates. */
    slot: FocusSceneRect;
    /** Nodes of hidden allow-branches are not shown, so they need no assets. */
    hidden: boolean;
}

export interface FocusAssetDemandInput {
    /** Laid-out nodes; focuses hidden by conditions are not laid out. */
    nodes: Iterable<FocusAssetDemandNode>;
    /** Visible page area in scene coordinates. */
    viewport: FocusSceneRect;
    /** Prefetch margin around the viewport, as a fraction of its size on each side. */
    nearbyMargin?: number;
    isPending(focusId: string): boolean;
    maxVisible?: number;
    maxNearby?: number;
}

export interface FocusAssetDemand {
    /** On-screen focuses still rendering placeholders, closest to the screen center first. */
    visible: string[];
    /** Focuses within the prefetch margin still rendering placeholders, closest first. */
    nearby: string[];
    /** Every on-screen focus, loaded or not. */
    visibleCount: number;
    /** On-screen focuses still rendering placeholders, before `visible` is capped. */
    visiblePendingCount: number;
    /** Laid-out focuses outside hidden branches, on screen or not. */
    layoutCount: number;
    /** Every on-screen focus, uncapped, for checking what the screen actually renders. */
    onScreenFocusIds: string[];
}

export const defaultFocusAssetNearbyMargin = 0.75;

function intersects(rect: FocusSceneRect, area: FocusSceneRect): boolean {
    return rect.x + rect.width > area.x
        && rect.x < area.x + area.width
        && rect.y + rect.height > area.y
        && rect.y < area.y + area.height;
}

export function computeFocusAssetDemand(input: FocusAssetDemandInput): FocusAssetDemand {
    const { viewport } = input;
    const margin = Math.max(0, input.nearbyMargin ?? defaultFocusAssetNearbyMargin);
    const nearbyArea: FocusSceneRect = {
        x: viewport.x - viewport.width * margin,
        y: viewport.y - viewport.height * margin,
        width: viewport.width * (1 + margin * 2),
        height: viewport.height * (1 + margin * 2),
    };
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    const visible: Array<{ id: string; distance: number }> = [];
    const nearby: Array<{ id: string; distance: number }> = [];
    let layoutCount = 0;
    const onScreenFocusIds: string[] = [];
    for (const node of input.nodes) {
        if (node.hidden) {
            continue;
        }
        layoutCount += 1;
        const onScreen = intersects(node.slot, viewport);
        if (!onScreen && !intersects(node.slot, nearbyArea)) {
            continue;
        }
        if (onScreen) {
            onScreenFocusIds.push(node.id);
        }
        if (!input.isPending(node.id)) {
            continue;
        }
        const distance = Math.abs(node.slot.x + node.slot.width / 2 - centerX)
            + Math.abs(node.slot.y + node.slot.height / 2 - centerY);
        (onScreen ? visible : nearby).push({ id: node.id, distance });
    }
    const byDistance = (left: { id: string; distance: number }, right: { id: string; distance: number }) =>
        left.distance - right.distance || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    visible.sort(byDistance);
    nearby.sort(byDistance);
    return {
        visible: visible.slice(0, input.maxVisible ?? focusTreeAssetRequestLimits.visible).map(entry => entry.id),
        nearby: nearby.slice(0, input.maxNearby ?? focusTreeAssetRequestLimits.nearby).map(entry => entry.id),
        visibleCount: onScreenFocusIds.length,
        visiblePendingCount: visible.length,
        layoutCount,
        onScreenFocusIds,
    };
}

/** Focuses whose icon assets the webview renders for real, as told by host messages. */
export class FocusAssetMaterializationState {
    private deferred = true;
    private all = false;
    private readonly focusIds = new Set<string>();

    /** Scene and full asset updates carry the complete set. */
    public replace(materialization: FocusTreeAssetMaterialization): void {
        this.deferred = materialization.deferred;
        this.all = !materialization.deferred && materialization.focusIds === undefined;
        this.focusIds.clear();
        materialization.focusIds?.forEach(focusId => this.focusIds.add(focusId));
    }

    /** Asset patches add focuses. */
    public add(focusIds: readonly string[]): void {
        focusIds.forEach(focusId => this.focusIds.add(focusId));
    }

    public isDeferred(): boolean {
        return this.deferred;
    }

    public isPending(focusId: string): boolean {
        return this.deferred || (!this.all && !this.focusIds.has(focusId));
    }
}

export interface FocusAssetRequestTarget {
    treeId: string;
    documentVersion: number;
    snapshotVersion: number;
}

/**
 * Keeps at most one asset request outstanding. A new request is sent only for focuses the
 * outstanding one does not cover; after a stale answer it waits for the host's next content.
 */
export class FocusAssetRequestTracker {
    private nextAssetRequestId = 1;
    private inFlight: { assetRequestId: number; treeId: string; documentVersion: number; focusIds: Set<string> } | undefined;
    private awaitingContent = false;
    private readonly failedFocusIds = new Set<string>();
    /** Requested focuses a final answer did not load; asking again before new content would loop. */
    private readonly unservedFocusIds = new Set<string>();

    public get isRequestPending(): boolean {
        return this.inFlight !== undefined || this.awaitingContent;
    }

    /** Focuses that cannot be loaded until new host content or an explicit retry. */
    public isFailed(focusId: string): boolean {
        return this.failedFocusIds.has(focusId) || this.unservedFocusIds.has(focusId);
    }

    public createRequest(demand: Pick<FocusAssetDemand, 'visible' | 'nearby'>, target: FocusAssetRequestTarget): FocusTreeAssetRequestMessage | undefined {
        if (this.awaitingContent) {
            return undefined;
        }
        const visibleFocusIds = demand.visible.filter(focusId => !this.isFailed(focusId));
        const nearbyFocusIds = demand.nearby.filter(focusId => !this.isFailed(focusId));
        if (visibleFocusIds.length === 0 && nearbyFocusIds.length === 0) {
            return undefined;
        }
        const inFlight = this.inFlight;
        if (inFlight
            && inFlight.treeId === target.treeId
            && inFlight.documentVersion === target.documentVersion
            && visibleFocusIds.every(focusId => inFlight.focusIds.has(focusId))
            && nearbyFocusIds.every(focusId => inFlight.focusIds.has(focusId))) {
            return undefined;
        }

        const assetRequestId = this.nextAssetRequestId++;
        this.inFlight = {
            assetRequestId,
            treeId: target.treeId,
            documentVersion: target.documentVersion,
            focusIds: new Set([...visibleFocusIds, ...nearbyFocusIds]),
        };
        return {
            command: 'focusTreeAssetRequest',
            protocolVersion: focusTreeProtocolVersion,
            assetRequestId,
            treeId: target.treeId,
            snapshotVersion: target.snapshotVersion,
            documentVersion: target.documentVersion,
            visibleFocusIds,
            nearbyFocusIds,
        };
    }

    public onResponse(message: Pick<FocusTreeSceneAssetsMessage, 'assetRequestId' | 'status' | 'final' | 'materializedFocusIds'>): void {
        const inFlight = this.inFlight;
        if (!inFlight || message.assetRequestId !== inFlight.assetRequestId) {
            return;
        }
        message.materializedFocusIds?.forEach(focusId => inFlight.focusIds.delete(focusId));
        if (message.status === 'stale') {
            this.awaitingContent = true;
        } else if (message.status === 'failed') {
            inFlight.focusIds.forEach(focusId => this.failedFocusIds.add(focusId));
        }
        if (message.final || message.status !== 'applied') {
            if (message.status === 'applied' || message.status === 'empty') {
                // Focuses already in transit arrive anyway; others wait for new content.
                inFlight.focusIds.forEach(focusId => this.unservedFocusIds.add(focusId));
            }
            this.inFlight = undefined;
        }
    }

    /** Host content supersedes asset work the host was doing for an outstanding request. */
    public onContentApplied(documentChanged: boolean): void {
        this.inFlight = undefined;
        this.awaitingContent = false;
        this.unservedFocusIds.clear();
        if (documentChanged) {
            this.failedFocusIds.clear();
        }
    }

    public retryFailed(): void {
        this.failedFocusIds.clear();
        this.unservedFocusIds.clear();
        this.awaitingContent = false;
    }
}

export interface FocusSceneAssetReadiness {
    /** Tree whose scene is rendered. */
    treeId: string | undefined;
    /** Tree the user selected; differs from `treeId` while its scene is still requested. */
    selectedTreeId: string | undefined;
    deferred: boolean;
    visibleCount: number;
    visiblePendingCount: number;
    layoutCount: number;
    /** On-screen icons whose element does not render a decoded image yet. */
    visibleUnrenderedCount: number;
    /** On-screen icons drawn as the grey box because no image could be decoded. */
    visibleUnavailableCount: number;
    /**
     * The selected tree's complete scene is rendered and settled, and every on-screen icon
     * element actually renders a decoded image. A scene with laid-out focuses but none on screen
     * is still settling (its anchor is about to be revealed); only a complete scene without any
     * laid-out focus is legitimately empty.
     */
    ready: boolean;
}

/** What the on-screen icon elements render; undefined when they were not inspected. */
export interface FocusRenderedAssetCounts {
    unrendered: number;
    unavailable: number;
}

export function getFocusSceneAssetReadiness(input: {
    renderedTreeId: string | undefined;
    selectedTreeId: string | undefined;
    /** Structural placeholders only: the scene may still lack focuses, e.g. unresolved shared ones. */
    deferred: boolean;
    demand: Pick<FocusAssetDemand, 'visibleCount' | 'visiblePendingCount' | 'layoutCount'> | undefined;
    renderedAssets: FocusRenderedAssetCounts | undefined;
}): FocusSceneAssetReadiness {
    const demand = input.demand;
    const rendered = input.renderedAssets;
    return {
        treeId: input.renderedTreeId,
        selectedTreeId: input.selectedTreeId,
        deferred: input.deferred,
        visibleCount: demand?.visibleCount ?? 0,
        visiblePendingCount: demand?.visiblePendingCount ?? 0,
        layoutCount: demand?.layoutCount ?? 0,
        visibleUnrenderedCount: rendered?.unrendered ?? 0,
        visibleUnavailableCount: rendered?.unavailable ?? 0,
        ready: !!input.renderedTreeId
            && input.renderedTreeId === input.selectedTreeId
            && !input.deferred
            && !!demand
            && demand.visiblePendingCount === 0
            && (demand.visibleCount > 0 || demand.layoutCount === 0)
            && !!rendered
            && rendered.unrendered === 0
            && rendered.unavailable === 0,
    };
}

interface FocusSceneReadinessEpoch {
    treeId: string;
    /** The epoch's scene is structural only and may still lack focuses. */
    deferred: boolean;
    renderedReported: boolean;
    readyReported: boolean;
}

/**
 * Per-scene readiness reports. Rendering a tree other than the current one, or the complete
 * scene of a tree shown structurally so far, starts an epoch. Every switch and revisit thus
 * reports its painted scene once and, after that, its first settled moment without on-screen
 * placeholders once.
 */
export class FocusSceneReadinessTracker {
    private epoch: FocusSceneReadinessEpoch | undefined;

    public get current(): Readonly<FocusSceneReadinessEpoch> | undefined {
        return this.epoch;
    }

    /** Returns true when the rendered scene starts a new epoch. */
    public onSceneRendered(treeId: string, deferred = false): boolean {
        if (this.epoch?.treeId === treeId && (deferred || !this.epoch.deferred)) {
            return false;
        }
        this.epoch = { treeId, deferred, renderedReported: false, readyReported: false };
        return true;
    }

    /** Marks the epoch's paint as reported; false when another tree was rendered meanwhile. */
    public markRendered(treeId: string): boolean {
        if (this.epoch?.treeId !== treeId) {
            return false;
        }
        this.epoch.renderedReported = true;
        return true;
    }

    /** True once per epoch, the first time its painted scene is asset ready. */
    public claimReady(readiness: FocusSceneAssetReadiness): boolean {
        const epoch = this.epoch;
        if (!epoch || !epoch.renderedReported || epoch.readyReported || !readiness.ready || readiness.treeId !== epoch.treeId) {
            return false;
        }
        epoch.readyReported = true;
        return true;
    }
}

export interface FocusTreeSceneAssetsApplyContext {
    getDocumentVersion(): number;
    getSnapshotVersion(): number;
    setSnapshotVersion(snapshotVersion: number): void;
    getLatestRequestId(): number;
    appendDynamicStyleCss(css: string): void;
    addMaterializedFocusIds(focusIds: readonly string[]): void;
}

/**
 * Applies an asset patch of the current document. Messages arrive in posting order, so its rules
 * are never older than the scene shown; the snapshot version advances only from the patch's
 * base, otherwise later host deltas detect the divergence and request the scene again.
 */
export function applyFocusTreeSceneAssets(
    message: FocusTreeSceneAssetsMessage,
    context: FocusTreeSceneAssetsApplyContext,
): boolean {
    if (message.protocolVersion !== focusTreeProtocolVersion
        || message.status !== 'applied'
        || message.documentVersion !== context.getDocumentVersion()
        || message.requestId < context.getLatestRequestId()) {
        return false;
    }
    if (message.dynamicStyleCssPatch) {
        context.appendDynamicStyleCss(message.dynamicStyleCssPatch);
    }
    context.addMaterializedFocusIds(message.materializedFocusIds ?? []);
    if (message.baseSnapshotVersion === context.getSnapshotVersion() && message.snapshotVersion > message.baseSnapshotVersion) {
        context.setSnapshotVersion(message.snapshotVersion);
    }
    return true;
}
