import type { NumberPosition } from '../../src/util/common';
import {
    getScaledFocusDragDelta,
    getSnappedFocusDragPosition,
    hasFocusDragPassedThreshold,
} from '../../src/previewdef/focustree/draginteraction';
import { invalidateCachedFocusTreeLayoutPlan } from '../../src/previewdef/focustree/layoutplan';
import { applyLocalFocusDeletion, createPlaceholderFocus } from '../../src/previewdef/focustree/localpreview';
import { getLocalPositionFromRenderedAbsolute } from '../../src/previewdef/focustree/positioning';
import { normalizeParentFocusIds, updatePrerequisiteGroupsAfterLinkApply } from '../../src/previewdef/focustree/prerequisitelink';
import { getTopMostBranchRootFocusAnchorId } from '../../src/previewdef/focustree/relationanchor';
import type { FocusView } from '../../src/previewdef/focustree/viewmodel';
import { normalizePreviewScale } from '../../src/util/previewscale';
import { currentScale, getState, setPreviewPanDisabled, setState, startPreviewPan } from '../util/common';
import { vscode } from '../util/vscode';
import {
    applyContinuousFocusElementPosition,
    getContinuousFocusStoredPositionFromDisplay,
    rebuildContentSafely,
} from './content';
import {
    getFocusPositionKey,
    getPendingPlaceholderFocusIds,
    hasPendingFocusLink,
    PendingFocusLinkType,
    runtime,
} from './runtime';
import { getFocusNavigationTarget, navigateToFocus } from './navigation';
import { focusScene } from './scenestore';
import {
    clearCurrentSelectedFocusIds,
    persistCurrentSelectedFocusIds,
    resolveSelectionTargetIds,
    setCurrentSelectedFocusIds,
} from './selection';
import {
    isContinuousFocusEditable,
    refreshFocusEditControls,
    refreshLinkParentState,
    setHoveredRelationFocusId,
} from './visualstate';
import { closeFocusWarningsPanelOnEscape } from './warnings';

type FocusSelectionRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ActiveFocusSelectionMarquee = {
    startClientX: number;
    startClientY: number;
    dragGestureStarted: boolean;
    pointerId: number;
    captureOwner: HTMLElement;
    latestClientX: number;
    latestClientY: number;
    animationFrame?: number;
};

export interface FocusEditResultMessage {
    command?: string;
    requestId?: string | number;
    documentVersion?: number;
    focusId?: string;
    treeEditKey?: string;
    focusTreeEditKey?: string;
    targetLocalX?: number;
    targetLocalY?: number;
    targetX?: number;
    targetY?: number;
    targetAbsoluteX?: number;
    targetAbsoluteY?: number;
    parentFocusId?: string;
    parentFocusIds?: string[];
    childFocusId?: string;
    sourceFocusId?: string;
    targetFocusId?: string;
    focusIds?: string[];
}

const focusPositionDragThresholdPx = 4;
const focusNavigateDelayMs = 220;
const focusEditResultCommands = new Set([
    'focusPositionEditApplied',
    'createFocusTemplateApplied',
    'continuousFocusPositionEditApplied',
    'deleteFocusApplied',
    'focusLinkEditApplied',
    'focusExclusiveLinkEditApplied',
]);

let focusNavigateTimer: number | undefined;
let blankFocusSelectionClearTimer: number | undefined;
let focusContextMenuTargetId: string | undefined;
let activeFocusSelectionMarquee: ActiveFocusSelectionMarquee | undefined;

function setFocusPositionEditMode(enabled: boolean): void {
    if (!enabled) {
        runtime.cancelActiveFocusPositionDrag?.();
    }
    runtime.focusPositionEditMode = enabled;
    setPreviewPanDisabled(enabled);
    setState({ focusPositionEditMode: enabled });
    clearPendingFocusNavigate();
    clearPendingFocusLink();
    if (!enabled) {
        clearCurrentSelectedFocusIds();
    }
    refreshFocusEditControls();
}

function postFocusEdit(command: string, payload: Record<string, unknown>): boolean {
    if (runtime.activeFocusEditRequestId) {
        return false;
    }

    runtime.focusEditRequestSequence += 1;
    runtime.activeFocusEditRequestId = `focus-edit-${Date.now()}-${runtime.focusEditRequestSequence}`;
    vscode.postMessage({
        command,
        requestId: runtime.activeFocusEditRequestId,
        documentVersion: runtime.focusPositionDocumentVersion,
        ...payload,
    });
    refreshFocusEditControls();
    return true;
}

function clearPendingFocusNavigate(): void {
    if (focusNavigateTimer !== undefined) {
        window.clearTimeout(focusNavigateTimer);
        focusNavigateTimer = undefined;
    }
}

function scheduleFocusNavigate(card: HTMLElement): void {
    clearPendingFocusNavigate();
    focusNavigateTimer = window.setTimeout(() => {
        focusNavigateTimer = undefined;
        if (runtime.focusPositionEditMode && !hasPendingFocusLink()) {
            navigateToFocus(getFocusNavigationTarget(card));
        }
    }, focusNavigateDelayMs);
}

function cancelBlankFocusSelectionClear(): void {
    if (blankFocusSelectionClearTimer !== undefined) {
        window.clearTimeout(blankFocusSelectionClearTimer);
        blankFocusSelectionClearTimer = undefined;
    }
}

function scheduleBlankFocusSelectionClear(): void {
    cancelBlankFocusSelectionClear();
    blankFocusSelectionClearTimer = window.setTimeout(() => {
        blankFocusSelectionClearTimer = undefined;
        clearCurrentSelectedFocusIds();
    }, 250);
}

function getFocusElement(target: EventTarget | null): HTMLDivElement | null {
    return (target as HTMLElement | null)?.closest?.<HTMLDivElement>('[data-focus-id]') ?? null;
}

function getEditableFocusElement(target: EventTarget | null): HTMLDivElement | null {
    const focusElement = getFocusElement(target);
    return focusElement?.dataset.focusEditable === 'true' ? focusElement : null;
}

function getElementAtPointIgnoringDragger(clientX: number, clientY: number): HTMLElement | null {
    const dragger = document.getElementById('dragger') as HTMLDivElement | null;
    const previousPointerEvents = dragger?.style.pointerEvents ?? '';
    if (dragger) {
        dragger.style.pointerEvents = 'none';
    }
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (dragger) {
        dragger.style.pointerEvents = previousPointerEvents;
    }
    return element;
}

function getEditableFocusElementFromMouseEvent(event: MouseEvent): HTMLDivElement | null {
    return getEditableFocusElement(event.target)
        ?? getEditableFocusElement(getElementAtPointIgnoringDragger(event.clientX, event.clientY));
}

function getFocusElementFromMouseEvent(event: MouseEvent): HTMLDivElement | null {
    return getFocusElement(event.target) ?? getFocusElement(getElementAtPointIgnoringDragger(event.clientX, event.clientY));
}

function ensureFocusContextMenu(): HTMLDivElement {
    let menu = document.getElementById('focus-context-menu') as HTMLDivElement | null;
    if (menu) {
        return menu;
    }

    menu = document.createElement('div');
    menu.id = 'focus-context-menu';
    Object.assign(menu.style, {
        position: 'fixed',
        display: 'none',
        minWidth: '140px',
        padding: '4px 0',
        background: 'var(--vscode-menu-background)',
        color: 'var(--vscode-menu-foreground)',
        border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
        zIndex: '1100',
    });
    menu.addEventListener('mousedown', event => event.stopPropagation());
    menu.addEventListener('click', event => event.stopPropagation());
    menu.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
    });

    const createMenuButton = (label: string, mouseDownHandler: (focusId: string) => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        Object.assign(button.style, {
            display: 'block',
            width: '100%',
            height: '28px',
            padding: '0 12px',
            textAlign: 'left',
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            cursor: 'pointer',
        });
        button.addEventListener('mouseenter', () => {
            button.style.background = 'var(--vscode-list-hoverBackground)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent';
        });
        button.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            const focusId = button.dataset.focusId ?? focusContextMenuTargetId;
            hideFocusContextMenu();
            if (focusId) {
                mouseDownHandler(focusId);
            }
        });
        return button;
    };

    menu.append(
        createMenuButton('Link', focusId => startPendingFocusLink(focusId, undefined, undefined, 'prerequisite')),
        createMenuButton('Link Mutually Exclusive', focusId => startPendingFocusLink(focusId, undefined, undefined, 'exclusive')),
        createMenuButton('Delete', focusId => {
            postFocusEdit('deleteFocus', {
                focusId,
                focusIds: resolveSelectionTargetIds(focusId),
            });
        }),
    );
    document.body.appendChild(menu);
    return menu;
}

function hideFocusContextMenu(): void {
    focusContextMenuTargetId = undefined;
    const menu = document.getElementById('focus-context-menu') as HTMLDivElement | null;
    if (menu) {
        delete menu.dataset.focusId;
        menu.querySelectorAll('button').forEach(button => {
            delete (button as HTMLButtonElement).dataset.focusId;
        });
        menu.style.display = 'none';
    }
}

function showFocusContextMenu(focusId: string, clientX: number, clientY: number): void {
    const menu = ensureFocusContextMenu();
    focusContextMenuTargetId = focusId;
    menu.dataset.focusId = focusId;
    menu.querySelectorAll('button').forEach(button => {
        (button as HTMLButtonElement).dataset.focusId = focusId;
    });
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.display = 'block';

    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, Math.max(0, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.min(clientY, Math.max(0, window.innerHeight - rect.height - 4))}px`;
}

function ensurePendingFocusLinkOverlay(): SVGSVGElement {
    let overlay = document.getElementById('focus-link-overlay') as SVGSVGElement | null;
    if (overlay) {
        return overlay;
    }

    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.id = 'focus-link-overlay';
    overlay.setAttribute('width', '100%');
    overlay.setAttribute('height', '100%');
    Object.assign(overlay.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '1000',
        display: 'none',
    });

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = 'focus-link-overlay-line';
    line.setAttribute('stroke', '#ffc440');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-dasharray', '8 5');
    overlay.appendChild(line);
    document.body.appendChild(overlay);
    return overlay;
}

function getElementViewportCenter(element: HTMLElement): NumberPosition {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function refreshPendingFocusLinkOverlay(targetClientX?: number, targetClientY?: number): void {
    const parentFocusId = runtime.pendingFocusLinkParentId;
    if (!hasPendingFocusLink() || !parentFocusId) {
        return;
    }

    const parentElement = focusScene.getCard(parentFocusId);
    if (!parentElement) {
        clearPendingFocusLink();
        return;
    }

    const overlay = ensurePendingFocusLinkOverlay();
    const line = overlay.querySelector('#focus-link-overlay-line') as SVGLineElement | null;
    if (!line) {
        return;
    }

    const parentCenter = getElementViewportCenter(parentElement);
    const exclusive = runtime.pendingFocusLinkType === 'exclusive';
    line.setAttribute('x1', `${parentCenter.x}`);
    line.setAttribute('y1', `${parentCenter.y}`);
    line.setAttribute('x2', `${targetClientX ?? parentCenter.x}`);
    line.setAttribute('y2', `${targetClientY ?? parentCenter.y}`);
    line.setAttribute('stroke', exclusive ? '#ff6666' : '#ffc440');
    line.setAttribute('stroke-dasharray', exclusive ? '0' : '8 5');
    overlay.style.display = 'block';
}

function startPendingFocusLink(
    parentFocusId: string,
    clientX?: number,
    clientY?: number,
    type: PendingFocusLinkType = 'prerequisite',
): void {
    runtime.pendingFocusLinkParentIds = resolveSelectionTargetIds(parentFocusId);
    runtime.pendingFocusLinkParentId = parentFocusId;
    runtime.pendingFocusLinkType = type;
    const parentElement = focusScene.getCard(parentFocusId);
    const parentCenter = parentElement ? getElementViewportCenter(parentElement) : undefined;
    refreshPendingFocusLinkOverlay(clientX ?? parentCenter?.x, clientY ?? parentCenter?.y);
    refreshLinkParentState();
}

function clearPendingFocusLink(): void {
    runtime.pendingFocusLinkParentId = undefined;
    runtime.pendingFocusLinkParentIds = [];
    runtime.pendingFocusLinkType = undefined;
    const overlay = document.getElementById('focus-link-overlay') as SVGSVGElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }
    refreshLinkParentState();
}

function resolvePendingFocusLinkAnchorId(parentFocusIds: readonly string[], fallbackFocusId: string): string {
    return getTopMostBranchRootFocusAnchorId(parentFocusIds, runtime.renderedFocusTree, runtime.focusPositions, fallbackFocusId);
}

function getSelectionRect(startClientX: number, startClientY: number, currentClientX: number, currentClientY: number): FocusSelectionRect {
    const left = Math.min(startClientX, currentClientX);
    const top = Math.min(startClientY, currentClientY);
    const right = Math.max(startClientX, currentClientX);
    const bottom = Math.max(startClientY, currentClientY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function ensureFocusSelectionOverlay(): HTMLDivElement {
    let overlay = document.getElementById('focus-selection-overlay') as HTMLDivElement | null;
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'focus-selection-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        display: 'none',
        pointerEvents: 'none',
        left: '0',
        top: '0',
        border: '1px solid rgba(96, 196, 255, 0.95)',
        background: 'rgba(96, 196, 255, 0.12)',
        zIndex: '995',
    });
    document.body.appendChild(overlay);
    return overlay;
}

function hideFocusSelectionOverlay(): void {
    const overlay = document.getElementById('focus-selection-overlay') as HTMLDivElement | null;
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function updateFocusSelectionOverlay(selectionRect: FocusSelectionRect): void {
    const overlay = ensureFocusSelectionOverlay();
    overlay.style.display = 'block';
    overlay.style.left = `${selectionRect.left}px`;
    overlay.style.top = `${selectionRect.top}px`;
    overlay.style.width = `${selectionRect.width}px`;
    overlay.style.height = `${selectionRect.height}px`;
}

function getSelectedFocusIdsFromRect(selectionRect: FocusSelectionRect): string[] {
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    if (!contentElement) {
        return [];
    }

    const contentRect = contentElement.getBoundingClientRect();
    const scale = currentScale();
    const { xGridSize, yGridSize } = runtime;
    const selectedFocusIds: string[] = [];
    for (const [focusId, position] of Object.entries(runtime.focusPositions)) {
        const left = contentRect.left + (runtime.gridLeftPadding + position.x * xGridSize) * scale;
        const top = contentRect.top + (runtime.gridTopPadding + position.y * yGridSize) * scale;
        if (selectionRect.left <= left + xGridSize * scale
            && selectionRect.right >= left
            && selectionRect.top <= top + yGridSize * scale
            && selectionRect.bottom >= top) {
            selectedFocusIds.push(focusId);
        }
    }
    return selectedFocusIds;
}

function clearActiveFocusSelectionMarquee(): void {
    if (activeFocusSelectionMarquee) {
        if (activeFocusSelectionMarquee.animationFrame !== undefined) {
            cancelAnimationFrame(activeFocusSelectionMarquee.animationFrame);
        }
        try {
            activeFocusSelectionMarquee.captureOwner.releasePointerCapture(activeFocusSelectionMarquee.pointerId);
        } catch {
            // Ignore stale pointer capture releases.
        }
    }
    activeFocusSelectionMarquee = undefined;
    hideFocusSelectionOverlay();
}

function isBlankCreateTarget(event: MouseEvent): boolean {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element
        || element.closest('[data-focus-id], #inlaywindowplaceholder, #continuousFocuses, .toolbar-outer, #warnings-container, input, select, button, textarea, option')) {
        return false;
    }

    const toolbar = document.querySelector('.toolbar-outer') as HTMLElement | null;
    if (event.clientY < (toolbar?.getBoundingClientRect().bottom ?? 0)) {
        return false;
    }

    const contentRect = document.getElementById('focustreecontent')?.getBoundingClientRect();
    return !!contentRect && event.clientX >= contentRect.left && event.clientY >= contentRect.top;
}

function getBlankCanvasPanTarget(event: MouseEvent): HTMLElement | null {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element || element.id === 'dragger'
        || element.closest('[data-focus-id], .navigator, #continuousFocuses, .toolbar-outer, #warnings-container, input, select, button, textarea, option, ul.select-dropdown, li')) {
        return null;
    }

    const contentRect = document.getElementById('focustreecontent')?.getBoundingClientRect();
    if (!contentRect || event.clientX < contentRect.left || event.clientY < contentRect.top) {
        return null;
    }

    return element;
}

function getAbsoluteGridPositionFromMouseEvent(event: MouseEvent): NumberPosition | undefined {
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    if (!contentElement) {
        return undefined;
    }

    const scale = normalizePreviewScale(getState().scale);
    const contentRect = contentElement.getBoundingClientRect();
    return {
        x: Math.floor(((event.clientX - contentRect.left) / scale - runtime.gridLeftPadding) / runtime.xGridSize),
        y: Math.floor(((event.clientY - contentRect.top) / scale - runtime.gridTopPadding) / runtime.yGridSize),
    };
}

function applyPendingFocusLink(focusElement: HTMLDivElement | null): void {
    const parentFocusId = runtime.pendingFocusLinkParentId;
    const pendingParentFocusIds = [...runtime.pendingFocusLinkParentIds];
    const linkType = runtime.pendingFocusLinkType;
    const childFocusId = focusElement?.dataset.focusId;
    clearPendingFocusLink();
    const focusTree = runtime.renderedFocusTree;
    if (!focusElement || !parentFocusId || !childFocusId || !linkType || !focusTree) {
        return;
    }

    if (linkType === 'exclusive') {
        if (parentFocusId !== childFocusId) {
            postFocusEdit('applyFocusExclusiveLinkEdit', {
                sourceFocusId: parentFocusId,
                targetFocusId: childFocusId,
            });
        }
        return;
    }

    const parentFocusIds = normalizeParentFocusIds(parentFocusId, pendingParentFocusIds, childFocusId);
    if (parentFocusIds.length === 0) {
        return;
    }
    const anchorParentFocusId = resolvePendingFocusLinkAnchorId(parentFocusIds, parentFocusIds[0]);
    if (!anchorParentFocusId || anchorParentFocusId === childFocusId) {
        return;
    }

    const childFocus = focusTree.focuses[childFocusId];
    const childAbsolutePosition = runtime.focusPositions[childFocusId];
    if (!childFocus || !childAbsolutePosition) {
        return;
    }

    const updatedLinkState = updatePrerequisiteGroupsAfterLinkApply(
        childFocus.prerequisite,
        parentFocusIds,
        anchorParentFocusId,
        childFocus.relativePositionId,
    );
    const linkedChildFocus: FocusView = {
        ...childFocus,
        relativePositionId: updatedLinkState.relativePositionId,
        prerequisite: updatedLinkState.prerequisiteGroups,
    };
    const targetLocalPosition = getLocalPositionFromRenderedAbsolute(
        linkedChildFocus,
        focusTree,
        runtime.renderedExprs,
        childAbsolutePosition,
    );

    postFocusEdit('applyFocusLinkEdit', {
        parentFocusId: anchorParentFocusId,
        parentFocusIds,
        childFocusId,
        targetLocalX: targetLocalPosition.x,
        targetLocalY: targetLocalPosition.y,
    });
}

function setupFocusPointerHandlers(): void {
    document.addEventListener('pointerdown', event => {
        const focusElement = getEditableFocusElementFromMouseEvent(event);
        if (focusElement) {
            startFocusPositionDrag(focusElement, event);
        }
    }, true);

    const continuousFocusElement = document.getElementById('continuousFocuses') as HTMLDivElement | null;
    continuousFocusElement?.addEventListener('pointerdown', event => {
        startContinuousFocusPositionDrag(continuousFocusElement, event);
    }, true);

    document.addEventListener('mouseover', event => {
        setHoveredRelationFocusId(getFocusElement(event.target)?.dataset.focusId);
    }, true);

    document.addEventListener('mouseout', event => {
        const focusElement = getFocusElement(event.target);
        if (!focusElement) {
            return;
        }
        const relatedFocusElement = getFocusElement((event as MouseEvent).relatedTarget);
        if (relatedFocusElement?.dataset.focusId !== focusElement.dataset.focusId
            && runtime.hoveredRelationFocusId === focusElement.dataset.focusId) {
            setHoveredRelationFocusId(undefined);
        }
    }, true);

    document.addEventListener('contextmenu', event => {
        const focusElement = runtime.focusPositionEditMode ? getEditableFocusElementFromMouseEvent(event) : null;
        const focusId = focusElement?.dataset.focusId;
        if (!focusId) {
            hideFocusContextMenu();
            return;
        }

        clearPendingFocusNavigate();
        clearPendingFocusLink();
        event.preventDefault();
        event.stopPropagation();
        showFocusContextMenu(focusId, event.clientX, event.clientY);
    }, true);

    document.addEventListener('click', event => {
        if (!(event.target as HTMLElement | null)?.closest('#focus-context-menu')) {
            hideFocusContextMenu();
        }
        if (!runtime.focusPositionEditMode) {
            return;
        }

        if (Date.now() <= runtime.suppressEditableFocusClickUntil) {
            runtime.suppressEditableFocusClickUntil = 0;
            clearPendingFocusNavigate();
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const focusElement = getFocusElementFromMouseEvent(event);
        if (hasPendingFocusLink()) {
            clearPendingFocusNavigate();
            event.preventDefault();
            event.stopPropagation();
            applyPendingFocusLink(focusElement);
            return;
        }

        if (!focusElement) {
            if (getBlankCanvasPanTarget(event)) {
                scheduleBlankFocusSelectionClear();
            }
            return;
        }

        cancelBlankFocusSelectionClear();
        clearPendingFocusNavigate();
        event.preventDefault();
        event.stopPropagation();
        if (event.detail <= 1) {
            scheduleFocusNavigate(focusElement);
        }
    }, true);

    document.addEventListener('dblclick', event => {
        if (!runtime.focusPositionEditMode) {
            return;
        }
        const parentFocusId = getFocusElementFromMouseEvent(event)?.dataset.focusId;
        if (!parentFocusId) {
            return;
        }

        clearPendingFocusNavigate();
        event.preventDefault();
        event.stopPropagation();
        startPendingFocusLink(parentFocusId, event.clientX, event.clientY, 'prerequisite');
    }, true);

    document.addEventListener('mousemove', event => {
        if (hasPendingFocusLink()) {
            refreshPendingFocusLinkOverlay(event.clientX, event.clientY);
        }
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') {
            return;
        }
        hideFocusContextMenu();
        if (hasPendingFocusLink()) {
            clearPendingFocusLink();
            return;
        }
        // An open warnings panel closes before Escape clears the focus selection behind it.
        if (closeFocusWarningsPanelOnEscape()) {
            return;
        }
        clearActiveFocusSelectionMarquee();
        clearCurrentSelectedFocusIds();
    }, true);

    window.addEventListener('scroll', () => hideFocusContextMenu(), true);
}

function setupFocusSelectionMarqueeHandler(): void {
    document.addEventListener('pointerdown', event => {
        if (!runtime.focusPositionEditMode || event.button !== 0 || !event.shiftKey || hasPendingFocusLink()) {
            return;
        }

        const captureOwner = getBlankCanvasPanTarget(event);
        if (!captureOwner) {
            return;
        }

        clearPendingFocusNavigate();
        hideFocusContextMenu();
        event.preventDefault();
        event.stopPropagation();
        captureOwner.setPointerCapture?.(event.pointerId);
        activeFocusSelectionMarquee = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            dragGestureStarted: false,
            pointerId: event.pointerId,
            captureOwner,
            latestClientX: event.clientX,
            latestClientY: event.clientY,
        };
        hideFocusSelectionOverlay();
    }, true);

    document.addEventListener('pointermove', event => {
        const marquee = activeFocusSelectionMarquee;
        if (!marquee || event.pointerId !== marquee.pointerId) {
            return;
        }

        marquee.latestClientX = event.clientX;
        marquee.latestClientY = event.clientY;
        if (marquee.animationFrame !== undefined) {
            return;
        }
        marquee.animationFrame = requestAnimationFrame(() => {
            marquee.animationFrame = undefined;
            if (activeFocusSelectionMarquee !== marquee) {
                return;
            }
            const selectionRect = getSelectionRect(
                marquee.startClientX,
                marquee.startClientY,
                marquee.latestClientX,
                marquee.latestClientY,
            );
            if (!marquee.dragGestureStarted
                && Math.max(selectionRect.width, selectionRect.height) < focusPositionDragThresholdPx) {
                return;
            }
            marquee.dragGestureStarted = true;
            updateFocusSelectionOverlay(selectionRect);
            setCurrentSelectedFocusIds(getSelectedFocusIdsFromRect(selectionRect), false);
        });
    }, true);

    document.addEventListener('pointerup', event => {
        if (!activeFocusSelectionMarquee || event.pointerId !== activeFocusSelectionMarquee.pointerId) {
            return;
        }

        const dragGestureStarted = activeFocusSelectionMarquee.dragGestureStarted;
        clearActiveFocusSelectionMarquee();
        if (dragGestureStarted) {
            persistCurrentSelectedFocusIds();
            runtime.suppressEditableFocusClickUntil = Date.now() + 250;
        }
    }, true);

    document.addEventListener('pointercancel', event => {
        if (activeFocusSelectionMarquee && event.pointerId === activeFocusSelectionMarquee.pointerId) {
            clearActiveFocusSelectionMarquee();
        }
    }, true);
}

function setupFocusTemplateCreateHandler(): void {
    document.addEventListener('click', event => {
        const focusTree = runtime.renderedFocusTree;
        if (!runtime.focusPositionEditMode || !focusTree || event.detail < 2 || !isBlankCreateTarget(event)) {
            return;
        }

        const targetPosition = getAbsoluteGridPositionFromMouseEvent(event);
        if (!targetPosition || runtime.occupiedFocusPositionKeys.has(getFocusPositionKey(targetPosition))) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearPendingFocusNavigate();
        cancelBlankFocusSelectionClear();

        const parentFocusIds = Array.from(runtime.selectedFocusIds).filter(focusId => !!focusTree.focuses[focusId]);
        const parentFocusId = parentFocusIds.length > 0
            ? resolvePendingFocusLinkAnchorId(parentFocusIds, parentFocusIds[0])
            : undefined;
        const parentPosition = parentFocusId ? runtime.focusPositions[parentFocusId] : undefined;

        postFocusEdit('createFocusTemplateAtPosition', {
            treeEditKey: focusTree.createTemplate?.editKey ?? '',
            targetAbsoluteX: targetPosition.x,
            targetAbsoluteY: targetPosition.y,
            targetLocalX: parentPosition ? targetPosition.x - parentPosition.x : undefined,
            targetLocalY: parentPosition ? targetPosition.y - parentPosition.y : undefined,
            parentFocusId,
            parentFocusIds: parentFocusIds.length > 0 ? parentFocusIds : undefined,
        });
    }, true);
}

function setupBlankCanvasPanFallback(): void {
    const isRightButtonDrag = () => (window as any).__featureflags?.rightButtonDrag ?? false;
    document.addEventListener('mousedown', event => {
        if (event.button !== (isRightButtonDrag() ? 2 : 0) || event.defaultPrevented || event.shiftKey
            || !getBlankCanvasPanTarget(event)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        startPreviewPan(event.pageX, event.pageY, true);
    }, true);

    document.addEventListener('contextmenu', event => {
        if (isRightButtonDrag() && getBlankCanvasPanTarget(event)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}

/** Tracks one pointer gesture and always releases capture and listeners exactly once. */
function trackPointerGesture(
    owner: HTMLElement,
    event: PointerEvent,
    onMove: (moveEvent: PointerEvent) => void,
    onFinish: (commit: boolean) => void,
): void {
    let finished = false;
    const finish = (commit: boolean) => {
        if (finished) {
            return;
        }
        finished = true;
        owner.removeEventListener('lostpointercapture', lostPointerCaptureHandler);
        window.removeEventListener('pointermove', pointerMoveHandler, true);
        window.removeEventListener('pointerup', pointerUpHandler, true);
        window.removeEventListener('pointercancel', pointerCancelHandler, true);
        window.removeEventListener('blur', windowBlurHandler);
        if (runtime.cancelActiveFocusPositionDrag === cancelDrag) {
            runtime.cancelActiveFocusPositionDrag = undefined;
        }
        try {
            owner.releasePointerCapture(event.pointerId);
        } catch {
            // Ignore stale pointer capture releases after a rebuild or window blur.
        }
        onFinish(commit);
    };
    const pointerMoveHandler = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId === event.pointerId) {
            onMove(moveEvent);
        }
    };
    const pointerUpHandler = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === event.pointerId) {
            finish(true);
        }
    };
    const pointerCancelHandler = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === event.pointerId) {
            finish(false);
        }
    };
    const lostPointerCaptureHandler = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId === event.pointerId) {
            finish(false);
        }
    };
    const windowBlurHandler = () => finish(false);
    const cancelDrag = () => finish(false);

    owner.setPointerCapture?.(event.pointerId);
    owner.addEventListener('lostpointercapture', lostPointerCaptureHandler);
    window.addEventListener('pointermove', pointerMoveHandler, true);
    window.addEventListener('pointerup', pointerUpHandler, true);
    window.addEventListener('pointercancel', pointerCancelHandler, true);
    window.addEventListener('blur', windowBlurHandler);
    runtime.cancelActiveFocusPositionDrag = cancelDrag;
}

function startFocusPositionDrag(focusElement: HTMLElement, event: PointerEvent): void {
    if (!runtime.focusPositionEditMode || runtime.activeFocusEditRequestId || event.button !== 0 || !event.isPrimary
        || (event.target as HTMLElement | null)?.closest('input, select, button, textarea, option')) {
        return;
    }

    const focusId = focusElement.dataset.focusId;
    const focusTree = runtime.renderedFocusTree;
    const focus = focusId ? focusTree?.focuses[focusId] : undefined;
    const currentPosition = focusId ? runtime.focusPositions[focusId] : undefined;
    if (!focusId || !focusTree || !focus || !currentPosition) {
        return;
    }

    runtime.cancelActiveFocusPositionDrag?.();
    focusScene.suspendMeasurement(focusId);
    event.preventDefault();
    event.stopPropagation();

    const wrapper = focusScene.getWrapper(focusId);
    const startingPosition = { ...currentPosition };
    let nextAbsolutePosition = { ...startingPosition };
    let dragGestureStarted = false;
    focusElement.style.cursor = 'grabbing';
    focusElement.style.zIndex = '20';
    focusElement.style.willChange = 'transform';
    if (wrapper) {
        wrapper.style.zIndex = '20';
    }

    trackPointerGesture(focusElement, event, moveEvent => {
        const deltaPageX = moveEvent.pageX - event.pageX;
        const deltaPageY = moveEvent.pageY - event.pageY;
        if (!dragGestureStarted && !hasFocusDragPassedThreshold(deltaPageX, deltaPageY, focusPositionDragThresholdPx)) {
            return;
        }

        dragGestureStarted = true;
        const scaledDelta = getScaledFocusDragDelta(deltaPageX, deltaPageY, normalizePreviewScale(getState().scale));
        nextAbsolutePosition = getSnappedFocusDragPosition(startingPosition, scaledDelta, runtime.xGridSize, runtime.yGridSize);
        focusElement.style.transform = `translate(${scaledDelta.x}px, ${scaledDelta.y}px)`;
    }, commit => {
        focusElement.style.transform = '';
        focusElement.style.cursor = '';
        focusElement.style.zIndex = '';
        focusElement.style.willChange = '';
        if (wrapper) {
            wrapper.style.zIndex = '';
        }
        focusScene.resumeMeasurement(focusId);

        if (!commit || !dragGestureStarted) {
            return;
        }

        runtime.suppressEditableFocusClickUntil = Date.now() + 250;
        const renderedTree = runtime.renderedFocusTree;
        if (!renderedTree
            || (nextAbsolutePosition.x === startingPosition.x && nextAbsolutePosition.y === startingPosition.y)) {
            return;
        }

        const targetLocalPosition = getLocalPositionFromRenderedAbsolute(
            focus,
            renderedTree,
            runtime.renderedExprs,
            nextAbsolutePosition,
        );
        postFocusEdit('applyFocusPositionEdit', {
            focusId,
            targetLocalX: targetLocalPosition.x,
            targetLocalY: targetLocalPosition.y,
        });
    });
}

function startContinuousFocusPositionDrag(continuousFocusElement: HTMLDivElement, event: PointerEvent): void {
    if (!runtime.focusPositionEditMode
        || event.button !== 0
        || !event.isPrimary
        || !!runtime.activeFocusEditRequestId
        || hasPendingFocusLink()
        || !isContinuousFocusEditable(runtime.renderedFocusTree)) {
        return;
    }

    runtime.cancelActiveFocusPositionDrag?.();
    event.preventDefault();
    event.stopPropagation();

    const startingLeft = parseFloat(continuousFocusElement.style.left || '0');
    const startingTop = parseFloat(continuousFocusElement.style.top || '0');
    let nextLeft = startingLeft;
    let nextTop = startingTop;
    let dragGestureStarted = false;
    continuousFocusElement.style.cursor = 'grabbing';
    continuousFocusElement.style.zIndex = '20';
    continuousFocusElement.style.willChange = 'left, top';

    trackPointerGesture(continuousFocusElement, event, moveEvent => {
        const deltaPageX = moveEvent.pageX - event.pageX;
        const deltaPageY = moveEvent.pageY - event.pageY;
        if (!dragGestureStarted && !hasFocusDragPassedThreshold(deltaPageX, deltaPageY, focusPositionDragThresholdPx)) {
            return;
        }

        dragGestureStarted = true;
        const scaledDelta = getScaledFocusDragDelta(deltaPageX, deltaPageY, normalizePreviewScale(getState().scale));
        nextLeft = startingLeft + scaledDelta.x;
        nextTop = startingTop + scaledDelta.y;
        continuousFocusElement.style.left = `${nextLeft}px`;
        continuousFocusElement.style.top = `${nextTop}px`;
    }, commit => {
        continuousFocusElement.style.zIndex = '';
        continuousFocusElement.style.willChange = '';
        refreshFocusEditControls();
        const focusTree = runtime.renderedFocusTree;
        if (commit && dragGestureStarted && focusTree) {
            const nextStoredPosition = getContinuousFocusStoredPositionFromDisplay(nextLeft, nextTop);
            const roundedTargetX = Math.round(nextStoredPosition.x);
            const roundedTargetY = Math.round(nextStoredPosition.y);
            if (roundedTargetX !== focusTree.continuousFocusPositionX || roundedTargetY !== focusTree.continuousFocusPositionY) {
                postFocusEdit('applyContinuousFocusPositionEdit', {
                    focusTreeEditKey: focusTree.continuousLayout?.editKey ?? '',
                    targetX: roundedTargetX,
                    targetY: roundedTargetY,
                });
            }
        }
        applyContinuousFocusElementPosition(runtime.renderedFocusTree);
    });
}

function updateFocusPositionAfterApply(focusId: string, targetLocalX: number, targetLocalY: number): void {
    const focusTree = runtime.renderedFocusTree;
    const focus = focusTree?.focuses[focusId];
    if (!focusTree || !focus) {
        return;
    }

    focus.x = targetLocalX;
    focus.y = targetLocalY;
    invalidateCachedFocusTreeLayoutPlan(focusTree);
}

function updateContinuousFocusPositionAfterApply(focusTreeEditKey: string, targetX: number, targetY: number): void {
    const targetTree = runtime.focusTrees.find(focusTree => focusTree.continuousLayout?.editKey === focusTreeEditKey);
    if (!targetTree) {
        return;
    }

    targetTree.continuousFocusPositionX = targetX;
    targetTree.continuousFocusPositionY = targetY;
    if (targetTree.continuousLayout) {
        targetTree.continuousLayout.basePosition = { x: targetX, y: targetY };
    }
}

function updateFocusLinkAfterApply(
    parentFocusId: string,
    childFocusId: string,
    targetLocalX?: number,
    targetLocalY?: number,
    parentFocusIds?: readonly string[],
): void {
    const focusTree = runtime.renderedFocusTree;
    const childFocus = focusTree?.focuses[childFocusId];
    if (!focusTree || !childFocus) {
        return;
    }

    const normalizedParentFocusIds = Array.from(new Set(
        (parentFocusIds && parentFocusIds.length > 0 ? parentFocusIds : [parentFocusId])
            .filter(focusId => focusId && focusId !== childFocusId),
    ));
    const updatedLinkState = updatePrerequisiteGroupsAfterLinkApply(
        childFocus.prerequisite,
        normalizedParentFocusIds,
        parentFocusId,
        childFocus.relativePositionId,
    );
    childFocus.prerequisite = updatedLinkState.prerequisiteGroups;
    childFocus.relativePositionId = updatedLinkState.relativePositionId;
    if (targetLocalX !== undefined && targetLocalY !== undefined) {
        childFocus.x = targetLocalX;
        childFocus.y = targetLocalY;
    }
    invalidateCachedFocusTreeLayoutPlan(focusTree);
}

function updateFocusExclusiveLinkAfterApply(sourceFocusId: string, targetFocusId: string): void {
    const focusTree = runtime.renderedFocusTree;
    const sourceFocus = focusTree?.focuses[sourceFocusId];
    const targetFocus = focusTree?.focuses[targetFocusId];
    if (!focusTree || !sourceFocus || !targetFocus) {
        return;
    }

    if (sourceFocus.exclusive.includes(targetFocusId) || targetFocus.exclusive.includes(sourceFocusId)) {
        sourceFocus.exclusive = sourceFocus.exclusive.filter(focusId => focusId !== targetFocusId);
        targetFocus.exclusive = targetFocus.exclusive.filter(focusId => focusId !== sourceFocusId);
    } else {
        sourceFocus.exclusive.push(targetFocusId);
        targetFocus.exclusive.push(sourceFocusId);
    }
    invalidateCachedFocusTreeLayoutPlan(focusTree);
}

function updateFocusTemplateCreateAfterApply(
    treeEditKey: string,
    focusId: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
): void {
    const targetTree = runtime.focusTrees.find(focusTree => focusTree.createTemplate?.editKey === treeEditKey);
    if (!targetTree || !focusId || targetTree.focuses[focusId]) {
        return;
    }

    targetTree.focuses[focusId] = createPlaceholderFocus(
        targetTree,
        focusId,
        targetAbsoluteX,
        targetAbsoluteY,
        runtime.focusPositionActiveFile || targetTree.createTemplate?.sourceFile || '',
    );
    getPendingPlaceholderFocusIds(targetTree.id).add(focusId);
    invalidateCachedFocusTreeLayoutPlan(targetTree);
    if (runtime.renderedFocusTree?.id === targetTree.id) {
        setCurrentSelectedFocusIds([focusId]);
    }
}

function updateDeleteFocusAfterApply(focusIds: readonly string[]): void {
    const deletedFocusIds = Array.from(new Set(focusIds.filter(Boolean)));
    if (deletedFocusIds.length === 0) {
        return;
    }

    const deletedSet = new Set(deletedFocusIds);
    runtime.focusTrees.forEach(focusTree => {
        if (deletedFocusIds.some(focusId => !!focusTree.focuses[focusId])) {
            applyLocalFocusDeletion(focusTree, deletedFocusIds);
            invalidateCachedFocusTreeLayoutPlan(focusTree);
        }
    });

    setCurrentSelectedFocusIds(Array.from(runtime.selectedFocusIds).filter(focusId => !deletedSet.has(focusId)));
    if (runtime.pendingFocusLinkParentId && deletedSet.has(runtime.pendingFocusLinkParentId)) {
        clearPendingFocusLink();
    }
    if (runtime.hoveredRelationFocusId && deletedSet.has(runtime.hoveredRelationFocusId)) {
        setHoveredRelationFocusId(undefined);
    }
}

/**
 * Applies the host's answer to a pending edit. Accepted edits update the retained view model
 * first, so the scene reconciles immediately instead of waiting for the document refresh.
 */
export function handleFocusEditResult(message: FocusEditResultMessage): boolean {
    if (message.command === 'focusEditRejected') {
        if (!message.requestId || message.requestId !== runtime.activeFocusEditRequestId) {
            return true;
        }
        runtime.activeFocusEditRequestId = undefined;
        runtime.focusPositionDocumentVersion = message.documentVersion ?? runtime.focusPositionDocumentVersion;
        window.focusPositionDocumentVersion = runtime.focusPositionDocumentVersion;
        applyContinuousFocusElementPosition(runtime.renderedFocusTree);
        refreshFocusEditControls();
        void rebuildContentSafely();
        return true;
    }

    if (!message.command || !focusEditResultCommands.has(message.command)) {
        return false;
    }
    if (!message.requestId || message.requestId !== runtime.activeFocusEditRequestId) {
        return true;
    }

    runtime.activeFocusEditRequestId = undefined;
    runtime.focusPositionDocumentVersion = message.documentVersion ?? runtime.focusPositionDocumentVersion;
    window.focusPositionDocumentVersion = runtime.focusPositionDocumentVersion;
    refreshFocusEditControls();
    switch (message.command) {
        case 'createFocusTemplateApplied':
            if (message.treeEditKey !== undefined && message.focusId !== undefined
                && message.targetAbsoluteX !== undefined && message.targetAbsoluteY !== undefined) {
                updateFocusTemplateCreateAfterApply(message.treeEditKey, message.focusId, message.targetAbsoluteX, message.targetAbsoluteY);
            }
            break;
        case 'focusPositionEditApplied':
            if (message.focusId !== undefined && message.targetLocalX !== undefined && message.targetLocalY !== undefined) {
                updateFocusPositionAfterApply(message.focusId, message.targetLocalX, message.targetLocalY);
            }
            break;
        case 'continuousFocusPositionEditApplied':
            if (message.focusTreeEditKey !== undefined && message.targetX !== undefined && message.targetY !== undefined) {
                updateContinuousFocusPositionAfterApply(message.focusTreeEditKey, message.targetX, message.targetY);
                applyContinuousFocusElementPosition(runtime.renderedFocusTree);
                return true;
            }
            break;
        case 'focusLinkEditApplied':
            if (message.parentFocusId !== undefined && message.childFocusId !== undefined) {
                updateFocusLinkAfterApply(
                    message.parentFocusId,
                    message.childFocusId,
                    message.targetLocalX,
                    message.targetLocalY,
                    message.parentFocusIds,
                );
            }
            break;
        case 'focusExclusiveLinkEditApplied':
            if (message.sourceFocusId !== undefined && message.targetFocusId !== undefined) {
                updateFocusExclusiveLinkAfterApply(message.sourceFocusId, message.targetFocusId);
            }
            break;
        case 'deleteFocusApplied':
            if (Array.isArray(message.focusIds)) {
                updateDeleteFocusAfterApply(message.focusIds);
            }
            break;
    }
    void rebuildContentSafely();
    return true;
}

export function installFocusEditing(): void {
    setupFocusPointerHandlers();
    setupFocusSelectionMarqueeHandler();
    setupFocusTemplateCreateHandler();
    setupBlankCanvasPanFallback();
    setPreviewPanDisabled(runtime.focusPositionEditMode);
    document.getElementById('focus-position-edit')?.addEventListener('click', () => {
        setFocusPositionEditMode(!runtime.focusPositionEditMode);
    });
}
