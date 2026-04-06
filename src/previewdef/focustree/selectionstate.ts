export function clampFocusTreeIndex(index: number, focusTreeCount: number): number {
    if (!Number.isFinite(index) || focusTreeCount <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(focusTreeCount - 1, index));
}

export interface FocusTreeSelectionLike {
    id: string;
}

export interface FocusTreeSelectionState {
    selectedFocusTreeIndex: number;
    selectedFocusTreeId: string | undefined;
}

export function resolveRenderableFocusTreeSelection<T extends FocusTreeSelectionLike>(
    focusTrees: readonly T[],
    selectedFocusTreeId: string | undefined,
    selectedFocusTreeIndex: number,
    isRenderable: (focusTree: T) => boolean,
): FocusTreeSelectionState {
    const resolvedSelection = resolveFocusTreeSelection(
        focusTrees,
        selectedFocusTreeId,
        selectedFocusTreeIndex,
    );
    const selectedTree = focusTrees[resolvedSelection.selectedFocusTreeIndex];
    if (selectedTree && isRenderable(selectedTree)) {
        return resolvedSelection;
    }

    const fallbackIndex = focusTrees.findIndex(isRenderable);
    if (fallbackIndex >= 0) {
        return {
            selectedFocusTreeIndex: fallbackIndex,
            selectedFocusTreeId: focusTrees[fallbackIndex]?.id,
        };
    }

    return resolvedSelection;
}

export function resolveFocusTreeSelection<T extends FocusTreeSelectionLike>(
    focusTrees: readonly T[],
    selectedFocusTreeId: string | undefined,
    selectedFocusTreeIndex: number,
): FocusTreeSelectionState {
    if (focusTrees.length <= 0) {
        return {
            selectedFocusTreeIndex: 0,
            selectedFocusTreeId: undefined,
        };
    }

    if (selectedFocusTreeId) {
        const selectedIndexById = focusTrees.findIndex(focusTree => focusTree.id === selectedFocusTreeId);
        if (selectedIndexById >= 0) {
            return {
                selectedFocusTreeIndex: selectedIndexById,
                selectedFocusTreeId,
            };
        }
    }

    const clampedIndex = clampFocusTreeIndex(selectedFocusTreeIndex, focusTrees.length);
    return {
        selectedFocusTreeIndex: clampedIndex,
        selectedFocusTreeId: focusTrees[clampedIndex]?.id,
    };
}
