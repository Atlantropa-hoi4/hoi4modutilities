import type { Format } from '../../hoiformat/gui';
import type { NumberPosition, NumberSize } from '../../util/common';
import { getGridBoxGridDelta } from '../../util/hoi4gui/gridboxcommon';

export function hasTechnologyDragPassedThreshold(
    deltaPageX: number,
    deltaPageY: number,
    thresholdPx: number,
): boolean {
    return Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) >= thresholdPx;
}

export function getTechnologyGridDelta(
    deltaPageX: number,
    deltaPageY: number,
    scale: number,
    format: Format['_name'],
    slotSize: NumberSize,
): NumberPosition {
    return getGridBoxGridDelta(deltaPageX, deltaPageY, scale, format, slotSize);
}

export function getMovedTechnologyPosition(
    start: NumberPosition,
    delta: NumberPosition,
): NumberPosition {
    return {
        x: start.x + delta.x,
        y: start.y + delta.y,
    };
}

export function getTechnologyDoubleClickCreateParent(
    selectedTechnologyIds: readonly string[],
    treeRoot: string,
    treeRootByTechnologyId: Readonly<Record<string, string>>,
): string {
    const selectedInTree = Array.from(new Set(selectedTechnologyIds))
        .filter(technologyId => treeRootByTechnologyId[technologyId] === treeRoot);
    return selectedInTree.length === 1 ? selectedInTree[0] : treeRoot;
}
