import * as assert from 'assert';
import { measureFocusSceneNodeVisuals } from '../../webviewsrc/focustree/scenegeometry';
import {
    buildFocusSceneGeometry,
    updateFocusSceneNodeVisuals,
} from '../../src/previewdef/focustree/scenegeometry';
import type { FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';
import type { GridBoxItem } from '../../src/util/hoi4gui/gridboxcommon';

function createWrapper(
    visuals: FocusSceneRect[],
    icons: FocusSceneRect[],
    frames: FocusSceneRect[] = [],
    scale = 1,
    decorations: FocusSceneRect[] = [],
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
            const rects = selector.includes('.navigator') ? [
                ...visuals,
                ...(selector.includes('.focus-gui-symbol') ? icons : []),
                ...(selector.includes('.focus-frame-gfx') ? frames : []),
                ...(selector.includes('.focus-decoration-gfx') ? decorations : []),
            ] : selector.includes('[data-preview-label-css-toggle') ? [...visuals, ...frames]
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
        assert.deepStrictEqual(hydrated.visual, { x: -80, y: -32, width: 256, height: 137 });
    });

    it('includes nested GUI frames and decorations when their outer wrapper has no size', () => {
        const decoration = { x: -16, y: -12, width: 128, height: 24 };
        const measurement = measureFocusSceneNodeVisuals(
            createWrapper([{ x: 0, y: 0, width: 0, height: 0 }, label], [icon], [frame], 1, [decoration]),
            sceneRect, 1,
        );
        assert.deepStrictEqual(measurement.visual, { x: -80, y: -12, width: 256, height: 117 });
        assert.deepStrictEqual(measurement.exclusiveVisual, icon);
        assert.deepStrictEqual(measurement.connectionVisual, { x: -80, y: 0, width: 256, height: 105 });
    });

    it('anchors outgoing links to the caption when a padded symbol extends below it', () => {
        const padded = { x: -16, y: -32, width: 128, height: 192 };
        const measurement = measureFocusSceneNodeVisuals(createWrapper([label], [padded]), sceneRect, 1);
        assert.deepStrictEqual(measurement.connectionVisual, label);
        assert.deepStrictEqual(measurement.exclusiveVisual, padded);
        assert.strictEqual(measurement.visual.y + measurement.visual.height, 160);
    });

    for (const scale of [0.5, 1, 2]) {
        it(`keeps prerequisites above exclusive links after nested GUI icons hydrate at ${scale}x zoom`, () => {
            const items: GridBoxItem[] = [
                { id: 'swords', gridX: 0, gridY: 1, connections: [] },
                { id: 'greasing', gridX: 2, gridY: 1, connections: [] },
                { id: 'orbital', gridX: 5, gridY: 1, connections: [] },
                { id: 'past', gridX: 1, gridY: 2, connections: [
                    { target: 'swords', targetType: 'parent' },
                    { target: 'greasing', targetType: 'parent' },
                    { target: 'future', targetType: 'related' },
                ] },
                { id: 'future', gridX: 5, gridY: 2, connections: [
                    { target: 'greasing', targetType: 'parent' },
                    { target: 'orbital', targetType: 'parent' },
                    { target: 'past', targetType: 'related' },
                ] },
            ];
            const geometry = buildFocusSceneGeometry({
                items,
                slotSize: { width: 96, height: 130 },
                padding: { left: 0, top: 0, right: 0, bottom: 0 },
            });
            const labels: Record<string, FocusSceneRect> = {
                swords: { x: 9, y: 240, width: 160, height: 44 },
                greasing: { x: 201, y: 240, width: 160, height: 44 },
                orbital: { x: 489, y: 240, width: 160, height: 44 },
                past: { x: 105, y: 370, width: 160, height: 44 },
                future: { x: 489, y: 370, width: 160, height: 44 },
            };
            const icons: Record<string, FocusSceneRect> = {
                swords: { x: 41, y: 176, width: 96, height: 64 },
                greasing: { x: 233, y: 176, width: 96, height: 64 },
                orbital: { x: 521, y: 176, width: 96, height: 64 },
                past: { x: 97, y: 270, width: 176, height: 128 },
                future: { x: 481, y: 254, width: 176, height: 160 },
            };
            const measure = (focusId: string, symbol: FocusSceneRect) => {
                const measured = measureFocusSceneNodeVisuals(createWrapper([
                    { x: 0, y: 0, width: 0, height: 0 }, labels[focusId],
                ], [symbol], [], scale), sceneRect, scale);
                updateFocusSceneNodeVisuals(geometry,
                    { [focusId]: measured.visual }, { [focusId]: measured.exclusiveVisual },
                    { [focusId]: measured.connectionVisual });
            };
            // Cards mount with placeholders, then the symbols hydrate in separate batches.
            for (const [focusId, symbol] of Object.entries(icons)) {
                measure(focusId, { x: symbol.x, y: symbol.y, width: 56, height: 56 });
            }
            for (const [focusId, symbol] of Object.entries(icons)) {
                measure(focusId, symbol);
            }

            const exclusive = geometry.edges.filter(edge => edge.kind === 'exclusive');
            assert.strictEqual(exclusive.length, 1);
            const exclusiveY = exclusive[0].points[0].y;
            for (const edge of geometry.edges.filter(candidate => candidate.kind === 'prerequisite')) {
                const end = edge.points[edge.points.length - 1];
                const targetIcon = icons[edge.targetId];
                assert.ok(end.y <= targetIcon.y + targetIcon.height / 2,
                    'Prerequisites must reach the icon without continuing to its label');
                assert.ok(edge.points[0].y > labels[edge.sourceId].y + labels[edge.sourceId].height);
                assert.ok(edge.points.slice(1).every(point => point.y >= edge.points[0].y),
                    'Prerequisites must not turn back into their parent label after hydration');
                for (let index = 1; index < edge.points.length; index += 1) {
                    const previous = edge.points[index - 1];
                    const point = edge.points[index];
                    if (point.y === previous.y && point.x !== previous.x) {
                        assert.ok(point.y < exclusiveY - 12, 'Prerequisite corridors must not run along the exclusive link');
                    }
                }
            }
        });
    }

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
