import { FocusTree } from "./schema";

export interface FocusRelationVisualizationState {
    activeFocusIds: string[];
    prerequisiteParentIds: string[];
    exclusiveFocusIds: string[];
    relatedFocusIds: string[];
    prerequisiteGroupCount: number;
    prerequisiteFocusCount: number;
    exclusiveCount: number;
    hasGroupedPrerequisite: boolean;
}

export function collectFocusRelationVisualizationState(
    focusTree: FocusTree,
    activeFocusIds: Iterable<string>,
): FocusRelationVisualizationState {
    const activeIds = Array.from(new Set(activeFocusIds)).filter(focusId => !!focusTree.focuses[focusId]);
    const prerequisiteParentIds = new Set<string>();
    const exclusiveFocusIds = new Set<string>();
    const relatedFocusIds = new Set<string>(activeIds);
    let prerequisiteGroupCount = 0;
    let hasGroupedPrerequisite = false;

    for (const activeFocusId of activeIds) {
        const focus = focusTree.focuses[activeFocusId];
        if (!focus) {
            continue;
        }

        for (const prerequisiteGroup of focus.prerequisite) {
            if (prerequisiteGroup.length === 0) {
                continue;
            }

            prerequisiteGroupCount += 1;
            if (prerequisiteGroup.length > 1) {
                hasGroupedPrerequisite = true;
            }

            for (const parentFocusId of prerequisiteGroup) {
                if (!focusTree.focuses[parentFocusId]) {
                    continue;
                }

                prerequisiteParentIds.add(parentFocusId);
                relatedFocusIds.add(parentFocusId);
            }
        }

        for (const exclusiveFocusId of focus.exclusive) {
            if (!focusTree.focuses[exclusiveFocusId]) {
                continue;
            }

            exclusiveFocusIds.add(exclusiveFocusId);
            relatedFocusIds.add(exclusiveFocusId);
        }
    }

    return {
        activeFocusIds: activeIds,
        prerequisiteParentIds: Array.from(prerequisiteParentIds),
        exclusiveFocusIds: Array.from(exclusiveFocusIds),
        relatedFocusIds: Array.from(relatedFocusIds),
        prerequisiteGroupCount,
        prerequisiteFocusCount: prerequisiteParentIds.size,
        exclusiveCount: exclusiveFocusIds.size,
        hasGroupedPrerequisite,
    };
}
