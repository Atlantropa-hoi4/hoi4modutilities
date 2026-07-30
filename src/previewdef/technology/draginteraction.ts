import type { Format } from '../../hoiformat/gui';
import type { NumberPosition, NumberSize } from '../../util/common';
import { getGridBoxGridDelta } from '../../util/hoi4gui/gridboxcommon';

export interface TechnologyGridGeometry {
    format: Format['_name'];
    slotSize: NumberSize;
    gridSize: NumberSize;
}

interface TechnologyPointerEventTarget<TEvent> {
    addEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: TEvent) => void, capture: boolean): void;
    removeEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: TEvent) => void, capture: boolean): void;
}

export function registerTechnologyPointerGesture<TEvent>(
    target: TechnologyPointerEventTarget<TEvent>,
    move: (event: TEvent) => void,
    finish: (event: TEvent) => void,
    cancel: (event: TEvent) => void,
): () => void {
    const cleanup = () => {
        target.removeEventListener('pointermove', move, true);
        target.removeEventListener('pointerup', finish, true);
        target.removeEventListener('pointercancel', cancel, true);
    };
    target.addEventListener('pointermove', move, true);
    target.addEventListener('pointerup', finish, true);
    target.addEventListener('pointercancel', cancel, true);
    return cleanup;
}

export function getTechnologyGridGeometry(data: {
    gridFormat?: string;
    slotWidth?: string;
    slotHeight?: string;
    gridWidth?: string;
    gridHeight?: string;
}): TechnologyGridGeometry | undefined {
    const formats: readonly Format['_name'][] = ['up', 'down', 'left', 'right', 'center'];
    const format = formats.includes(data.gridFormat as Format['_name'])
        ? data.gridFormat as Format['_name']
        : 'up';
    const slotSize = { width: Number(data.slotWidth), height: Number(data.slotHeight) };
    const gridSize = { width: Number(data.gridWidth), height: Number(data.gridHeight) };
    return Object.values({ ...slotSize, ...gridSize }).every(value => Number.isFinite(value) && value > 0)
        ? { format, slotSize, gridSize }
        : undefined;
}

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
