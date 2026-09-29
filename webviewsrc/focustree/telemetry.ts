import { focusTreeProtocolVersion, FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import type { FocusTreeContentUpdateMessage } from '../../src/previewdef/focustree/webviewupdate';
import { currentScale } from '../util/common';
import { vscode } from '../util/vscode';
import { runtime } from './runtime';
import { focusScene } from './scenestore';
import { getCurrentFocusTree } from './selection';

type FocusTreeWebviewTiming = {
    stage: string;
    snapshotVersion?: number;
    documentVersion?: number;
    changedSlots?: string[];
    source?: string;
    assetLoadMode?: string;
    updateKind?: string;
    payloadBytes?: number;
    applyMs?: number;
    rebuildMs?: number;
    rebindMs?: number;
    sinceLoadMs?: number;
    timestamp: number;
};

type ContentTimings = { applyMs: number; rebuildMs: number; rebindMs: number };

const focusTreeWebviewLoadStartedAt = performance.now();
let firstFocusTreeContentApplied = false;
let firstFocusTreeHydrationApplied = false;

export function postFocusTreeDiagnostics(
    stage: string,
    options?: {
        focusTree?: FocusTreeView;
        focusGridBoxItemCount?: number;
        renderedFocusHitCount?: number;
    },
): void {
    const selectorElement = document.getElementById('focuses') as HTMLSelectElement | null;
    const focusTree = options?.focusTree ?? runtime.renderedFocusTree;
    const snapshot = {
        stage,
        previewedFileUri: window.previewedFileUri,
        focusTreeCount: runtime.focusTrees.length,
        selectedFocusTreeIndex: runtime.selectedFocusTreeIndex,
        selectedFocusTreeId: runtime.selectedFocusTreeId,
        currentFocusTreeId: focusTree?.id,
        selectorValue: selectorElement?.value,
        selectorOptionCount: selectorElement?.options?.length ?? 0,
        selectorSelectedText: selectorElement?.selectedOptions?.[0]?.text,
        focusCount: Object.keys(focusTree?.focuses ?? {}).length,
        focusGridBoxItemCount: options?.focusGridBoxItemCount ?? 0,
        renderedFocusHitCount: options?.renderedFocusHitCount ?? 0,
        selectedExprCount: runtime.selectedExprs.length,
        currentCanvasWidth: focusScene.currentGeometry?.width ?? 1,
        currentCanvasHeight: focusScene.currentGeometry?.height ?? 1,
        currentGridLeftPadding: runtime.gridLeftPadding,
        currentGridTopPadding: runtime.gridTopPadding,
        timestamp: Date.now(),
    };

    if (window.focusTreeTraceEnabled) {
        console.debug('[focustree] diagnostics', snapshot);
    }

    vscode.postMessage({ command: 'focusTreeDiagnostics', snapshot });
}

export function postFocusTreeWebviewTiming(timing: Omit<FocusTreeWebviewTiming, 'sinceLoadMs' | 'timestamp'>): void {
    const event: FocusTreeWebviewTiming = {
        ...timing,
        sinceLoadMs: Math.round(performance.now() - focusTreeWebviewLoadStartedAt),
        timestamp: Date.now(),
    };

    if (window.focusTreeTraceEnabled) {
        console.debug('[focustree] webview timings', event);
    }

    vscode.postMessage({ command: 'focusTreeWebviewTiming', timing: event });
}

export function createFocusTreeContentTiming(
    stage: string,
    message: FocusTreeContentUpdateMessage,
    timings: ContentTimings,
): Omit<FocusTreeWebviewTiming, 'sinceLoadMs' | 'timestamp'> {
    return {
        stage,
        snapshotVersion: message.snapshotVersion,
        documentVersion: message.documentVersion,
        changedSlots: message.changedSlots,
        source: message.perf?.source,
        assetLoadMode: message.perf?.assetLoadMode,
        updateKind: message.perf?.updateKind,
        payloadBytes: message.perf?.payloadBytes,
        ...timings,
    };
}

function getContentAppliedTimingStage(message: FocusTreeContentUpdateMessage): string {
    if (!firstFocusTreeContentApplied) {
        firstFocusTreeContentApplied = true;
        return 'firstScenePainted';
    }

    if (!firstFocusTreeHydrationApplied && message.perf?.assetLoadMode === 'full') {
        firstFocusTreeHydrationApplied = true;
        return 'visibleAssetsApplied';
    }

    return 'contentUpdated';
}

/** Reports the painted scene; the first report starts host-side asset hydration. */
export function postFocusTreeContentApplied(message: FocusTreeContentUpdateMessage, timings: ContentTimings): void {
    const stage = getContentAppliedTimingStage(message);
    const postApplied = () => {
        postFocusTreeWebviewTiming(createFocusTreeContentTiming(stage, message, timings));
        const visibleFocusIds = focusScene.getVisibleFocusIds();
        const currentTree = getCurrentFocusTree();
        const priorityAssetKeys = new Set<string>();
        for (const focusId of visibleFocusIds) {
            for (const option of currentTree?.focuses[focusId]?.icon ?? []) {
                if (option.icon) {
                    priorityAssetKeys.add(option.icon);
                }
            }
        }
        vscode.postMessage({
            command: 'focusTreeScenePainted',
            protocolVersion: focusTreeProtocolVersion,
            requestId: message.requestId,
            snapshotVersion: message.snapshotVersion,
            documentVersion: message.documentVersion,
            sceneRevision: message.sceneRevision ?? message.snapshotVersion,
            treeId: currentTree?.id ?? message.treeId ?? '',
            stage,
            viewport: {
                x: window.scrollX,
                y: window.scrollY,
                width: window.innerWidth,
                height: window.innerHeight,
                scale: currentScale(),
            },
            visibleFocusIds,
            priorityAssetKeys: Array.from(priorityAssetKeys),
        });
    };
    if (stage === 'firstScenePainted') {
        requestAnimationFrame(() => requestAnimationFrame(postApplied));
    } else {
        postApplied();
    }
}

export function postFocusTreeWebviewReady(): void {
    postFocusTreeWebviewTiming({ stage: 'webviewReady' });
    vscode.postMessage({
        command: 'focusTreeWebviewReady',
        protocolVersion: focusTreeProtocolVersion,
        snapshotVersion: runtime.snapshotVersion,
        documentVersion: runtime.focusPositionDocumentVersion,
        selectedTreeId: runtime.selectedFocusTreeId,
        viewport: {
            x: window.scrollX,
            y: window.scrollY,
            width: window.innerWidth,
            height: window.innerHeight,
            scale: currentScale(),
        },
    });
}
