import { ConditionItem } from "../../hoiformat/condition";
import type { FocusTreeKind } from "./focustreeschematypes";

const completedFocusPrefix = 'has_completed_focus = ';
const focusTreePrefix = 'has_focus_tree = ';

export function isSelectableFocusTreeConditionExpr(kind: FocusTreeKind, expr: ConditionItem): boolean {
    if (expr.scopeName !== '') {
        return true;
    }

    if (expr.nodeContent.startsWith(completedFocusPrefix)) {
        return false;
    }

    return kind !== 'focus' || !expr.nodeContent.startsWith(focusTreePrefix);
}

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
