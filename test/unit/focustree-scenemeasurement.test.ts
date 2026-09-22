import * as assert from 'assert';
import { measureFocusSceneNodeVisuals } from '../../webviewsrc/focustree/scenegeometry';
import type { FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';

function createWrapper(
    visuals: FocusSceneRect[],
    icons: FocusSceneRect[],
    frames: FocusSceneRect[] = [],
    scale = 1,
): HTMLElement {
    const element = (rect: FocusSceneRect) => ({
        getBoundingClientRect: () => ({
            left: rect.x * scale + 15,
            top: rect.y * scale - 30,
            right: (rect.x + rect.width) * scale + 15,
            bottom: (rect.y + rect.height) * scale - 30,
            width: rect.width * scale,
            height: rect.height * scale,
        }),
    });
    return {
        querySelectorAll: (selector: string) => {
            const rects = selector.includes('.navigator') ? visuals
                : selector === '.focus-frame-gfx' ? frames : icons;
            return rects.map(element);
        },
        querySelector: () => element({ x: 0, y: 0, width: 96, height: 130 }),
    } as unknown as HTMLElement;
}

describe('focus scene measurement', () => {
    const icon = { x: 20, y: 18, width: 56, height: 56 };
    const label = { x: -80, y: 85, width: 256, height: 16 };
    const slot = { x: 12, y: 10, width: 72, height: 71 };
    const frame = { x: 0, y: 0, width: 96, height: 105 };
    const sceneRect = { left: 15, top: -30 };

    for (const scale of [0.5, 1, 2]) {
        it(`uses the icon instead of the label, slot, or decoration at ${scale}x zoom`, () => {
            const measurement = measureFocusSceneNodeVisuals(
                createWrapper([slot, label, frame], [icon], [frame], scale), sceneRect, scale,
            );
            assert.deepStrictEqual(measurement.exclusiveVisual, icon);
            assert.deepStrictEqual(measurement.visual, { x: -80, y: 0, width: 256, height: 105 });
        });
    }

    it('updates from a placeholder to a resized custom GUI symbol after hydration', () => {
        const customIcon = { x: -16, y: -32, width: 128, height: 96 };
        const initial = measureFocusSceneNodeVisuals(createWrapper([slot, label], [icon]), sceneRect, 1);
        const hydrated = measureFocusSceneNodeVisuals(createWrapper([frame, label], [customIcon]), sceneRect, 1);
        assert.deepStrictEqual(initial.exclusiveVisual, icon);
        assert.deepStrictEqual(hydrated.exclusiveVisual, customIcon);
    });

    it('falls back to a visible frame when the GUI has no visible symbol', () => {
        const hidden = { x: 0, y: 0, width: 0, height: 0 };
        const measurement = measureFocusSceneNodeVisuals(
            createWrapper([label, frame], [hidden], [hidden, frame]), sceneRect, 1,
        );
        assert.deepStrictEqual(measurement.exclusiveVisual, frame);
    });

    it('falls back to the card bounds when neither a symbol nor a frame is available', () => {
        const measurement = measureFocusSceneNodeVisuals(createWrapper([], []), sceneRect, 1);
        assert.deepStrictEqual(measurement.exclusiveVisual, { x: 0, y: 0, width: 96, height: 130 });
        assert.deepStrictEqual(measurement.exclusiveVisual, measurement.visual);
    });
});
