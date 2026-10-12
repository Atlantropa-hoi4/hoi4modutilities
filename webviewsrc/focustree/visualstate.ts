import type { FocusEdgeGeometry } from '../../src/previewdef/focustree/scenegeometry';
import { getState, setState } from '../util/common';
import { hasPendingFocusLink, runtime } from './runtime';
import type { FocusScene } from './scene';

// Interaction state is expressed with classes and body attributes that the shell stylesheet
// maps to cursors, outlines, and dimming. Updates touch only the nodes whose state changed.
let scene: FocusScene | undefined;
let relatedFocusIds = new Set<string>();
let relatedEdgeIds = new Set<string>();
let linkParentFocusIds = new Set<string>();
let hiddenBranches: Record<string, boolean> = normalizeHiddenBranches(getState().hiddenBranches);

// Earlier versions persisted hidden branches as an array of class names.
function normalizeHiddenBranches(value: unknown): Record<string, boolean> {
    if (Array.isArray(value)) {
        return Object.fromEntries(value.filter((item): item is string => typeof item === 'string').map(item => [item, true]));
    }
    return value && typeof value === 'object' ? { ...value as Record<string, boolean> } : {};
}

export function bindFocusVisualState(focusScene: FocusScene): void {
    scene = focusScene;
}

export function applyFocusNodeVisualState(focusId: string, wrapper: HTMLElement, card: HTMLElement): void {
    toggleClass(card, 'focus-selected', runtime.selectedFocusIds.has(focusId));
    toggleClass(card, 'focus-link-parent', linkParentFocusIds.has(focusId));
    toggleClass(card, 'focus-related', relatedFocusIds.has(focusId));
    toggleClass(card, 'focus-filter-miss', !runtime.searchFilterMatchIds.has(focusId));
    toggleClass(wrapper, 'focus-search-match', runtime.searchResultIds.has(focusId));
    toggleClass(wrapper, 'focus-branch-hidden', isInHiddenBranch(wrapper));
    toggleClass(card, 'focus-asset-pending', runtime.assetMaterialization.isPending(focusId));
}

/** Marks cards whose icons are still placeholders; `focusIds` limits the update when known. */
export function updateAssetPendingClasses(focusIds?: Iterable<string>): void {
    if (!focusIds) {
        scene?.forEachCard((card, focusId) => toggleClass(card, 'focus-asset-pending', runtime.assetMaterialization.isPending(focusId)));
        return;
    }
    for (const focusId of focusIds) {
        const card = scene?.getCard(focusId);
        if (card) {
            toggleClass(card, 'focus-asset-pending', runtime.assetMaterialization.isPending(focusId));
        }
    }
}

export function applyFocusEdgeVisualState(edge: FocusEdgeGeometry, element: SVGPathElement): void {
    toggleClass(element, 'focus-related-edge', relatedEdgeIds.has(edge.id));
    toggleClass(element, 'focus-branch-hidden', isInHiddenBranch(element));
}

export function updateSelectionClasses(focusIds: Iterable<string>): void {
    for (const focusId of focusIds) {
        const card = scene?.getCard(focusId);
        if (card) {
            toggleClass(card, 'focus-selected', runtime.selectedFocusIds.has(focusId));
        }
    }
}

export function updateSearchMatchClasses(focusIds: Iterable<string>): void {
    for (const focusId of focusIds) {
        const wrapper = scene?.getWrapper(focusId);
        if (wrapper) {
            toggleClass(wrapper, 'focus-search-match', runtime.searchResultIds.has(focusId));
        }
    }
}

export function updateFilterClasses(focusIds: Iterable<string>): void {
    for (const focusId of focusIds) {
        const card = scene?.getCard(focusId);
        if (card) {
            toggleClass(card, 'focus-filter-miss', !runtime.searchFilterMatchIds.has(focusId));
        }
    }
}

let pendingHoverClearFrame: number | undefined;

/**
 * Moving between cards fires mouseout before mouseover, so clearing is deferred by a frame: the
 * transition then swaps highlight classes instead of toggling the scene-wide dimming twice.
 */
export function setHoveredRelationFocusId(focusId: string | undefined): void {
    if (focusId === undefined && runtime.hoveredRelationFocusId !== undefined) {
        pendingHoverClearFrame ??= requestAnimationFrame(() => {
            pendingHoverClearFrame = undefined;
            applyHoveredRelationFocusId(undefined);
        });
        return;
    }
    if (pendingHoverClearFrame !== undefined) {
        cancelAnimationFrame(pendingHoverClearFrame);
        pendingHoverClearFrame = undefined;
    }
    applyHoveredRelationFocusId(focusId);
}

function applyHoveredRelationFocusId(focusId: string | undefined): void {
    if (runtime.hoveredRelationFocusId === focusId) {
        return;
    }
    runtime.hoveredRelationFocusId = focusId;
    refreshHoverRelations();
}

/** Highlights the hovered focus, its direct relations, and edges between them. */
export function refreshHoverRelations(): void {
    const hoveredFocusId = runtime.hoveredRelationFocusId;
    const nextRelated = hoveredFocusId && !hasPendingFocusLink()
        ? new Set(runtime.relatedFocusIdsById[hoveredFocusId] ?? [])
        : new Set<string>();
    const nextRelatedEdges = new Set<string>();
    for (const focusId of nextRelated) {
        for (const edge of scene?.getAdjacentEdges(focusId) ?? []) {
            if (nextRelated.has(edge.sourceId) && nextRelated.has(edge.targetId)) {
                nextRelatedEdges.add(edge.id);
            }
        }
    }

    for (const focusId of symmetricDifference(relatedFocusIds, nextRelated)) {
        const card = scene?.getCard(focusId);
        if (card) {
            toggleClass(card, 'focus-related', nextRelated.has(focusId));
        }
    }
    for (const edgeId of symmetricDifference(relatedEdgeIds, nextRelatedEdges)) {
        const element = scene?.getEdgeElement(edgeId);
        if (element) {
            toggleClass(element, 'focus-related-edge', nextRelatedEdges.has(edgeId));
        }
    }
    relatedFocusIds = nextRelated;
    relatedEdgeIds = nextRelatedEdges;
    setBodyData('focusHover', nextRelated.size > 0 ? 'true' : 'false');
}

export function refreshLinkParentState(): void {
    const next = hasPendingFocusLink() ? new Set(runtime.pendingFocusLinkParentIds) : new Set<string>();
    for (const focusId of symmetricDifference(linkParentFocusIds, next)) {
        const card = scene?.getCard(focusId);
        if (card) {
            toggleClass(card, 'focus-link-parent', next.has(focusId));
        }
    }
    linkParentFocusIds = next;
    setBodyData('focusLinkType', hasPendingFocusLink() ? runtime.pendingFocusLinkType ?? '' : '');
    refreshHoverRelations();
}

export function refreshFocusEditControls(): void {
    const editMode = runtime.focusPositionEditMode;
    setBodyData('focusEditMode', editMode ? 'true' : 'false');
    const editButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    if (editButton) {
        editButton.disabled = runtime.activeFocusEditRequestId !== undefined;
        editButton.setAttribute('aria-pressed', editMode ? 'true' : 'false');
        editButton.style.color = editMode ? 'var(--vscode-focusBorder)' : '';
        editButton.style.background = editMode ? 'rgba(32, 124, 229, 0.14)' : '';
        editButton.style.borderRadius = editMode ? '3px' : '';
    }

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    if (continuousFocusElement) {
        const editable = editMode && isContinuousFocusEditable();
        continuousFocusElement.style.cursor = editable ? 'grab' : 'default';
        continuousFocusElement.style.pointerEvents = editable ? 'auto' : 'none';
        continuousFocusElement.style.boxShadow = editable ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset' : '';
    }
}

export function isContinuousFocusEditable(focusTree = runtime.renderedFocusTree): boolean {
    return !!focusTree
        && focusTree.kind === 'focus'
        && !!focusTree.continuousLayout?.editable
        && focusTree.continuousLayout.sourceFile === runtime.focusPositionActiveFile;
}

export function getHiddenBranches(): Readonly<Record<string, boolean>> {
    return hiddenBranches;
}

export function isHiddenBranchClass(className: string): boolean {
    return !!hiddenBranches[className];
}

/** Shows or hides every node and edge in an allow-branch class. */
export function setBranchVisibility(visible: boolean, branchClass: string): void {
    const nextHiddenBranches = { ...hiddenBranches };
    if (visible) {
        delete nextHiddenBranches[branchClass];
    } else {
        nextHiddenBranches[branchClass] = true;
    }
    hiddenBranches = nextHiddenBranches;
    setState({ hiddenBranches });

    const elements = document.getElementsByClassName(branchClass);
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index] as HTMLElement;
        toggleClass(element, 'focus-branch-hidden', isInHiddenBranch(element));
    }
}

export function isFocusBranchHidden(element: Element): boolean {
    return element.classList.contains('focus-branch-hidden');
}

function isInHiddenBranch(element: Element): boolean {
    for (const className of Array.from(element.classList)) {
        if (hiddenBranches[className]) {
            return true;
        }
    }
    return false;
}

function toggleClass(element: Element, className: string, enabled: boolean): void {
    if (element.classList.contains(className) !== enabled) {
        element.classList.toggle(className, enabled);
    }
}

function setBodyData(key: 'focusHover' | 'focusLinkType' | 'focusEditMode', value: string): void {
    if (document.body.dataset[key] !== value) {
        document.body.dataset[key] = value;
    }
}

function* symmetricDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): Iterable<string> {
    for (const value of left) {
        if (!right.has(value)) {
            yield value;
        }
    }
    for (const value of right) {
        if (!left.has(value)) {
            yield value;
        }
    }
}
