import { ConditionItem } from '../../hoiformat/condition';

export interface FocusConditionPreset {
    id: string;
    name: string;
    exprKeys: string[];
}

export const customConditionPresetId = '__custom__';

export function conditionItemToExprKey(condition: ConditionItem): string {
    return `${condition.scopeName}!|${condition.nodeContent}`;
}

export function exprKeyToConditionItem(exprKey: string): ConditionItem {
    const index = exprKey.indexOf('!|');
    if (index === -1) {
        return {
            scopeName: '',
            nodeContent: exprKey,
        };
    }

    return {
        scopeName: exprKey.substring(0, index),
        nodeContent: exprKey.substring(index + 2),
    };
}

export function normalizeConditionExprKeys(exprKeys: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(exprKeys))).sort();
}

export function normalizeConditionItems(conditions: Iterable<ConditionItem>): string[] {
    return normalizeConditionExprKeys(Array.from(conditions, conditionItemToExprKey));
}

export function filterConditionExprKeys(exprKeys: Iterable<string>, availableExprKeys: Iterable<string>): string[] {
    const available = new Set(availableExprKeys);
    return normalizeConditionExprKeys(Array.from(exprKeys).filter(exprKey => available.has(exprKey)));
}

export function findMatchingConditionPresetId(
    presets: Iterable<FocusConditionPreset>,
    exprKeys: Iterable<string>,
): string | undefined {
    const normalizedExprKeys = normalizeConditionExprKeys(exprKeys);
    for (const preset of presets) {
        if (areConditionExprKeySetsEqual(preset.exprKeys, normalizedExprKeys)) {
            return preset.id;
        }
    }

    return undefined;
}

export function areConditionExprKeySetsEqual(left: Iterable<string>, right: Iterable<string>): boolean {
    const normalizedLeft = normalizeConditionExprKeys(left);
    const normalizedRight = normalizeConditionExprKeys(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((exprKey, index) => exprKey === normalizedRight[index]);
}

export function deleteConditionPreset(
    presets: readonly FocusConditionPreset[],
    presetId: string,
): FocusConditionPreset[] {
    return presets.filter(preset => preset.id !== presetId);
}
