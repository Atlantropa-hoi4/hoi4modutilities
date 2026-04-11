import { NumberPosition } from '../../util/common';

function sortFocusIdsByViewportAnchor(
    focusIds: readonly string[],
    focusPositions: Readonly<Record<string, NumberPosition>>,
): string[] {
    return [...focusIds].sort((leftFocusId, rightFocusId) => {
        const leftPosition = focusPositions[leftFocusId];
        const rightPosition = focusPositions[rightFocusId];
        if (!leftPosition && !rightPosition) {
            return leftFocusId.localeCompare(rightFocusId);
        }
        if (!leftPosition) {
            return 1;
        }
        if (!rightPosition) {
            return -1;
        }
        return leftPosition.y - rightPosition.y
            || leftPosition.x - rightPosition.x
            || leftFocusId.localeCompare(rightFocusId);
    });
}

export function getFocusTreeViewportAnchorId(
    focusPositions: Readonly<Record<string, NumberPosition>>,
    preferredFocusIds: readonly string[] = [],
): string | undefined {
    const availablePreferredFocusIds = preferredFocusIds.filter(focusId => !!focusPositions[focusId]);
    if (availablePreferredFocusIds.length > 0) {
        return sortFocusIdsByViewportAnchor(availablePreferredFocusIds, focusPositions)[0];
    }

    const allFocusIds = Object.keys(focusPositions);
    if (allFocusIds.length === 0) {
        return undefined;
    }

    return sortFocusIdsByViewportAnchor(allFocusIds, focusPositions)[0];
}
