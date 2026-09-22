import type { FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';

export function measureFocusSceneNodeVisuals(
    wrapper: HTMLElement,
    sceneRect: Pick<DOMRect, 'left' | 'top'>,
    scale: number,
): { visual: FocusSceneRect; exclusiveVisual: FocusSceneRect } {
    const visualRects = measureVisibleElements(wrapper,
        '.navigator > :not(.focus-checkbox):not([hidden]), .navigator > :not(.focus-checkbox):not([hidden]) [data-preview-label-css-toggle="true"]');
    if (visualRects.length === 0) {
        visualRects.push((wrapper.querySelector<HTMLElement>('.navigator') ?? wrapper).getBoundingClientRect());
    }

    // Measure the rendered symbol, not its slot, title, or decorative overlay.
    let exclusiveRects = measureVisibleElements(wrapper, '.st-focus-icon-image, .focus-gui-symbol');
    if (exclusiveRects.length === 0) {
        exclusiveRects = measureVisibleElements(wrapper, '.focus-frame-gfx');
    }

    return {
        visual: toSceneRect(visualRects, sceneRect, scale),
        exclusiveVisual: toSceneRect(exclusiveRects.length > 0 ? exclusiveRects : visualRects, sceneRect, scale),
    };
}

function measureVisibleElements(wrapper: HTMLElement, selector: string): DOMRect[] {
    return Array.from(wrapper.querySelectorAll<HTMLElement>(selector))
        .map(element => element.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
}

function toSceneRect(rects: readonly DOMRect[], sceneRect: Pick<DOMRect, 'left' | 'top'>, scale: number): FocusSceneRect {
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return {
        x: (left - sceneRect.left) / scale,
        y: (top - sceneRect.top) / scale,
        width: (right - left) / scale,
        height: (bottom - top) / scale,
    };
}
