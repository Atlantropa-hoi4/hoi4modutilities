export function areFocusIdGroupsEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const leftSet = new Set(left);
    const rightSet = new Set(right);
    return leftSet.size === rightSet.size
        && left.every(focusId => rightSet.has(focusId))
        && right.every(focusId => leftSet.has(focusId));
}

export function findBestMatchingFocusIdGroupIndex(
    groups: readonly (readonly string[])[],
    targetFocusIds: readonly string[],
): number {
    const exactIndex = groups.findIndex(group => areFocusIdGroupsEqual(group, targetFocusIds));
    if (exactIndex !== -1) {
        return exactIndex;
    }

    return groups.findIndex(group => targetFocusIds.some(focusId => group.includes(focusId)));
}

export function normalizeParentFocusIds(
    parentFocusId: string,
    parentFocusIds: readonly string[] | undefined,
    childFocusId: string,
): string[] {
    return Array.from(new Set(
        (parentFocusIds && parentFocusIds.length > 0 ? parentFocusIds : [parentFocusId])
            .filter(focusId => focusId && focusId !== childFocusId),
    ));
}

export function updatePrerequisiteGroupsAfterLinkApply(
    prerequisiteGroups: readonly (readonly string[])[],
    parentFocusIds: readonly string[],
    anchorParentFocusId: string,
    currentRelativePositionId: string | undefined,
): { prerequisiteGroups: string[][]; relativePositionId: string | undefined } {
    const nextPrerequisiteGroups = prerequisiteGroups.map(group => [...group]);
    const matchingGroupIndex = findBestMatchingFocusIdGroupIndex(nextPrerequisiteGroups, parentFocusIds);
    const matchingGroup = matchingGroupIndex !== -1 ? nextPrerequisiteGroups[matchingGroupIndex] : undefined;
    const hasExactGroup = !!matchingGroup && areFocusIdGroupsEqual(matchingGroup, parentFocusIds);

    if (hasExactGroup) {
        nextPrerequisiteGroups.splice(matchingGroupIndex, 1);
        return {
            prerequisiteGroups: nextPrerequisiteGroups,
            relativePositionId: currentRelativePositionId
                && (currentRelativePositionId === anchorParentFocusId || parentFocusIds.includes(currentRelativePositionId))
                ? undefined
                : currentRelativePositionId,
        };
    }

    if (matchingGroup) {
        nextPrerequisiteGroups[matchingGroupIndex] = Array.from(new Set([...matchingGroup, ...parentFocusIds]));
    } else {
        nextPrerequisiteGroups.push([...parentFocusIds]);
    }

    return {
        prerequisiteGroups: nextPrerequisiteGroups,
        relativePositionId: anchorParentFocusId,
    };
}
