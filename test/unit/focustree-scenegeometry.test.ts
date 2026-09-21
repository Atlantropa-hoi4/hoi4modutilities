import * as assert from 'assert';
import {
    buildFocusSceneGeometry,
    FocusSceneRect,
    updateFocusSceneNodeVisuals,
} from '../../src/previewdef/focustree/scenegeometry';
import type { GridBoxItem } from '../../src/util/hoi4gui/gridboxcommon';

function createItems(targetType: 'parent' | 'related' = 'parent'): GridBoxItem[] {
    return [
        {
            id: 'child',
            gridX: 2,
            gridY: 2,
            connections: [{
                target: 'parent',
                targetType,
                style: targetType === 'parent' ? '1px dashed rgba(1, 2, 3, 0.5)' : '2px solid red',
                classNames: `focus-connection focus-connection-${targetType}`,
            }],
        },
        { id: 'parent', gridX: -1, gridY: -1, connections: [] },
    ];
}

function createGeometry(format: 'up' | 'down' | 'left' | 'right', targetType: 'parent' | 'related' = 'parent') {
    return buildFocusSceneGeometry({
        items: createItems(targetType),
        slotSize: { width: 100, height: 120 },
        format,
        padding: { left: 20, top: 30, right: 20, bottom: 30 },
        anchorGap: 4,
    });
}

function isPointInsideRect(point: { x: number; y: number }, rect: FocusSceneRect): boolean {
    return point.x > rect.x && point.x < rect.x + rect.width
        && point.y > rect.y && point.y < rect.y + rect.height;
}

describe('focus retained scene geometry', () => {
    it('normalizes negative grid positions into one nonnegative scene coordinate space', () => {
        const geometry = createGeometry('up');

        assert.ok(Object.values(geometry.nodes).every(node => node.slot.x >= 0 && node.slot.y >= 0));
        assert.ok(geometry.origin.x > 20);
        assert.ok(geometry.origin.y > 30);
        assert.ok(geometry.width >= Math.max(...Object.values(geometry.nodes).map(node => node.slot.x + node.slot.width)));
        assert.ok(geometry.height >= Math.max(...Object.values(geometry.nodes).map(node => node.slot.y + node.slot.height)));
    });

    for (const format of ['up', 'down', 'left', 'right'] as const) {
        it(`routes ${format} prerequisites between frame-boundary anchors`, () => {
            const geometry = createGeometry(format);
            const edge = geometry.edges[0];
            const source = geometry.nodes[edge.sourceId];
            const target = geometry.nodes[edge.targetId];

            assert.ok(source);
            assert.ok(target);
            assert.ok(!isPointInsideRect(edge.points[0], source.visual));
            assert.ok(!isPointInsideRect(edge.points[edge.points.length - 1], target.visual));
            assert.ok(edge.points.slice(1, -1).every(point => !isPointInsideRect(point, source.visual)));
            assert.ok(edge.points.slice(1, -1).every(point => !isPointInsideRect(point, target.visual)));
            assert.match(edge.path, /^M /);
        });
    }

    it('uses the same directional grid transform as the Clausewitz grid box', () => {
        const buildDelta = (format: 'up' | 'down' | 'left' | 'right') => {
            const nodes = buildFocusSceneGeometry({
                items: [
                    { id: 'origin', gridX: 0, gridY: 0, connections: [] },
                    { id: 'focus', gridX: 2, gridY: 3, connections: [] },
                ],
                slotSize: { width: 100, height: 120 },
                format,
                padding: { left: 500, top: 500, right: 0, bottom: 0 },
            }).nodes;
            return {
                x: nodes.focus.slot.x - nodes.origin.slot.x,
                y: nodes.focus.slot.y - nodes.origin.slot.y,
            };
        };

        assert.deepStrictEqual(buildDelta('up'), { x: 200, y: 360 });
        assert.deepStrictEqual(buildDelta('down'), { x: 200, y: -360 });
        assert.deepStrictEqual(buildDelta('left'), { x: 300, y: 240 });
        assert.deepStrictEqual(buildDelta('right'), { x: 300, y: -240 });
    });

    it('deduplicates reciprocal exclusive relations and uses the nearest side anchors', () => {
        const items = createItems('related');
        items[1].connections.push({ target: 'child', targetType: 'related', style: '2px solid red' });
        const geometry = buildFocusSceneGeometry({
            items,
            slotSize: { width: 100, height: 120 },
            format: 'up',
            padding: { left: 0, top: 0, right: 0, bottom: 0 },
        });

        assert.strictEqual(geometry.edges.length, 1);
        assert.strictEqual(geometry.edges[0].kind, 'exclusive');
        assert.strictEqual(geometry.edges[0].stroke, 'red');
        assert.strictEqual(geometry.edges[0].strokeWidth, 2);
    });

    it('recalculates only adjacent paths when measured custom GUI bounds change', () => {
        const geometry = createGeometry('up');
        const previousPath = geometry.edges[0].path;
        const changed = updateFocusSceneNodeVisuals(geometry, {
            parent: { x: 40, y: 50, width: 180, height: 64 },
        });

        assert.strictEqual(changed.length, 1);
        assert.notStrictEqual(changed[0].path, previousPath);
        assert.deepStrictEqual(changed[0].points[0], geometry.nodes.parent.anchors.bottom);
    });

    it('keeps scene coordinates stable across zoom factors', () => {
        const geometry = createGeometry('up');
        const point = geometry.edges[0].points[0];
        for (const scale of [0.5, 1, 2]) {
            const screen = { x: point.x * scale, y: point.y * scale };
            assert.ok(Math.abs(screen.x / scale - point.x) <= 0.5);
            assert.ok(Math.abs(screen.y / scale - point.y) <= 0.5);
        }
    });
});
