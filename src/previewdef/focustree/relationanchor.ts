import { NumberPosition } from "../../util/common";

export function getTopMostFocusAnchorId(
    focusIds: readonly string[],
    positions: Record<string, NumberPosition>,
    fallbackFocusId: string,
): string {
    const availableFocusIds = focusIds.filter(focusId => !!positions[focusId]);
    if (availableFocusIds.length === 0) {
        return fallbackFocusId;
    }

    return [...availableFocusIds].sort((left, right) => {
        const leftPosition = positions[left];
        const rightPosition = positions[right];
        if (leftPosition.y !== rightPosition.y) {
            return leftPosition.y - rightPosition.y;
        }
        if (leftPosition.x !== rightPosition.x) {
            return leftPosition.x - rightPosition.x;
        }

        return left.localeCompare(right);
    })[0];
}
