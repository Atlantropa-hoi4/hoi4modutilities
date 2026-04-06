import { FocusConditionPresetsByTree } from "./conditionpresets";
import { FocusTreeRenderBaseState, FocusTreeRenderPayload, FocusTreeRenderPayloadBuildMetrics } from "./contentbuilder";
import { FocusTreeRenderCache } from "./renderpayloadpatch";
import { FocusTreeContentUpdateMessage } from "./webviewupdate";

export interface PendingBaseStatePromise {
    documentVersion: number;
    promise: Promise<FocusTreeRenderBaseState>;
}

export interface FocusTreeSnapshot {
    payload: FocusTreeRenderPayload;
    update: FocusTreeContentUpdateMessage;
    cache: FocusTreeRenderCache;
    metrics: FocusTreeRenderPayloadBuildMetrics;
}

export interface FocusTreePatchPlan {
    kind: 'full' | 'partial';
    update?: FocusTreeContentUpdateMessage;
    cache?: FocusTreeRenderCache;
    changedTreeCount?: number;
    changedFocusCount?: number;
    changedInlayCount?: number;
}

export interface FocusTreeRuntimeState {
    pendingLocalEditDocumentVersions: Set<number>;
    webviewReady: boolean;
    latestRefreshRequestId: number;
    lastRenderCache?: FocusTreeRenderCache;
    pendingReadyBaseState?: FocusTreeRenderBaseState;
    pendingReadyBaseStatePromise?: PendingBaseStatePromise;
    deferredHydrationDocumentVersion?: number;
}

export interface FocusTreeSelectionState {
    selectedFocusTreeIndex: number;
    selectedFocusTreeId?: string;
    selectedFocusIdsByTree: Record<string, string[]>;
    searchboxValue?: string;
    focusPositionEditMode: boolean;
}

export interface FocusTreeLocalEditResult {
    kind: 'noop' | 'optimistic' | 'structural';
    updatedDocumentVersion?: number;
}

export interface FocusTreeSnapshotInputs {
    documentVersion: number;
    conditionPresetsByTree: FocusConditionPresetsByTree;
}

export function createFocusTreeRuntimeState(): FocusTreeRuntimeState {
    return {
        pendingLocalEditDocumentVersions: new Set<number>(),
        webviewReady: false,
        latestRefreshRequestId: 0,
    };
}

export function resetFocusTreeRuntimeState(state: FocusTreeRuntimeState): void {
    state.webviewReady = false;
    state.lastRenderCache = undefined;
    state.pendingReadyBaseState = undefined;
    state.pendingReadyBaseStatePromise = undefined;
    state.deferredHydrationDocumentVersion = undefined;
}

export function beginFocusTreeRefresh(state: FocusTreeRuntimeState): number {
    state.latestRefreshRequestId += 1;
    return state.latestRefreshRequestId;
}

export function isCurrentFocusTreeRefresh(state: FocusTreeRuntimeState, requestId: number): boolean {
    return requestId === state.latestRefreshRequestId;
}

export function consumePendingLocalEditVersion(
    state: FocusTreeRuntimeState,
    documentVersion: number,
): boolean {
    return state.pendingLocalEditDocumentVersions.delete(documentVersion);
}

export function recordPendingLocalEditVersion(
    state: FocusTreeRuntimeState,
    documentVersion: number | undefined,
): void {
    if (documentVersion === undefined) {
        return;
    }

    state.pendingLocalEditDocumentVersions.add(documentVersion);
}

export function consumePendingReadyBaseState(
    state: FocusTreeRuntimeState,
    documentVersion: number,
): FocusTreeRenderBaseState | undefined {
    if (state.pendingReadyBaseState?.focusPositionDocumentVersion !== documentVersion) {
        return undefined;
    }

    const cached = state.pendingReadyBaseState;
    state.pendingReadyBaseState = undefined;
    return cached;
}

export function storePendingReadyBaseState(
    state: FocusTreeRuntimeState,
    baseState: FocusTreeRenderBaseState | undefined,
): void {
    state.pendingReadyBaseState = baseState;
}

export function storePendingReadyBaseStatePromise(
    state: FocusTreeRuntimeState,
    pending: PendingBaseStatePromise | undefined,
): void {
    state.pendingReadyBaseStatePromise = pending;
}

export function consumePendingReadyBaseStatePromise(
    state: FocusTreeRuntimeState,
    documentVersion: number,
): Promise<FocusTreeRenderBaseState> | undefined {
    if (state.pendingReadyBaseStatePromise?.documentVersion !== documentVersion) {
        return undefined;
    }

    const pendingPromise = state.pendingReadyBaseStatePromise.promise;
    state.pendingReadyBaseStatePromise = undefined;
    return pendingPromise;
}

export function markFocusTreeWebviewReady(state: FocusTreeRuntimeState): void {
    state.webviewReady = true;
}

export function clearFocusTreeWebviewReady(state: FocusTreeRuntimeState): void {
    state.webviewReady = false;
}
