import { NumberPosition } from "../../util/common";

export interface FocusMinimapPoint {
    focusId: string;
    canvasX: number;
    canvasY: number;
    isSelected: boolean;
    isSearched: boolean;
    isLastNavigated: boolean;
}

export interface FocusMinimapModel {
    canvasWidth: number;
    canvasHeight: number;
    points: FocusMinimapPoint[];
}

export interface FocusMinimapTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
    drawWidth: number;
    drawHeight: number;
}

export function getFocusCanvasCenter(
    position: NumberPosition,
    xGridSize: number,
    yGridSize: number,
    leftPadding: number,
    topPadding: number,
): NumberPosition {
    return {
        x: leftPadding + position.x * xGridSize + xGridSize / 2,
        y: topPadding + position.y * yGridSize + yGridSize / 2,
    };
}

export function buildFocusMinimapModel(input: {
    positions: Record<string, NumberPosition>;
    xGridSize: number;
    yGridSize: number;
    leftPadding: number;
    topPadding: number;
    canvasWidth: number;
    canvasHeight: number;
    selectedFocusIds?: Iterable<string>;
    searchedFocusIds?: Iterable<string>;
    lastNavigatedFocusId?: string;
}): FocusMinimapModel {
    const selectedFocusIdSet = new Set(input.selectedFocusIds ?? []);
    const searchedFocusIdSet = new Set(input.searchedFocusIds ?? []);

    return {
        canvasWidth: Math.max(input.canvasWidth, 1),
        canvasHeight: Math.max(input.canvasHeight, 1),
        points: Object.entries(input.positions).map(([focusId, position]) => {
            const center = getFocusCanvasCenter(position, input.xGridSize, input.yGridSize, input.leftPadding, input.topPadding);
            return {
                focusId,
                canvasX: center.x,
                canvasY: center.y,
                isSelected: selectedFocusIdSet.has(focusId),
                isSearched: searchedFocusIdSet.has(focusId),
                isLastNavigated: input.lastNavigatedFocusId === focusId,
            };
        }),
    };
}

export function createFocusMinimapTransform(
    canvasWidth: number,
    canvasHeight: number,
    minimapWidth: number,
    minimapHeight: number,
    padding: number,
): FocusMinimapTransform {
    const innerWidth = Math.max(1, minimapWidth - padding * 2);
    const innerHeight = Math.max(1, minimapHeight - padding * 2);
    const scale = Math.min(innerWidth / Math.max(canvasWidth, 1), innerHeight / Math.max(canvasHeight, 1));
    const drawWidth = Math.max(1, canvasWidth * scale);
    const drawHeight = Math.max(1, canvasHeight * scale);
    return {
        scale,
        drawWidth,
        drawHeight,
        offsetX: padding + (innerWidth - drawWidth) / 2,
        offsetY: padding + (innerHeight - drawHeight) / 2,
    };
}

export function projectCanvasPointToMinimap(
    point: NumberPosition,
    transform: FocusMinimapTransform,
): NumberPosition {
    return {
        x: transform.offsetX + point.x * transform.scale,
        y: transform.offsetY + point.y * transform.scale,
    };
}

export function projectMinimapPointToCanvas(
    point: NumberPosition,
    transform: FocusMinimapTransform,
): NumberPosition {
    return {
        x: Math.max(0, (point.x - transform.offsetX) / transform.scale),
        y: Math.max(0, (point.y - transform.offsetY) / transform.scale),
    };
}

export function getFocusMinimapViewportRect(input: {
    scrollX: number;
    scrollY: number;
    contentPageLeft: number;
    contentPageTop: number;
    scale: number;
    viewportWidth: number;
    viewportHeight: number;
    transform: FocusMinimapTransform;
    canvasWidth: number;
    canvasHeight: number;
}): { left: number; top: number; width: number; height: number } {
    const canvasLeft = Math.max(0, (input.scrollX - input.contentPageLeft) / input.scale);
    const canvasTop = Math.max(0, (input.scrollY - input.contentPageTop) / input.scale);
    const canvasWidth = Math.min(input.canvasWidth, Math.max(0, input.viewportWidth / input.scale));
    const canvasHeight = Math.min(input.canvasHeight, Math.max(0, input.viewportHeight / input.scale));
    const topLeft = projectCanvasPointToMinimap({ x: canvasLeft, y: canvasTop }, input.transform);
    return {
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(8, canvasWidth * input.transform.scale),
        height: Math.max(8, canvasHeight * input.transform.scale),
    };
}

export function getScrollTargetForCanvasPoint(input: {
    canvasPoint: NumberPosition;
    contentPageLeft: number;
    contentPageTop: number;
    scale: number;
    viewportWidth: number;
    viewportHeight: number;
}): NumberPosition {
    return {
        x: input.contentPageLeft + input.canvasPoint.x * input.scale - input.viewportWidth / 2,
        y: input.contentPageTop + input.canvasPoint.y * input.scale - input.viewportHeight / 2,
    };
}
