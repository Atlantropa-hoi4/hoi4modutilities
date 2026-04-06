import { ConditionItem } from "../../src/hoiformat/condition";
import { FocusTree } from "../../src/previewdef/focustree/schema";
import { FocusConditionPresetsByTree, normalizeConditionPresetsByTree } from "../../src/previewdef/focustree/conditionpresets";
import { resolveFocusTreeSelection } from "../../src/previewdef/focustree/selectionstate";

export interface FocusTreeWebviewInitialState {
    selectedExprs: ConditionItem[];
    conditionPresetsByTree: FocusConditionPresetsByTree;
    selectedFocusTreeIndex: number;
    selectedFocusTreeId?: string;
    selectedFocusIdsByTree: Record<string, string[]>;
    focusPositionEditMode: boolean;
    searchboxValue: string;
}

type FocusTreeStateWindow = Window & {
    previewedFileUri?: string;
    bootstrapSelectedFocusTreeId?: string;
    focusTrees?: FocusTree[];
};

function isNonEmptyFocusTree(focusTree: FocusTree | undefined): boolean {
    return !!focusTree && Object.keys(focusTree.focuses ?? {}).length > 0;
}

function resolveBootstrapSelectedFocusTreeId(windowState: FocusTreeStateWindow): string | undefined {
    const focusTrees = windowState.focusTrees ?? [];
    const bootstrapSelectedFocusTreeId = windowState.bootstrapSelectedFocusTreeId;
    const selectedBootstrapTree = focusTrees.find(focusTree => focusTree.id === bootstrapSelectedFocusTreeId);
    if (isNonEmptyFocusTree(selectedBootstrapTree)) {
        return selectedBootstrapTree?.id;
    }

    return focusTrees.find(isNonEmptyFocusTree)?.id
        ?? selectedBootstrapTree?.id
        ?? focusTrees[0]?.id;
}

export function createFocusTreeWebviewInitialState(
    restoredState: Record<string, unknown>,
    persistedConditionPresetsByTree: FocusConditionPresetsByTree | undefined,
): FocusTreeWebviewInitialState {
    const windowState = window as FocusTreeStateWindow;
    const currentPreviewUri = windowState.previewedFileUri;
    const restoredPreviewUri = restoredState.uri as string | undefined;
    const canUseRestoredState = !!currentPreviewUri && restoredPreviewUri === currentPreviewUri;
    const sanitizedRestoredState = canUseRestoredState ? restoredState : {};
    const focusTrees = windowState.focusTrees ?? [];
    const bootstrapSelectedFocusTreeId = resolveBootstrapSelectedFocusTreeId(windowState);
    const restoredSelectedFocusTreeId = sanitizedRestoredState.selectedFocusTreeId as string | undefined;
    const restoredSelectedFocusTree = focusTrees.find(focusTree => focusTree.id === restoredSelectedFocusTreeId);
    const preferredSelectedFocusTreeId = isNonEmptyFocusTree(restoredSelectedFocusTree)
        ? restoredSelectedFocusTreeId
        : bootstrapSelectedFocusTreeId;
    const resolvedSelection = resolveFocusTreeSelection(
        focusTrees,
        preferredSelectedFocusTreeId,
        (sanitizedRestoredState.selectedFocusTreeIndex as number | undefined) ?? 0,
    );
    return {
        selectedExprs: (sanitizedRestoredState.selectedExprs as ConditionItem[] | undefined) ?? [],
        conditionPresetsByTree: normalizeConditionPresetsByTree(
            (sanitizedRestoredState.conditionPresetsByTree as FocusConditionPresetsByTree | undefined)
            ?? persistedConditionPresetsByTree
            ?? {},
        ),
        selectedFocusTreeIndex: resolvedSelection.selectedFocusTreeIndex,
        selectedFocusTreeId: resolvedSelection.selectedFocusTreeId,
        selectedFocusIdsByTree: (sanitizedRestoredState.selectedFocusIdsByTree as Record<string, string[]> | undefined) ?? {},
        focusPositionEditMode: !!sanitizedRestoredState.focusPositionEditMode,
        searchboxValue: (sanitizedRestoredState.searchboxValue as string | undefined) || '',
    };
}
