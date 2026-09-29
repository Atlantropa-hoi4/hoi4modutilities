import { Focus } from './schema';
import { FocusTreeView } from './viewmodel';

const emptyCondition = { _type: 'and', items: [] } as any;

export function createPlaceholderFocus(
    focusTree: FocusTreeView,
    focusId: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    activeFile: string,
): Focus {
    const sourceFile = focusTree.createTemplate?.sourceFile ?? activeFile;
    const roundedX = Math.round(targetAbsoluteX);
    const roundedY = Math.round(targetAbsoluteY);
    return {
        layoutEditKey: `pending:${focusId}`,
        x: roundedX,
        y: roundedY,
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
        layout: {
            editKey: `pending:${focusId}`,
            focusId,
            editable: true,
            sourceFile,
            basePosition: {
                x: roundedX,
                y: roundedY,
            },
            relativePositionId: undefined,
            offsets: [],
        },
        lintWarningCount: 0,
        lintInfoCount: 0,
        searchFilters: [],
    };
}

export function applyLocalFocusDeletion(
    focusTree: FocusTreeView,
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
