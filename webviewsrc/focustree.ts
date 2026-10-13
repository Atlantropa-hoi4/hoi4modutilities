import { enableZoom, runSafely, subscribeNavigatorDelegation, subscribePreviewLabelToggle, subscribeRefreshButton } from './util/common';
import { installFocusAssetLoading } from './focustree/assetloading';
import { rebuildContentSafely, refreshFocusCompletionLabels, subscribeFocusCheckboxDelegation } from './focustree/content';
import { installFocusEditing } from './focustree/editing';
import { handleHostMessage } from './focustree/hostsync';
import { getFocusNavigationTarget } from './focustree/navigation';
import { initializeFocusPresentation } from './focustree/presentation';
import { runtime } from './focustree/runtime';
import { focusScene, setSceneMaterializedListener } from './focustree/scenestore';
import { getCurrentFocusTree } from './focustree/selection';
import { postFocusTreeDiagnostics, postFocusTreeWebviewReady, postFocusTreeWebviewTiming } from './focustree/telemetry';
import { installToolbar, updateSelectedFocusTree } from './focustree/toolbar';

window.addEventListener('load', runSafely(async function() {
    postFocusTreeWebviewTiming({ stage: 'load' });
    subscribePreviewLabelToggle('id');
    // Runs after the shared toggle switched the label mode: checkbox names follow the labels.
    document.querySelectorAll('[data-preview-label-mode-value]').forEach(control => {
        control.addEventListener('click', refreshFocusCompletionLabels);
    });
    initializeFocusPresentation(() => focusScene.measureAllMounted());
    setSceneMaterializedListener(() => postFocusTreeDiagnostics('sceneMaterialized', {
        focusGridBoxItemCount: Object.keys(runtime.focusPositions).length,
        renderedFocusHitCount: Array.from(focusScene.mountedFocusIds()).length,
    }));
    window.addEventListener('message', handleHostMessage);

    try {
        installFocusEditing();
        installToolbar();
        installFocusAssetLoading();

        const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
        subscribeNavigatorDelegation(contentElement, navigator => navigator.dataset.focusId !== undefined
            ? getFocusNavigationTarget(navigator)
            : undefined);
        subscribeFocusCheckboxDelegation(contentElement);
        enableZoom(contentElement, 0, runtime.focusToolbarHeight);
        subscribeRefreshButton();

        updateSelectedFocusTree(false);
        postFocusTreeDiagnostics('load', { focusTree: getCurrentFocusTree() });
        await rebuildContentSafely({ restoreScroll: true });
    } finally {
        postFocusTreeWebviewReady();
    }
}));
