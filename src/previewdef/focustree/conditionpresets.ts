export interface FocusConditionPreset {
    id: string;
    name: string;
    exprKeys: string[];
}

export type FocusConditionPresetsByTree = Record<string, FocusConditionPreset[]>;

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

export function normalizeConditionPreset(preset: Partial<FocusConditionPreset> | undefined): FocusConditionPreset | undefined {
    const id = preset?.id?.trim();
    const name = preset?.name?.trim();
    if (!id || !name) {
        return undefined;
    }

    return {
        id,
        name,
        exprKeys: normalizeConditionExprKeys(preset?.exprKeys ?? []),
    };
}

export function normalizeConditionPresets(presets: readonly Partial<FocusConditionPreset>[] | undefined): FocusConditionPreset[] {
    const normalized: FocusConditionPreset[] = [];
    const seenIds = new Set<string>();
    for (const preset of presets ?? []) {
        const current = normalizeConditionPreset(preset);
        if (!current || seenIds.has(current.id)) {
            continue;
        }

        seenIds.add(current.id);
        normalized.push(current);
    }

    return normalized;
}

export function normalizeConditionPresetsByTree(
    presetsByTree: Record<string, readonly Partial<FocusConditionPreset>[] | undefined> | undefined,
): FocusConditionPresetsByTree {
    const normalized: FocusConditionPresetsByTree = {};
    if (!presetsByTree) {
        return normalized;
    }

    for (const [treeId, presets] of Object.entries(presetsByTree)) {
        const trimmedTreeId = treeId.trim();
        if (!trimmedTreeId) {
            continue;
        }

        const normalizedPresets = normalizeConditionPresets(presets);
        if (normalizedPresets.length > 0) {
            normalized[trimmedTreeId] = normalizedPresets;
        }
    }

    return normalized;
}
