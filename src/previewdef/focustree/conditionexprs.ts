import { ConditionItem } from "../../hoiformat/condition";

const completedFocusPrefix = 'has_completed_focus = ';

export function collectCompletedFocusIds(conditionExprs: readonly ConditionItem[]): Set<string> {
    const result = new Set<string>();
    for (const expr of conditionExprs) {
        if (expr.scopeName !== '' || !expr.nodeContent.startsWith(completedFocusPrefix)) {
            continue;
        }

        const focusId = expr.nodeContent.slice(completedFocusPrefix.length).trim();
        if (focusId) {
            result.add(focusId);
        }
    }

    return result;
}
