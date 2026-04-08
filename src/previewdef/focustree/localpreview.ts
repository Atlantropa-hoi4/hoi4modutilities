import { Focus, FocusTree } from "./schema";

const emptyCondition = { _type: 'and', items: [] } as any;

function escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

export function isPendingPlaceholderFocus(focus: Pick<Focus, 'layoutEditKey'> | undefined): boolean {
    return !!focus?.layoutEditKey && focus.layoutEditKey.startsWith('pending:');
}

export function renderPendingPlaceholderFocusTemplate(
    focus: Pick<Focus, 'id' | 'file' | 'layoutEditKey'>,
): string {
    return `<div
    class="navigator"
    start="undefined"
    end="undefined"
    data-focus-id="${escapeHtmlAttribute(focus.id)}"
    data-focus-editable="false"
    data-focus-source-file="${escapeHtmlAttribute(focus.file)}"
    style="width: 100%; height: 100%; text-align: center; cursor: pointer; position: relative; overflow: visible;">
        <div style="position: absolute; left: 12px; top: 10px; right: 12px; height: 71px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
            <div
            style="width: 56px; height: 56px; border: 1px dashed rgba(255, 255, 255, 0.45); background: rgba(255, 255, 255, 0.08); pointer-events: none;"></div>
        </div>
        <span style="margin: 10px -400px; margin-top: 85px; text-align: center; display: inline-block;">
        ${escapeHtmlText(focus.id)}
        </span>
    </div>`;
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
