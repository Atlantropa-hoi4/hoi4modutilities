import { applyCondition, ConditionItem } from "../../hoiformat/condition";
import { Focus } from "./schema";

export interface FocusBadgeState {
    showAvailability: boolean;
    isAvailable: boolean;
    hasAllowBranch: boolean;
    availableIfCapitulated: boolean;
    prerequisiteGroupCount: number;
    prerequisiteFocusCount: number;
    exclusiveCount: number;
    hasAiWillDo: boolean;
    hasCompletionReward: boolean;
}

export function evaluateFocusBadgeState(
    focus: Focus,
    exprs: ConditionItem[],
    options: { enableAvailability: boolean },
): FocusBadgeState {
    return {
        showAvailability: options.enableAvailability,
        isAvailable: !options.enableAvailability || focus.available === undefined || applyCondition(focus.available, exprs),
        hasAllowBranch: focus.hasAllowBranch,
        availableIfCapitulated: focus.availableIfCapitulated,
        prerequisiteGroupCount: focus.prerequisiteGroupCount,
        prerequisiteFocusCount: focus.prerequisiteFocusCount,
        exclusiveCount: focus.exclusiveCount,
        hasAiWillDo: focus.hasAiWillDo,
        hasCompletionReward: focus.hasCompletionReward,
    };
}
