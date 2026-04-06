import { filterConditionPresetExprKeys } from "./conditionpresets";

export function resolveSelectedConditionExprKeys(
    selectedExprKeys: readonly string[],
    availableExprKeys: readonly string[],
    clearCondition: boolean,
    defaultExprKeyOnEmpty?: string,
): string[] {
    if (clearCondition) {
        return [];
    }

    const filteredExprKeys = filterConditionPresetExprKeys(selectedExprKeys, availableExprKeys);
    if (filteredExprKeys.length > 0 || !defaultExprKeyOnEmpty || !availableExprKeys.includes(defaultExprKeyOnEmpty)) {
        return filteredExprKeys;
    }

    return [defaultExprKeyOnEmpty];
}

export function shouldHideDisallowedFocuses(useConditionInFocus: boolean, selectedExprKeys: readonly string[]): boolean {
    return useConditionInFocus && selectedExprKeys.length > 0;
}
