import { applyCondition, ConditionItem } from '../../src/hoiformat/condition';
import { normalizeForStyle } from '../../src/util/styletable';
import type { FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import { getState, setState } from '../util/common';
import { getToolbarConditionExprs, replaceDivDropdownOptions } from './conditions';
import { runtime } from './runtime';

type FocusTreeInlayWindows = FocusTreeView['inlayWindows'];

let renderedInlayHtml: string | undefined;

function getSelectedInlayWindowIds(): Record<string, string | undefined> {
    return getState().selectedInlayWindowIds ?? {};
}

function getSelectedInlayWindowId(focusTree: FocusTreeView, availableInlayWindowIds: readonly string[]): string | undefined {
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (selected && availableInlayWindowIds.includes(selected)) {
        return selected;
    }

    return availableInlayWindowIds[0];
}

export function setSelectedInlayWindowId(focusTree: FocusTreeView, inlayWindowId: string | undefined): void {
    const selectedInlayWindowIds = getSelectedInlayWindowIds();
    if (focusTree.id in selectedInlayWindowIds && selectedInlayWindowIds[focusTree.id] === inlayWindowId) {
        return;
    }
    setState({ selectedInlayWindowIds: { ...selectedInlayWindowIds, [focusTree.id]: inlayWindowId } });
}

function getVisibleInlayWindows(focusTree: FocusTreeView, exprs?: ConditionItem[]): FocusTreeInlayWindows {
    if (!runtime.useConditionInFocus) {
        return focusTree.inlayWindows;
    }

    const conditionExprs = exprs ?? getToolbarConditionExprs(focusTree);
    return focusTree.inlayWindows.filter(inlay => applyCondition(inlay.visible, conditionExprs));
}

function getRenderableInlayWindows(focusTree: FocusTreeView, exprs?: ConditionItem[]): FocusTreeInlayWindows {
    const renderedInlayWindows: Record<string, string> = window.renderedInlayWindows ?? {};
    return getVisibleInlayWindows(focusTree, exprs).filter(inlay => !!renderedInlayWindows[inlay.id]);
}

export function refreshInlayWindowSelector(focusTree: FocusTreeView, exprs?: ConditionItem[]): void {
    const visibleInlayWindows = getRenderableInlayWindows(focusTree, exprs);
    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLDivElement | null;
    const inlayWindowsContainerElement = document.getElementById('inlay-window-container') as HTMLDivElement | null;
    if (inlayWindowsContainerElement) {
        inlayWindowsContainerElement.style.display = visibleInlayWindows.length > 0 ? 'flex' : 'none';
    }
    if (!inlayWindowsElement) {
        return;
    }

    replaceDivDropdownOptions(inlayWindowsElement, visibleInlayWindows.map(inlay => ({
        value: inlay.id,
        text: inlay.id,
    })));
    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree, visibleInlayWindows.map(inlay => inlay.id));
    setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
    runtime.suppressInlayWindowSelectionChange = true;
    try {
        runtime.dropdowns.inlayWindows?.selectedValues$.next(selectedInlayWindowId ? [selectedInlayWindowId] : []);
    } finally {
        runtime.suppressInlayWindowSelectionChange = false;
    }
}

function getActiveInlayOption<T extends { condition: any }>(options: T[], exprs: ConditionItem[]): T | undefined {
    return options.find(option => applyCondition(option.condition, exprs));
}

function getInlayGfxClassName(gfxName: string | undefined, gfxFile: string | undefined): string {
    return 'st-inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}

function renderInlayWindows(focusTree: FocusTreeView, exprs: ConditionItem[]): string {
    const visibleInlayWindows = getRenderableInlayWindows(focusTree, exprs);
    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree, visibleInlayWindows.map(inlay => inlay.id));
    const selectedInlayWindow = visibleInlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow) {
        return '';
    }

    const template = (window.renderedInlayWindows ?? {})[selectedInlayWindow.id] ?? '';
    return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return content.split(`{{inlay_slot_class:${slot.id}}}`).join(activeOption ? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile) : '');
    }, template);
}

/** Replaces the inlay markup only when the rendered HTML changed. */
export function updateInlayWindowPlaceholder(focusTree: FocusTreeView, exprs: ConditionItem[]): void {
    const placeholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement | null;
    if (!placeholder) {
        return;
    }
    const html = renderInlayWindows(focusTree, exprs);
    if (html !== renderedInlayHtml) {
        placeholder.innerHTML = html;
        renderedInlayHtml = html;
    }
}
