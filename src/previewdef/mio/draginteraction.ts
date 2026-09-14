import type { NumberPosition } from '../../util/common';

export function hasMioDragPassedThreshold(deltaPageX: number, deltaPageY: number, thresholdPx: number): boolean {
    return Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) >= thresholdPx;
}

export function getMioGridDelta(
    deltaPageX: number,
    deltaPageY: number,
    scale: number,
    xGridSize: number,
    yGridSize: number,
): NumberPosition {
    return {
        x: Math.round(deltaPageX / scale / xGridSize),
        y: Math.round(deltaPageY / scale / yGridSize),
    };
}

export function getMovedMioPosition(position: NumberPosition, delta: NumberPosition): NumberPosition {
    return { x: position.x + delta.x, y: position.y + delta.y };
}

export function isMioAbsolutePositionInBounds(position: NumberPosition): boolean {
    return Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && Number.isInteger(position.x)
        && Number.isInteger(position.y)
        && position.x >= 0
        && position.x <= 9
        && position.y >= 0;
}
