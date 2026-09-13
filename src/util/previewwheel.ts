export type PreviewWheelMode = 'auto' | 'zoom' | 'scroll';

export function shouldZoomWheel(event: {
    ctrlKey: boolean; metaKey: boolean; deltaMode: number; deltaX: number; deltaY: number;
    wheelDeltaY?: number;
}, mode: string | undefined): boolean {
    if (event.ctrlKey || event.metaKey) { return true; }
    if (mode === 'zoom') { return true; }
    if (mode === 'scroll') { return false; }
    if (event.deltaX !== 0) { return false; }
    return event.deltaMode !== 0 || (event.wheelDeltaY !== undefined
        && event.wheelDeltaY !== 0 && Math.abs(event.wheelDeltaY) % 120 === 0);
}
