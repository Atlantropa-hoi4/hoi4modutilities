import {
    focusIconStateProperty,
    type FocusIconRenderState,
    type FocusTreeAssetMaterialization,
    type FocusTreeSceneAssetsMessage,
} from '../../src/previewdef/focustree/webviewupdate';
import { normalizeForStyle } from '../../src/util/styletable';
import { feLocalize } from '../util/i18n';
import { vscode } from '../util/vscode';
import {
    computeFocusAssetDemand,
    FocusAssetRequestTracker,
    FocusSceneReadinessTracker,
    getFocusSceneAssetReadiness,
    type FocusAssetDemand,
    type FocusRenderedAssetCounts,
    type FocusSceneAssetReadiness,
} from './assetdemand';
import { getFocusIconClassName } from './cards';
import { runtime } from './runtime';
import { focusScene } from './scenestore';
import { postFocusTreeDiagnostics, postFocusTreeWebviewTiming, setFocusTreeAssetDiagnosticsProvider } from './telemetry';
import { isHiddenBranchClass, updateAssetPendingClasses } from './visualstate';

/**
 * Loads focus icons on demand. Scroll, zoom, resize, branch, and condition changes reveal
 * focuses whose icons are still placeholders; a debounced check asks the host for the ones on
 * screen first and those within a margin second, and a polite status reports the progress.
 */

const tracker = new FocusAssetRequestTracker();
const sceneReadiness = new FocusSceneReadinessTracker();
let lastReadinessDiagnosticsKey: string | undefined;
const checkDebounceMs = 120;
const checkMaxWaitMs = 500;
const statusDelayMs = 300;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let checkFrame: number | undefined;
let firstCheckRequestedAt: number | undefined;
let pendingStatusSince: number | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let visibleAssetsApplied = false;
let assetsHaveBeenApplied = false;

export function getCurrentFocusAssetDemand(): FocusAssetDemand | undefined {
    const viewport = focusScene.getViewportSceneRect();
    if (!viewport || !runtime.renderedFocusTree) {
        return undefined;
    }
    return computeFocusAssetDemand({
        nodes: focusScene.getAssetDemandNodes(isHiddenBranchClass),
        viewport,
        isPending: focusId => runtime.assetMaterialization.isPending(focusId),
    });
}

/**
 * Claims the one-time `visibleAssetsApplied` stage once the selected tree's complete scene is
 * settled and every on-screen focus shows real assets. A structural scene, or a complete scene
 * whose focuses are not on screen yet, never certifies readiness.
 */
export function claimVisibleAssetsApplied(readiness?: FocusSceneAssetReadiness): boolean {
    if (visibleAssetsApplied || !(readiness ?? getCurrentSceneAssetReadiness()).ready) {
        return false;
    }
    visibleAssetsApplied = true;
    return true;
}

function getCurrentSceneAssetReadiness(demand: FocusAssetDemand | undefined = getCurrentFocusAssetDemand()): FocusSceneAssetReadiness {
    const renderedTreeId = runtime.renderedFocusTree?.id;
    const deferred = runtime.assetMaterialization.isDeferred();
    // Inspecting icon elements is only meaningful once nothing on screen awaits a host load.
    const canInspect = !deferred && !!renderedTreeId && renderedTreeId === runtime.selectedFocusTreeId;
    return getFocusSceneAssetReadiness({
        renderedTreeId,
        selectedTreeId: runtime.selectedFocusTreeId,
        deferred,
        demand,
        renderedAssets: canInspect && demand && demand.visiblePendingCount === 0
            ? inspectRenderedFocusIcons(demand.onScreenFocusIds)
            : undefined,
    });
}

const emptyFocusIconClass = `st-focus-icon-${normalizeForStyle('-empty')}`;

/**
 * Reads what the on-screen icon elements actually render from the state their icon rule
 * declares. Focuses without an icon by design are skipped; a focus without a mounted card or
 * whose icon rule is still a placeholder is unrendered; the grey box drawn when no image could
 * be decoded is unavailable and never counts as a loaded asset.
 */
function inspectRenderedFocusIcons(focusIds: readonly string[]): FocusRenderedAssetCounts {
    const focusTree = runtime.renderedFocusTree;
    const counts: FocusRenderedAssetCounts = { unrendered: 0, unavailable: 0 };
    for (const focusId of focusIds) {
        const focus = focusTree?.focuses[focusId];
        if (!focus) {
            continue;
        }
        const iconClass = getFocusIconClassName(focus, runtime.renderedExprs);
        if (iconClass === emptyFocusIconClass) {
            continue;
        }
        const card = focusScene.getCard(focusId);
        if (!card) {
            counts.unrendered += 1;
            continue;
        }
        const icon = card.querySelector<HTMLElement>(`.${CSS.escape(iconClass)}`);
        if (!icon) {
            // The focus GUI template has no icon slot, so nothing is shown.
            continue;
        }
        const state = getComputedStyle(icon).getPropertyValue(focusIconStateProperty).trim() as FocusIconRenderState | '';
        if (state === 'unavailable') {
            counts.unavailable += 1;
        } else if (state !== 'loaded') {
            counts.unrendered += 1;
        }
    }
    return counts;
}

/**
 * Called after the selected tree's scene was rebuilt. A different tree than before starts a
 * readiness epoch: `sceneRendered` follows its paint, `sceneAssetsReady` its first moment
 * without on-screen placeholders. Both carry the tree id, so every switch and revisit reports.
 */
export function onFocusSceneRendered(): void {
    const treeId = runtime.renderedFocusTree?.id;
    const deferred = runtime.assetMaterialization.isDeferred();
    if (treeId && sceneReadiness.onSceneRendered(treeId, deferred)) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!sceneReadiness.markRendered(treeId)) {
                return;
            }
            postFocusTreeWebviewTiming({
                stage: 'sceneRendered',
                treeId,
                // 'deferred' scenes are structural and may still lack focuses.
                assetLoadMode: deferred ? 'deferred' : 'full',
                snapshotVersion: runtime.snapshotVersion,
                documentVersion: runtime.focusPositionDocumentVersion,
            });
            reportSceneReadiness(getCurrentSceneAssetReadiness());
        }));
    }
    // Tree switches and condition changes can reveal focuses whose icons are not loaded yet.
    scheduleFocusAssetDemandCheck(true);
}

function reportSceneReadiness(readiness: FocusSceneAssetReadiness): void {
    if (sceneReadiness.claimReady(readiness)) {
        postFocusTreeWebviewTiming({
            stage: 'sceneAssetsReady',
            treeId: readiness.treeId,
            snapshotVersion: runtime.snapshotVersion,
            documentVersion: runtime.focusPositionDocumentVersion,
            source: 'assets',
        });
    }
    // Diagnostics are the polled state; they are posted when readiness changes, not per scroll.
    const key = [
        readiness.treeId,
        readiness.selectedTreeId,
        readiness.deferred,
        readiness.ready,
        readiness.visibleUnavailableCount > 0,
    ].join('\u0000');
    if (key !== lastReadinessDiagnosticsKey) {
        lastReadinessDiagnosticsKey = key;
        postFocusTreeDiagnostics('assetReadiness', {
            focusGridBoxItemCount: Object.keys(runtime.focusPositions).length,
            renderedFocusHitCount: Array.from(focusScene.mountedFocusIds()).length,
        });
    }
}

/** Applies a scene or full asset update's materialized set before its scene is rebuilt. */
export function replaceFocusAssetMaterialization(materialization: FocusTreeAssetMaterialization): void {
    runtime.assetMaterialization.replace(materialization);
    if (!materialization.deferred) {
        assetsHaveBeenApplied = true;
    }
    updateAssetPendingClasses();
}

/** Host content supersedes any asset request the host was working on. */
export function onFocusTreeContentApplied(documentChanged: boolean): void {
    tracker.onContentApplied(documentChanged);
    scheduleFocusAssetDemandCheck(true);
}

export function recordFocusAssetResponse(message: FocusTreeSceneAssetsMessage): void {
    tracker.onResponse(message);
}

/** Called after an asset patch's rules and focus ids were applied. */
export function onFocusAssetsMaterialized(message: FocusTreeSceneAssetsMessage, applyMs: number): void {
    const focusIds = message.materializedFocusIds ?? [];
    assetsHaveBeenApplied = true;
    updateAssetPendingClasses(focusIds);
    // Real icons can be larger than placeholders; edges anchor to measured icon bounds.
    focusScene.scheduleMeasurement(focusIds.filter(focusId => focusScene.getWrapper(focusId) !== undefined));
    const stage = claimVisibleAssetsApplied() ? 'visibleAssetsApplied' : message.final ? 'sceneAssetsApplied' : undefined;
    if (stage) {
        postFocusTreeWebviewTiming({
            stage,
            snapshotVersion: message.snapshotVersion,
            documentVersion: message.documentVersion,
            source: 'assets',
            assetLoadMode: 'full',
            updateKind: 'assets',
            applyMs,
            rebuildMs: 0,
            rebindMs: 0,
        });
    }
}

/**
 * Schedules a demand check. Interaction-driven checks are debounced but run at least every
 * `checkMaxWaitMs` while the user keeps scrolling; `immediate` checks run on the next frame.
 */
export function scheduleFocusAssetDemandCheck(immediate = false): void {
    if (immediate) {
        if (checkTimer !== undefined) {
            clearTimeout(checkTimer);
            checkTimer = undefined;
        }
        firstCheckRequestedAt = undefined;
        checkFrame ??= requestAnimationFrame(() => {
            checkFrame = undefined;
            runFocusAssetDemandCheck();
        });
        return;
    }

    const now = performance.now();
    firstCheckRequestedAt ??= now;
    if (checkTimer !== undefined) {
        clearTimeout(checkTimer);
    }
    const delayMs = Math.max(0, Math.min(checkDebounceMs, firstCheckRequestedAt + checkMaxWaitMs - now));
    checkTimer = setTimeout(() => {
        checkTimer = undefined;
        firstCheckRequestedAt = undefined;
        runFocusAssetDemandCheck();
    }, delayMs);
}

function runFocusAssetDemandCheck(): void {
    const demand = getCurrentFocusAssetDemand();
    const readiness = getCurrentSceneAssetReadiness(demand);
    const tree = runtime.renderedFocusTree;
    if (demand && tree && !runtime.assetMaterialization.isDeferred()) {
        const request = tracker.createRequest(demand, {
            treeId: tree.id,
            documentVersion: runtime.focusPositionDocumentVersion,
            snapshotVersion: runtime.snapshotVersion,
        });
        if (request) {
            vscode.postMessage(request);
        }
        // Scrolling back to loaded focuses can complete the on-screen set without a new message.
        if (assetsHaveBeenApplied && claimVisibleAssetsApplied(readiness)) {
            postFocusTreeWebviewTiming({
                stage: 'visibleAssetsApplied',
                snapshotVersion: runtime.snapshotVersion,
                documentVersion: runtime.focusPositionDocumentVersion,
                source: 'assets',
                assetLoadMode: 'full',
                updateKind: 'assets',
                applyMs: 0,
                rebuildMs: 0,
                rebindMs: 0,
            });
        }
    }
    reportSceneReadiness(readiness);
    updateFocusAssetStatus(demand, readiness);
}

function updateFocusAssetStatus(demand: FocusAssetDemand | undefined, readiness: FocusSceneAssetReadiness): void {
    const status = document.getElementById('focus-asset-status');
    const text = document.getElementById('focus-asset-status-text');
    const retry = document.getElementById('focus-asset-retry') as HTMLButtonElement | null;
    const scene = document.getElementById('focustreeplaceholder');
    if (!status || !text || !retry) {
        return;
    }

    const pendingCount = demand?.visiblePendingCount ?? 0;
    const failedCount = demand?.visible.filter(focusId => tracker.isFailed(focusId)).length ?? 0;
    // Icons drawn as grey boxes are loaded attempts without an image, never loaded assets.
    const unavailableCount = readiness.visibleUnavailableCount;
    const state = pendingCount > 0
        ? failedCount > 0 ? 'failed' : 'loading'
        : unavailableCount > 0 ? 'failed' : 'idle';
    scene?.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    if (state === 'idle') {
        pendingStatusSince = undefined;
        clearStatusTimer();
        setStatusHidden(status, true);
        return;
    }

    // Short loads finish without flashing the status.
    const now = performance.now();
    pendingStatusSince ??= now;
    if (state === 'loading' && now - pendingStatusSince < statusDelayMs) {
        if (statusTimer === undefined) {
            statusTimer = setTimeout(() => {
                statusTimer = undefined;
                const currentDemand = getCurrentFocusAssetDemand();
                updateFocusAssetStatus(currentDemand, getCurrentSceneAssetReadiness(currentDemand));
            }, statusDelayMs - (now - pendingStatusSince));
        }
        return;
    }

    clearStatusTimer();
    const message = state === 'failed'
        ? feLocalize('focustree.assets.failed', 'Some focus icons could not be loaded.')
        : feLocalize('focustree.assets.loading', 'Loading focus icons: {0} of {1} on screen',
            (demand?.visibleCount ?? 0) - pendingCount, demand?.visibleCount ?? 0);
    if (text.textContent !== message) {
        text.textContent = message;
    }
    status.dataset.state = state;
    // Retrying helps failed requests; an image that could not be decoded needs a file change.
    retry.hidden = state !== 'failed' || failedCount === 0;
    const spinner = status.querySelector<HTMLElement>('.codicon');
    if (spinner) {
        spinner.hidden = state !== 'loading';
    }
    setStatusHidden(status, false);
}

function setStatusHidden(status: HTMLElement, hidden: boolean): void {
    if (status.hidden !== hidden) {
        status.hidden = hidden;
    }
}

function clearStatusTimer(): void {
    if (statusTimer !== undefined) {
        clearTimeout(statusTimer);
        statusTimer = undefined;
    }
}

/** Listens to every interaction that changes what is on screen. */
export function installFocusAssetLoading(): void {
    setFocusTreeAssetDiagnosticsProvider(() => {
        const epoch = sceneReadiness.current;
        return {
            ...getCurrentSceneAssetReadiness(),
            documentVersion: runtime.focusPositionDocumentVersion,
            snapshotVersion: runtime.snapshotVersion,
            requestPending: tracker.isRequestPending,
            sceneRenderedReported: epoch?.treeId === runtime.renderedFocusTree?.id && !!epoch?.renderedReported,
            sceneAssetsReadyReported: epoch?.treeId === runtime.renderedFocusTree?.id && !!epoch?.readyReported,
        };
    });
    const schedule = () => scheduleFocusAssetDemandCheck();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Wheel zoom and zoom keys change the scale without necessarily scrolling.
    window.addEventListener('wheel', schedule, { passive: true });
    window.addEventListener('keyup', event => {
        if (event.key === '+' || event.key === '=' || event.key === '-') {
            schedule();
        }
    });
    document.addEventListener('click', event => {
        if ((event.target as Element | null)?.closest?.('.preview-zoom-controls')) {
            schedule();
        }
    }, true);
    document.getElementById('focus-asset-retry')?.addEventListener('click', () => {
        tracker.retryFailed();
        scheduleFocusAssetDemandCheck(true);
    });
}
