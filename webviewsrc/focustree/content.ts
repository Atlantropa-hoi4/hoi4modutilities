import type { NumberPosition } from '../../src/util/common';
import type { GridBoxType } from '../../src/hoiformat/gui';
import type { GridBoxItem } from '../../src/util/hoi4gui/gridboxcommon';
import { shouldHideDisallowedFocuses } from '../../src/previewdef/focustree/conditionselection';
import { resolveFocusTreeLayoutPlan } from '../../src/previewdef/focustree/layoutplan';
import type { FocusSceneGeometryOptions, FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';
import { getFocusTreeViewportAnchorId } from '../../src/previewdef/focustree/viewanchor';
import type { FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import { currentScale, getState, runSafely, scrollToState, setState, tryRun } from '../util/common';
import { setFocusCardChecked } from './cards';
import {
    clearSelectedExprs,
    exprKeyToConditionItem,
    getCheckedFocusConditionExprs,
    getImplicitRenderExprKeysForFocusTree,
    getSelectedExprKeysForFocusTree,
} from './conditions';
import { refreshInlayWindowSelector, updateInlayWindowPlaceholder } from './inlays';
import {
    getSearchText,
    hasPendingFocusLink,
    rebuildRelationIndex,
    runtime,
    setFocusPositions,
} from './runtime';
import { focusScene } from './scenestore';
import { retriggerSearch } from './search';
import { getCurrentFocusTree, syncCurrentSelectedFocusIds } from './selection';
import { postFocusTreeDiagnostics } from './telemetry';
import {
    refreshFocusEditControls,
    refreshHoverRelations,
    refreshLinkParentState,
    updateFilterClasses,
} from './visualstate';

const continuousFocusLeftAnchorOffset = 59;
const continuousFocusTopAnchorOffset = 7;
const focusCreateSidePaddingColumns = 4;
const focusCreateTopPaddingRows = 4;
const focusCreateRightPaddingColumns = 4;
const focusCreateBottomPaddingRows = 4;
const focusCreateMinimumColumns = 6;
const focusCreateMinimumRows = 6;

export interface BuildContentOptions {
    /** Discards retained nodes instead of reconciling them. */
    reset?: boolean;
    /** Prioritizes the viewport that the persisted scroll position will reveal. */
    restoreScroll?: boolean;
}

function getFocusSceneGeometryOptions(items: readonly GridBoxItem[]): FocusSceneGeometryOptions {
    const gridbox: GridBoxType = window.gridBox;
    const { xGridSize, yGridSize } = runtime;
    return {
        items,
        slotSize: { width: xGridSize, height: yGridSize },
        format: gridbox.format?._name ?? 'up',
        padding: {
            left: (gridbox.position.x._value ?? 0) + focusCreateSidePaddingColumns * xGridSize,
            top: (gridbox.position.y._value ?? 0) + focusCreateTopPaddingRows * yGridSize,
            right: focusCreateRightPaddingColumns * xGridSize,
            bottom: focusCreateBottomPaddingRows * yGridSize,
        },
        minimumSize: {
            width: focusCreateMinimumColumns * xGridSize,
            height: focusCreateMinimumRows * yGridSize,
        },
    };
}

function getContinuousFocusDisplayPositionFromStored(x: number, y: number): NumberPosition {
    return {
        x: runtime.gridLeftPadding + x - continuousFocusLeftAnchorOffset,
        y: runtime.gridTopPadding + y + continuousFocusTopAnchorOffset,
    };
}

export function getContinuousFocusStoredPositionFromDisplay(left: number, top: number): NumberPosition {
    return {
        x: left - runtime.gridLeftPadding + continuousFocusLeftAnchorOffset,
        y: top - runtime.gridTopPadding - continuousFocusTopAnchorOffset,
    };
}

export function applyContinuousFocusElementPosition(focusTree: FocusTreeView | undefined): void {
    const continuousFocuses = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    if (!continuousFocuses) {
        return;
    }

    if (focusTree?.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        const displayPosition = getContinuousFocusDisplayPositionFromStored(
            focusTree.continuousFocusPositionX,
            focusTree.continuousFocusPositionY,
        );
        continuousFocuses.style.left = `${displayPosition.x}px`;
        continuousFocuses.style.top = `${displayPosition.y}px`;
        continuousFocuses.style.display = 'block';
    } else {
        continuousFocuses.style.display = 'none';
    }
}

function computeSearchFilterMatchIds(focusTree: FocusTreeView): Set<string> {
    const filters = runtime.selectedSearchFilters;
    const matches = new Set<string>();
    for (const focus of Object.values(focusTree.focuses)) {
        if (filters.length === 0 || filters.some(filter => focus.searchFilters.includes(filter))) {
            matches.add(focus.id);
        }
    }
    return matches;
}

export function applySearchFilters(): void {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }
    const previous = runtime.searchFilterMatchIds;
    runtime.searchFilterMatchIds = computeSearchFilterMatchIds(focusTree);
    const changed = new Set<string>();
    previous.forEach(focusId => {
        if (!runtime.searchFilterMatchIds.has(focusId)) {
            changed.add(focusId);
        }
    });
    runtime.searchFilterMatchIds.forEach(focusId => {
        if (!previous.has(focusId)) {
            changed.add(focusId);
        }
    });
    updateFilterClasses(changed);
}

/** Visible page area in scene coordinates. */
function getSceneViewport(restoreScroll: boolean): FocusSceneRect | undefined {
    const content = document.getElementById('focustreecontent');
    if (!content) {
        return undefined;
    }
    const state = getState();
    const scale = currentScale();
    const scrollX = restoreScroll ? state.xOffset || 0 : window.scrollX;
    const scrollY = restoreScroll ? state.yOffset || 0 : window.scrollY;
    const rect = content.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
        x: (scrollX - (rect.left + window.scrollX)) / scale,
        y: (scrollY + runtime.focusToolbarHeight - (rect.top + window.scrollY)) / scale,
        width: viewportWidth / scale,
        height: Math.max(viewportHeight - runtime.focusToolbarHeight, 0) / scale,
    };
}

/**
 * Renders the selected tree. Consecutive renders of one tree reconcile the retained scene, so
 * edits, patches, and asset hydration only touch the focuses and edges they changed.
 */
export async function buildContent(options?: BuildContentOptions): Promise<boolean> {
    runtime.cancelActiveFocusPositionDrag?.();
    const buildVersion = runtime.contentBuildGuard.start();
    const checkedFocusesExprs = getCheckedFocusConditionExprs();
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    const placeholder = document.getElementById('focustreeplaceholder') as HTMLDivElement | null;
    const focusTree = getCurrentFocusTree();
    if (!focusTree || !contentElement || !placeholder) {
        return false;
    }

    const explicitSelectedExprKeys = getSelectedExprKeysForFocusTree(focusTree);
    const renderSelectedExprKeys = explicitSelectedExprKeys.length > 0
        ? explicitSelectedExprKeys
        : getImplicitRenderExprKeysForFocusTree(focusTree, checkedFocusesExprs);
    const resolvedLayoutPlan = resolveFocusTreeLayoutPlan(
        focusTree,
        checkedFocusesExprs,
        renderSelectedExprKeys.map(exprKeyToConditionItem),
        shouldHideDisallowedFocuses(runtime.useConditionInFocus, renderSelectedExprKeys),
    );
    const renderExprs = resolvedLayoutPlan.renderExprs;
    const layoutPlan = resolvedLayoutPlan.layoutPlan;
    if (resolvedLayoutPlan.clearedSelectedExprs && explicitSelectedExprKeys.length > 0) {
        clearSelectedExprs(focusTree);
    }

    if (!runtime.contentBuildGuard.isCurrent(buildVersion)) {
        return false;
    }

    const treeChanged = runtime.renderedFocusTree?.id !== focusTree.id;
    runtime.completableFocusIds = layoutPlan.completableFocusIds;
    runtime.renderedFocusTree = focusTree;
    rebuildRelationIndex(focusTree);
    if (hasPendingFocusLink() && !focusTree.focuses[runtime.pendingFocusLinkParentId!]) {
        runtime.pendingFocusLinkParentId = undefined;
        runtime.pendingFocusLinkParentIds = [];
        runtime.pendingFocusLinkType = undefined;
        document.getElementById('focus-link-overlay')?.style.setProperty('display', 'none');
    }
    if (runtime.hoveredRelationFocusId && !focusTree.focuses[runtime.hoveredRelationFocusId]) {
        runtime.hoveredRelationFocusId = undefined;
    }
    syncCurrentSelectedFocusIds();
    setFocusPositions({ ...layoutPlan.focusPosition });
    runtime.renderedExprs = renderExprs;
    runtime.searchTextByFocusId = Object.fromEntries(Object.values(focusTree.focuses)
        .map(focus => [focus.id, getSearchText(focus.id, focus.displayName)]));
    runtime.searchFilterMatchIds = computeSearchFilterMatchIds(focusTree);
    if (treeChanged) {
        runtime.searchResultIds = new Set();
    }

    const anchorFocusId = getFocusTreeViewportAnchorId(runtime.focusPositions, Array.from(runtime.selectedFocusIds));
    const priorityFocusIds = new Set<string>([...(anchorFocusId ? [anchorFocusId] : []), ...runtime.selectedFocusIds]);
    for (const focusId of Array.from(priorityFocusIds)) {
        runtime.relatedFocusIdsById[focusId]?.forEach(relatedFocusId => priorityFocusIds.add(relatedFocusId));
    }
    const { focusTemplates, focusTemplateKeyById } = runtime;
    const checkedFocuses: Record<string, boolean> = getState().checkedFocuses ?? {};
    const activeFile = runtime.focusPositionActiveFile;
    const completableFocusIds = runtime.completableFocusIds;
    const result = focusScene.render(placeholder, {
        treeId: focusTree.id,
        items: layoutPlan.focusGridBoxItems,
        positions: runtime.focusPositions,
        geometryOptions: getFocusSceneGeometryOptions(layoutPlan.focusGridBoxItems),
        getCardInput: focusId => {
            const focus = focusTree.focuses[focusId];
            return focus && {
                focus,
                template: focusTemplates[focusTemplateKeyById[focusId]],
                exprs: renderExprs,
                activeFile,
                completable: completableFocusIds.has(focusId),
                labelMode: document.body.dataset.previewLabelMode === 'name' ? 'name' : 'id',
            };
        },
        isChecked: focusId => !!checkedFocuses[focusId],
        priorityFocusIds,
        anchorFocusId,
        viewport: getSceneViewport(!!options?.restoreScroll),
        reset: treeChanged || options?.reset,
    });

    const geometry = result.geometry;
    runtime.gridLeftPadding = geometry.origin.x;
    runtime.gridTopPadding = geometry.origin.y;
    placeholder.style.minWidth = `${geometry.width}px`;
    contentElement.style.minWidth = `${geometry.width}px`;
    placeholder.style.minHeight = `${geometry.height}px`;
    contentElement.style.minHeight = `${geometry.height}px`;
    applyContinuousFocusElementPosition(focusTree);
    if (!result.reset) {
        updateFilterClasses(focusScene.mountedFocusIds());
    }
    refreshLinkParentState();
    refreshHoverRelations();
    refreshInlayWindowSelector(focusTree, renderExprs);
    updateInlayWindowPlaceholder(focusTree, renderExprs);
    refreshFocusEditControls();
    postFocusTreeDiagnostics('buildContent', {
        focusTree,
        focusGridBoxItemCount: layoutPlan.focusGridBoxItems.length,
        renderedFocusHitCount: result.mountedCount,
    });
    return true;
}

function getFocusViewportScrollTarget(anchorPosition: NumberPosition): { left: number; top: number } {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const { xGridSize, yGridSize, focusToolbarHeight } = runtime;
    const focusLeft = runtime.gridLeftPadding + anchorPosition.x * xGridSize;
    const focusTop = runtime.gridTopPadding + anchorPosition.y * yGridSize;
    return {
        left: Math.max(0, focusLeft - Math.max((viewportWidth - xGridSize) / 2, 0)),
        top: Math.max(0, focusTop - focusToolbarHeight - Math.max((viewportHeight - focusToolbarHeight - yGridSize) / 2, 0)),
    };
}

/** Scrolls to the tree's anchor focus when no focus of the scene is on screen. */
function revealCurrentFocusTreeAnchorIfNeeded(): void {
    const anchorFocusId = getFocusTreeViewportAnchorId(runtime.focusPositions, Array.from(runtime.selectedFocusIds));
    const anchorPosition = anchorFocusId ? runtime.focusPositions[anchorFocusId] : undefined;
    if (!anchorPosition) {
        return;
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (focusScene.getVisibleFocusIds(false).length > 0) {
            return;
        }
        const target = getFocusViewportScrollTarget(anchorPosition);
        window.scrollTo({ left: target.left, top: target.top, behavior: 'auto' });
    }));
}

export const rebuildContentSafely = tryRun(async (options?: BuildContentOptions) => {
    const applied = await buildContent(options);
    if (!applied) {
        return;
    }
    if (options?.restoreScroll) {
        scrollToState();
    }
    revealCurrentFocusTreeAnchorIfNeeded();
    retriggerSearch();
});

/** Toggles completion checkboxes, which change `has_completed_focus` conditions. */
export function subscribeFocusCheckboxDelegation(root: HTMLElement): void {
    if (root.dataset.focusCheckboxDelegated === 'true') {
        return;
    }
    root.dataset.focusCheckboxDelegated = 'true';

    const toggleCheckbox = (container: HTMLElement) => {
        const input = container.parentElement?.previousElementSibling as HTMLInputElement | null;
        if (!input || input.type !== 'checkbox' || !input.dataset.focusCheckboxId) {
            return;
        }
        input.checked = !input.checked;
        container.setAttribute('aria-checked', input.checked.toString());
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    root.addEventListener('click', event => {
        const container = (event.target as Element | null)?.closest<HTMLElement>('.checkbox-container');
        if (!container || !root.contains(container)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        toggleCheckbox(container);
    });
    root.addEventListener('keydown', event => {
        if (event.code !== 'Enter' && event.code !== 'Space') {
            return;
        }
        const container = (event.target as Element | null)?.closest<HTMLElement>('.checkbox-container');
        if (!container || !root.contains(container)) {
            return;
        }
        event.preventDefault();
        toggleCheckbox(container);
    });
    root.addEventListener('change', runSafely(async event => {
        const checkbox = event.target as HTMLInputElement | null;
        const focusId = checkbox?.dataset.focusCheckboxId;
        const focus = focusId ? getCurrentFocusTree()?.focuses[focusId] : undefined;
        if (!checkbox || !focusId || !focus) {
            return;
        }

        const focusCheckState: Record<string, boolean> = { ...getState().checkedFocuses };
        if (checkbox.checked) {
            for (const exclusiveFocusId of focus.exclusive) {
                if (focusCheckState[exclusiveFocusId]) {
                    focusCheckState[exclusiveFocusId] = false;
                    const exclusiveCard = focusScene.getCard(exclusiveFocusId);
                    if (exclusiveCard) {
                        setFocusCardChecked(exclusiveCard, false);
                    }
                }
            }
        }
        focusCheckState[focusId] = checkbox.checked;
        setState({ checkedFocuses: focusCheckState });

        // The input itself is hidden; keep its visible checkbox under the pointer across relayout.
        const rect = (checkbox.nextElementSibling ?? checkbox).getBoundingClientRect();
        const applied = await buildContent();
        if (!applied) {
            return;
        }
        const nextCheckbox = focusScene.getCard(focusId)?.querySelector<HTMLInputElement>('input[data-focus-checkbox-id]');
        if (nextCheckbox) {
            const nextRect = (nextCheckbox.nextElementSibling ?? nextCheckbox).getBoundingClientRect();
            window.scrollBy(nextRect.left - rect.left, nextRect.top - rect.top);
        }
        retriggerSearch();
    }));
}
