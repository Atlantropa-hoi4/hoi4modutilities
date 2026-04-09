import { ConditionItem } from "../../src/hoiformat/condition";
import { FocusConditionPresetsByTree, normalizeConditionPresetsByTree } from "../../src/previewdef/focustree/conditionpresets";

export interface FocusTreeWebviewInitialState {
    selectedExprs: ConditionItem[];
    conditionPresetsByTree: FocusConditionPresetsByTree;
    selectedFocusTreeIndex: number;
    selectedFocusTreeId?: string;
    selectedFocusIdsByTree: Record<string, string[]>;
    focusPositionEditMode: boolean;
    searchboxValue: string;
}

export function createFocusTreeWebviewInitialState(
    restoredState: Record<string, unknown>,
    persistedConditionPresetsByTree: FocusConditionPresetsByTree | undefined,
): FocusTreeWebviewInitialState {
    return {
        selectedExprs: (restoredState.selectedExprs as ConditionItem[] | undefined) ?? [],
        conditionPresetsByTree: normalizeConditionPresetsByTree(
            (restoredState.conditionPresetsByTree as FocusConditionPresetsByTree | undefined)
            ?? persistedConditionPresetsByTree
            ?? {},
        ),
        selectedFocusTreeIndex: (restoredState.selectedFocusTreeIndex as number | undefined) ?? 0,
        selectedFocusTreeId: restoredState.selectedFocusTreeId as string | undefined,
        selectedFocusIdsByTree: (restoredState.selectedFocusIdsByTree as Record<string, string[]> | undefined) ?? {},
        focusPositionEditMode: !!restoredState.focusPositionEditMode,
        searchboxValue: (restoredState.searchboxValue as string | undefined) || '',
    };
}
