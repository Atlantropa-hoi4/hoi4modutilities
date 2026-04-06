import { StyleTable } from "../../util/styletable";
import { renderFocusHtmlTemplate } from "./focusrender";
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
    };
}

export function isPendingPlaceholderFocus(focus: Pick<Focus, 'layoutEditKey'> | undefined): boolean {
    return !!focus?.layoutEditKey && focus.layoutEditKey.startsWith('pending:');
}

export function renderPendingPlaceholderFocusTemplate(
    focus: Pick<Focus, 'id' | 'file' | 'layoutEditKey'>,
): string {
    const placeholderFocus: Focus = {
        ...focus,
        x: 0,
        y: 0,
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
        isInCurrentFile: true,
        layout: {
            editKey: focus.layoutEditKey,
            focusId: focus.id,
            editable: true,
            sourceFile: focus.file,
            basePosition: { x: 0, y: 0 },
            relativePositionId: undefined,
            offsets: [],
        },
        lintWarningCount: 0,
        lintInfoCount: 0,
    };
    return renderFocusHtmlTemplate(placeholderFocus, new StyleTable(), focus.file, 96, 130);
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
