import { NumberPosition } from "../../util/common";
import type { FocusTree } from "./schema";

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

export function getRelativePositionBranchRootFocusId(
    focusId: string,
    focusTree: Pick<FocusTree, 'focuses'> | undefined,
): string {
    const focusIdChain: string[] = [];
    let currentFocusId = focusId;
    const visitedFocusIds = new Set<string>();

    while (currentFocusId && !visitedFocusIds.has(currentFocusId)) {
        visitedFocusIds.add(currentFocusId);
        focusIdChain.push(currentFocusId);
        const focus = focusTree?.focuses[currentFocusId];
        const parentFocusId = focus?.relativePositionId;
        if (!parentFocusId || !focusTree?.focuses[parentFocusId]) {
            break;
        }

        currentFocusId = parentFocusId;
    }

    return focusIdChain.length > 1
        ? focusIdChain[focusIdChain.length - 2]
        : focusId;
}

export function getTopMostBranchRootFocusAnchorId(
    focusIds: readonly string[],
    focusTree: Pick<FocusTree, 'focuses'> | undefined,
    positions: Record<string, NumberPosition>,
    fallbackFocusId: string,
): string {
    const fallbackAnchorId = getRelativePositionBranchRootFocusId(fallbackFocusId, focusTree);
    const branchRootFocusIds = Array.from(new Set(
        (focusIds.length > 0 ? focusIds : [fallbackFocusId])
            .map(focusId => getRelativePositionBranchRootFocusId(focusId, focusTree))
            .filter((focusId): focusId is string => !!focusId),
    ));

    return getTopMostFocusAnchorId(branchRootFocusIds, positions, fallbackAnchorId);
}
