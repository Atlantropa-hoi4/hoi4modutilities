import type { ConditionItem } from '../../src/hoiformat/condition';
import {
    FocusConditionPreset,
    findMatchingConditionPreset,
    normalizeConditionExprKeys,
    normalizeConditionPresetsByTree,
} from '../../src/previewdef/focustree/conditionpresets';
import { resolveSelectedConditionExprKeys } from '../../src/previewdef/focustree/conditionselection';
import { isSelectableFocusTreeConditionExpr } from '../../src/previewdef/focustree/conditionexprs';
import { getCachedFocusTreeLayoutPlan } from '../../src/previewdef/focustree/layoutplan';
import type { FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import { getState, setState } from '../util/common';
import { feLocalize } from '../util/i18n';
import { vscode } from '../util/vscode';
import { runtime } from './runtime';

export interface DropdownOptionData {
    value: string;
    text: string;
}

export function replaceDivDropdownOptions(select: HTMLDivElement, options: readonly DropdownOptionData[]): void {
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    const optionElements = options.map(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.setAttribute('value', option.value);
        optionElement.textContent = option.text;
        return optionElement;
    });
    select.replaceChildren(valueSpan, ...optionElements);
}

export function replaceSelectOptions(select: HTMLSelectElement, options: readonly DropdownOptionData[]): void {
    select.replaceChildren(...options.map(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.text;
        return optionElement;
    }));
}

export function conditionItemToExprKey(expr: ConditionItem): string {
    return `${expr.scopeName}!|${expr.nodeContent}`;
}

export function exprKeyToConditionItem(exprKey: string): ConditionItem {
    const separatorIndex = exprKey.indexOf('!|');
    if (separatorIndex < 0) {
        return { scopeName: '', nodeContent: exprKey };
    }

    return {
        scopeName: exprKey.slice(0, separatorIndex),
        nodeContent: exprKey.slice(separatorIndex + 2),
    };
}

function dedupeConditionExprs(exprs: readonly ConditionItem[]): ConditionItem[] {
    const result: ConditionItem[] = [];
    const seenExprKeys = new Set<string>();
    for (const expr of exprs) {
        const exprKey = `${expr.scopeName}\u001f${expr.nodeContent}`;
        if (!seenExprKeys.has(exprKey)) {
            seenExprKeys.add(exprKey);
            result.push(expr);
        }
    }
    return result;
}

export function getTreeConditionExprKeys(focusTree: FocusTreeView): string[] {
    return normalizeConditionExprKeys(
        dedupeConditionExprs(focusTree.conditionExprs)
            .filter(expr => isSelectableFocusTreeConditionExpr(focusTree.kind, expr))
            .map(conditionItemToExprKey),
    );
}

export function setSelectedExprsFromExprKeys(exprKeys: readonly string[]): void {
    runtime.selectedExprs = exprKeys.map(exprKeyToConditionItem);
    setState({ selectedExprs: runtime.selectedExprs });
}

export function getSelectedExprKeys(): string[] {
    return normalizeConditionExprKeys(runtime.selectedExprs.map(conditionItemToExprKey));
}

export function getSelectedExprKeysForFocusTree(focusTree: FocusTreeView, clearCondition = false): string[] {
    return resolveSelectedConditionExprKeys(
        runtime.selectedExprs.map(conditionItemToExprKey),
        getTreeConditionExprKeys(focusTree),
        clearCondition,
    );
}

/** Picks the first condition that renders any focus when no condition is selected explicitly. */
export function getImplicitRenderExprKeysForFocusTree(
    focusTree: FocusTreeView,
    checkedExprs: readonly ConditionItem[],
): string[] {
    if (!runtime.useConditionInFocus) {
        return [];
    }

    for (const exprKey of getTreeConditionExprKeys(focusTree)) {
        const candidateExprs = [
            { scopeName: '', nodeContent: `has_focus_tree = ${focusTree.id}` },
            ...checkedExprs,
            exprKeyToConditionItem(exprKey),
        ];
        if (getCachedFocusTreeLayoutPlan(focusTree, candidateExprs, true).focusGridBoxItems.length > 0) {
            return [exprKey];
        }
    }

    return [];
}

export function getCheckedFocusConditionExprs(): ConditionItem[] {
    const focusCheckState: Record<string, boolean> = getState().checkedFocuses ?? {};
    return Object.keys(focusCheckState)
        .filter(focusId => focusCheckState[focusId])
        .map(focusId => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + focusId }));
}

export function getToolbarConditionExprs(focusTree: FocusTreeView): ConditionItem[] {
    return [
        { scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id },
        ...getCheckedFocusConditionExprs(),
        ...runtime.selectedExprs,
    ];
}

export function getConditionPresetsForTree(treeId: string): FocusConditionPreset[] {
    return runtime.conditionPresetsByTree[treeId] ?? [];
}

function persistConditionPresets(): void {
    runtime.conditionPresetsByTree = normalizeConditionPresetsByTree(runtime.conditionPresetsByTree);
    setState({ conditionPresetsByTree: runtime.conditionPresetsByTree });
    vscode.postMessage({
        command: 'persistFocusConditionPresets',
        presetsByTree: runtime.conditionPresetsByTree,
    });
}

export function setConditionPresetsForTree(treeId: string, presets: FocusConditionPreset[]): void {
    const nextConditionPresetsByTree = { ...runtime.conditionPresetsByTree };
    if (presets.length === 0) {
        delete nextConditionPresetsByTree[treeId];
    } else {
        nextConditionPresetsByTree[treeId] = presets;
    }

    runtime.conditionPresetsByTree = nextConditionPresetsByTree;
    persistConditionPresets();
}

export function getSelectedConditionPreset(focusTree: FocusTreeView): FocusConditionPreset | undefined {
    return findMatchingConditionPreset(getConditionPresetsForTree(focusTree.id), getSelectedExprKeys());
}

export function refreshConditionPresetUi(focusTree: FocusTreeView): void {
    const presetContainer = document.getElementById('condition-preset-container') as HTMLDivElement | null;
    const hasConditionExprs = getTreeConditionExprKeys(focusTree).length > 0;
    if (presetContainer) {
        presetContainer.style.display = runtime.useConditionInFocus && hasConditionExprs ? 'flex' : 'none';
    }

    const dropdown = runtime.dropdowns.conditionPresets;
    if (!dropdown) {
        return;
    }

    const presets = getConditionPresetsForTree(focusTree.id);
    replaceDivDropdownOptions(dropdown.select, [
        { value: '__custom__', text: feLocalize('TODO', '(Custom)') },
        ...presets.map(preset => ({ value: preset.id, text: preset.name })),
    ]);
    const selectedPreset = getSelectedConditionPreset(focusTree);
    runtime.suppressConditionPresetSelectionChange = true;
    dropdown.selectedValues$.next([selectedPreset?.id ?? '__custom__']);
    runtime.suppressConditionPresetSelectionChange = false;

    const deleteButton = document.getElementById('delete-condition-preset') as HTMLButtonElement | null;
    if (deleteButton) {
        deleteButton.disabled = !selectedPreset;
    }
}

function createConditionPresetId(name: string): string {
    const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const prefix = normalizedName || 'preset';
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveConditionPreset(treeId: string, name: string, exprKeys: readonly string[]): void {
    const presets = getConditionPresetsForTree(treeId);
    const normalizedExprKeys = normalizeConditionExprKeys(exprKeys);
    const matchingPreset = findMatchingConditionPreset(presets, normalizedExprKeys);
    const trimmedName = name.trim();
    if (matchingPreset) {
        setConditionPresetsForTree(
            treeId,
            presets.map(preset => preset.id === matchingPreset.id ? { ...preset, name: trimmedName, exprKeys: normalizedExprKeys } : preset),
        );
        return;
    }

    setConditionPresetsForTree(treeId, [
        ...presets,
        {
            id: createConditionPresetId(trimmedName),
            name: trimmedName,
            exprKeys: normalizedExprKeys,
        },
    ]);
}

/** Clears an explicit condition selection that no longer renders any focus. */
export function clearSelectedExprs(focusTree: FocusTreeView): void {
    runtime.selectedExprs = [];
    setState({ selectedExprs: runtime.selectedExprs });
    if (runtime.dropdowns.conditions) {
        runtime.suppressConditionSelectionChange = true;
        runtime.dropdowns.conditions.selectedValues$.next([]);
        runtime.suppressConditionSelectionChange = false;
    }
    refreshConditionPresetUi(focusTree);
}
