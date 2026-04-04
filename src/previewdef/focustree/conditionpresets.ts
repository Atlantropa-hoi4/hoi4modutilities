export interface FocusConditionPreset {
    id: string;
    name: string;
    exprKeys: string[];
}

export function normalizeConditionExprKeys(exprKeys: readonly string[]): string[] {
    return Array.from(new Set(exprKeys.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

export function filterConditionPresetExprKeys(
    exprKeys: readonly string[],
    availableExprKeys: Iterable<string>,
): string[] {
    const availableExprKeySet = new Set(availableExprKeys);
    return normalizeConditionExprKeys(Array.from(exprKeys).filter(exprKey => availableExprKeySet.has(exprKey)));
}

export function findMatchingConditionPreset(
    presets: readonly FocusConditionPreset[],
    exprKeys: readonly string[],
): FocusConditionPreset | undefined {
    const normalizedExprKeys = normalizeConditionExprKeys(exprKeys);
    return presets.find(preset => areConditionExprKeySetsEqual(preset.exprKeys, normalizedExprKeys));
}

export function areConditionExprKeySetsEqual(left: readonly string[], right: readonly string[]): boolean {
    const normalizedLeft = normalizeConditionExprKeys(left);
    const normalizedRight = normalizeConditionExprKeys(right);
    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }

    return normalizedLeft.every((exprKey, index) => exprKey === normalizedRight[index]);
}
