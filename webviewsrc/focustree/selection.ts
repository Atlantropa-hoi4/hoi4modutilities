import type { FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import {
    clampFocusTreeIndex as clampFocusTreeIndexValue,
    resolveFocusTreeSelection as resolveFocusTreeSelectionValue,
} from '../../src/previewdef/focustree/selectionstate';
import { setState } from '../util/common';
import { runtime } from './runtime';
import { updateSelectionClasses } from './visualstate';

export function getCurrentSelectionTreeId(): string | undefined {
    return runtime.renderedFocusTree?.id ?? runtime.selectedFocusTreeId ?? runtime.focusTreeCatalog[runtime.selectedFocusTreeIndex]?.id;
}

function persistSelectedFocusTreeState(): void {
    setState({
        selectedFocusTreeIndex: runtime.selectedFocusTreeIndex,
        selectedFocusTreeId: runtime.selectedFocusTreeId,
    });
}

export function ensureSelectedFocusTreeIndex(): number {
    const resolvedSelection = resolveFocusTreeSelectionValue(
        runtime.focusTreeCatalog,
        runtime.selectedFocusTreeId,
        runtime.selectedFocusTreeIndex,
    );
    if (runtime.selectedFocusTreeIndex !== resolvedSelection.selectedFocusTreeIndex
        || runtime.selectedFocusTreeId !== resolvedSelection.selectedFocusTreeId) {
        runtime.selectedFocusTreeIndex = resolvedSelection.selectedFocusTreeIndex;
        runtime.selectedFocusTreeId = resolvedSelection.selectedFocusTreeId;
        persistSelectedFocusTreeState();
    }

    return runtime.selectedFocusTreeIndex;
}

export function setSelectedFocusTreeByIndex(index: number): void {
    runtime.selectedFocusTreeIndex = clampFocusTreeIndexValue(index, runtime.focusTreeCatalog.length);
    runtime.selectedFocusTreeId = runtime.focusTreeCatalog[runtime.selectedFocusTreeIndex]?.id;
    persistSelectedFocusTreeState();
}

export function setSelectedFocusTreeById(treeId: string | undefined): void {
    if (!treeId) {
        ensureSelectedFocusTreeIndex();
        return;
    }

    const nextIndex = runtime.focusTreeCatalog.findIndex(focusTree => focusTree.id === treeId);
    if (nextIndex >= 0) {
        if (runtime.selectedFocusTreeIndex !== nextIndex || runtime.selectedFocusTreeId !== treeId) {
            runtime.selectedFocusTreeIndex = nextIndex;
            runtime.selectedFocusTreeId = treeId;
            persistSelectedFocusTreeState();
        }
        return;
    }

    ensureSelectedFocusTreeIndex();
}

export function getCurrentFocusTree(): FocusTreeView | undefined {
    ensureSelectedFocusTreeIndex();
    return runtime.focusTrees.find(tree => tree.id === runtime.selectedFocusTreeId);
}

export function persistCurrentSelectedFocusIds(): void {
    const treeId = getCurrentSelectionTreeId();
    if (!treeId) {
        return;
    }

    const previous = runtime.selectedFocusIdsByTree[treeId] ?? [];
    const next = Array.from(runtime.selectedFocusIds);
    if (previous.length === next.length && previous.every((focusId, index) => focusId === next[index])) {
        return;
    }

    const nextSelectedFocusIdsByTree = { ...runtime.selectedFocusIdsByTree };
    if (next.length === 0) {
        delete nextSelectedFocusIdsByTree[treeId];
    } else {
        nextSelectedFocusIdsByTree[treeId] = next;
    }

    runtime.selectedFocusIdsByTree = nextSelectedFocusIdsByTree;
    setState({ selectedFocusIdsByTree: runtime.selectedFocusIdsByTree });
}

export function setCurrentSelectedFocusIds(nextIds: Iterable<string>, persistState = true): void {
    const nextSelectedFocusIds = new Set(nextIds);
    const changedFocusIds = new Set<string>();
    runtime.selectedFocusIds.forEach(focusId => {
        if (!nextSelectedFocusIds.has(focusId)) {
            changedFocusIds.add(focusId);
        }
    });
    nextSelectedFocusIds.forEach(focusId => {
        if (!runtime.selectedFocusIds.has(focusId)) {
            changedFocusIds.add(focusId);
        }
    });
    if (changedFocusIds.size === 0) {
        return;
    }

    runtime.selectedFocusIds = nextSelectedFocusIds;
    if (persistState) {
        persistCurrentSelectedFocusIds();
    }
    updateSelectionClasses(changedFocusIds);
}

/** Restores the persisted selection of the rendered tree, dropping focuses it no longer has. */
export function syncCurrentSelectedFocusIds(): void {
    const treeId = getCurrentSelectionTreeId();
    const focusTree = runtime.renderedFocusTree;
    const restored = (treeId ? runtime.selectedFocusIdsByTree[treeId] ?? [] : [])
        .filter(focusId => !focusTree || !!focusTree.focuses[focusId]);
    setCurrentSelectedFocusIds(restored, false);
    persistCurrentSelectedFocusIds();
}

export function clearCurrentSelectedFocusIds(): void {
    if (runtime.selectedFocusIds.size > 0) {
        setCurrentSelectedFocusIds([]);
    }
}

/** Uses the whole multi-selection when the anchor is part of it. */
export function resolveSelectionTargetIds(anchorFocusId: string): string[] {
    const selectedFocusIds = runtime.selectedFocusIds.has(anchorFocusId)
        ? Array.from(runtime.selectedFocusIds)
        : [];
    const focusIds = selectedFocusIds.length > 1 ? selectedFocusIds : [anchorFocusId];
    return Array.from(new Set(focusIds.filter(Boolean)));
}
