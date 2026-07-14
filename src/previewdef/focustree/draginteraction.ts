import { NumberPosition } from "../../util/common";

export interface FocusDragDelta {
    x: number;
    y: number;
}

export function hasFocusDragPassedThreshold(
    deltaPageX: number,
    deltaPageY: number,
    thresholdPx: number,
): boolean {
    return Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) >= thresholdPx;
}

export function getScaledFocusDragDelta(
    deltaPageX: number,
    deltaPageY: number,
    scale: number,
): FocusDragDelta {
    return {
        x: deltaPageX / scale,
        y: deltaPageY / scale,
    };
}

export function getSnappedFocusDragPosition(
    startingPosition: NumberPosition,
    scaledDelta: FocusDragDelta,
    xGridSize: number,
    yGridSize: number,
): NumberPosition {
    return {
        x: startingPosition.x + Math.round(scaledDelta.x / xGridSize),
        y: startingPosition.y + Math.round(scaledDelta.y / yGridSize),
    };
}
