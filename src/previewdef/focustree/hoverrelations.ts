export interface HoverRelationFocusLike {
    prerequisite: string[][];
    exclusive: string[];
    relativePositionId?: string;
}

export function getDirectlyRelatedFocusIds(
    focuses: Record<string, HoverRelationFocusLike>,
    focusId: string | undefined,
): string[] {
    if (!focusId) {
        return [];
    }

    const focus = focuses[focusId];
    if (!focus) {
        return [];
    }

    const related = new Set<string>();
    related.add(focusId);

    focus.prerequisite.flat().forEach(parentFocusId => {
        if (parentFocusId in focuses) {
            related.add(parentFocusId);
        }
    });

    focus.exclusive.forEach(exclusiveFocusId => {
        if (exclusiveFocusId in focuses) {
            related.add(exclusiveFocusId);
        }
    });

    Object.entries(focuses).forEach(([candidateFocusId, candidateFocus]) => {
        if (candidateFocusId === focusId) {
            return;
        }

        if (candidateFocus.relativePositionId === focusId
            || candidateFocus.prerequisite.some(group => group.includes(focusId))
            || candidateFocus.exclusive.includes(focusId)) {
            related.add(candidateFocusId);
        }
    });

    return Array.from(related);
}
