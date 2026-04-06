import { Focus, FocusTree } from "./schema";

const emptyCondition = { _type: 'and', items: [] } as any;

export function createPlaceholderFocus(
    focusTree: FocusTree,
    focusId: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    activeFile: string,
): Focus {
    const sourceFile = focusTree.createTemplate?.sourceFile ?? activeFile;
    return {
        layoutEditKey: `pending:${focusId}`,
        x: Math.round(targetAbsoluteX),
        y: Math.round(targetAbsoluteY),
        id: focusId,
        icon: [{ icon: undefined, condition: emptyCondition }],
        available: undefined,
        availableIfCapitulated: false,
        hasAiWillDo: false,
        hasCompletionReward: false,
        prerequisite: [],
        prerequisiteGroupCount: 0,
        prerequisiteFocusCount: 0,
        exclusive: [],
        exclusiveCount: 0,
        hasAllowBranch: false,
        inAllowBranch: [],
        allowBranch: undefined,
        relativePositionId: undefined,
        offset: [],
        token: undefined,
        file: sourceFile,
        isInCurrentFile: true,
        layout: undefined,
        lintWarningCount: 0,
        lintInfoCount: 0,
    };
}

export function applyLocalFocusDeletion(
    focusTree: FocusTree,
    deletedFocusIds: readonly string[],
): void {
    const deletedSet = new Set(deletedFocusIds.filter(Boolean));
    if (deletedSet.size === 0) {
        return;
    }

    for (const focusId of deletedSet) {
        delete focusTree.focuses[focusId];
    }

    for (const focus of Object.values(focusTree.focuses)) {
        focus.prerequisite = focus.prerequisite
            .map(group => group.filter(focusId => !deletedSet.has(focusId)))
            .filter(group => group.length > 0);
        focus.prerequisiteGroupCount = focus.prerequisite.length;
        focus.prerequisiteFocusCount = focus.prerequisite.reduce((sum, group) => sum + group.length, 0);
        focus.exclusive = focus.exclusive.filter(focusId => !deletedSet.has(focusId));
        focus.exclusiveCount = focus.exclusive.length;
        focus.inAllowBranch = focus.inAllowBranch.filter(focusId => !deletedSet.has(focusId));
        if (focus.relativePositionId && deletedSet.has(focus.relativePositionId)) {
            focus.relativePositionId = undefined;
        }
    }
}
