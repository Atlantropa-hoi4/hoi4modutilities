import * as assert from 'assert';
import {
    buildFocusSceneGeometry,
    FocusSceneRect,
    updateFocusSceneNodeVisuals,
    updateFocusScenePositions,
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

    it('connects exclusive links to icon edges even when long labels overlap', () => {
        const geometry = createGeometry('up', 'related');
        updateFocusSceneNodeVisuals(geometry, {
            parent: { x: -72, y: 10, width: 240, height: 95 },
            child: { x: 120, y: 10, width: 240, height: 95 },
        }, {
            parent: { x: 20, y: 18, width: 56, height: 56 },
            child: { x: 212, y: 18, width: 56, height: 56 },
        });

        const edge = geometry.edges[0];
        assert.deepStrictEqual(edge.points[0], { x: 212, y: 46 });
        assert.deepStrictEqual(edge.points[edge.points.length - 1], { x: 76, y: 46 });
        assert.ok(edge.points.every(point => point.y === 46 && point.x >= 76 && point.x <= 212));

        const previousPath = edge.path;
        updateFocusSceneNodeVisuals(geometry, {
            parent: { x: -200, y: 10, width: 496, height: 95 },
        }, { parent: geometry.nodes.parent.exclusiveVisual });
        assert.strictEqual(edge.path, previousPath);
    });

    it('keeps the stationary endpoint attached when an exclusive focus moves to another row', () => {
        const geometry = createGeometry('up', 'related');
        const icons = {
            parent: { x: 20, y: 18, width: 56, height: 56 },
            child: { x: 212, y: 18, width: 56, height: 56 },
        };
        updateFocusSceneNodeVisuals(geometry, icons, icons);
        updateFocusSceneNodeVisuals(geometry, {
            child: { x: 120, y: 140, width: 240, height: 95 },
        }, {
            child: { x: 212, y: 148, width: 56, height: 56 },
        });

        assert.deepStrictEqual(geometry.edges[0].points, [
            { x: 212, y: 176 }, { x: 144, y: 176 }, { x: 144, y: 46 }, { x: 76, y: 46 },
        ]);
    });

    it('connects vertically aligned exclusive focuses to the top and bottom of their icons', () => {
        const geometry = createGeometry('up', 'related');
        const icons = {
            parent: { x: 20, y: 18, width: 56, height: 56 },
            child: { x: 20, y: 148, width: 56, height: 56 },
        };
        updateFocusSceneNodeVisuals(geometry, icons, icons);

        const edge = geometry.edges[0];
        assert.deepStrictEqual(edge.points[0], { x: 48, y: 148 });
        assert.deepStrictEqual(edge.points[edge.points.length - 1], { x: 48, y: 74 });
        assert.ok(edge.points.every(point => point.x === 48));
    });

    it('retains label clearance for prerequisites when exclusive icon bounds are measured', () => {
        const geometry = createGeometry('up');
        updateFocusSceneNodeVisuals(geometry, {
            parent: { x: 0, y: 10, width: 96, height: 95 },
            child: { x: 192, y: 140, width: 96, height: 95 },
        }, {
            parent: { x: 20, y: 18, width: 56, height: 56 },
            child: { x: 212, y: 148, width: 56, height: 56 },
        });

        const edge = geometry.edges[0];
        assert.deepStrictEqual(edge.points[0], { x: 48, y: 109 });
        assert.deepStrictEqual(edge.points[edge.points.length - 1], { x: 240, y: 136 });
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

    it('skips unchanged measurements and paths without scanning unrelated edges', () => {
        const geometry = buildFocusSceneGeometry({
            items: Array.from({ length: 1000 }, (_, index) => ({
                id: String(index), gridX: index % 20, gridY: Math.floor(index / 20),
                connections: index === 0 ? [] : [{ target: String(index - 1), targetType: 'parent' as const }],
            })),
            slotSize: { width: 96, height: 130 },
            padding: { left: 0, top: 0, right: 0, bottom: 0 },
        });
        const node = geometry.nodes['500'];
        const anchors = node.anchors;
        assert.deepStrictEqual(updateFocusSceneNodeVisuals(geometry, { '500': { ...node.visual } }), []);
        assert.strictEqual(node.anchors, anchors);
        Object.defineProperty(geometry.edges[0], 'sourceId', {
            get: () => { throw new Error('Unrelated edge was inspected during a local update'); },
        });
        const changed = updateFocusSceneNodeVisuals(geometry, { '500': { ...node.visual, y: node.visual.y + 8 } });
        assert.strictEqual(changed.length, 2);
        assert.ok(changed.every(edge => edge.sourceId === '500' || edge.targetId === '500'));
    });

    it('does not request an SVG update when only an exclusive label bounds change', () => {
        const geometry = createGeometry('up', 'related');
        const child = geometry.nodes.child;
        const changed = updateFocusSceneNodeVisuals(geometry,
            { child: { ...child.visual, width: child.visual.width + 200 } },
            { child: child.exclusiveVisual });
        assert.deepStrictEqual(changed, []);
    });

    for (const format of ['up', 'down', 'left', 'right'] as const) {
        it(`retains measured icon bounds and edge identity when repositioning a ${format} scene`, () => {
            const items = createItems('related');
            const options = {
                items, format,
                slotSize: { width: 100, height: 120 },
                padding: { left: 20, top: 30, right: 20, bottom: 30 },
            };
            const geometry = buildFocusSceneGeometry(options);
            const measured = Object.fromEntries(Object.entries(geometry.nodes).map(([id, node]) => [id, {
                x: node.slot.x + 22, y: node.slot.y + 18, width: 56, height: 56,
            }]));
            updateFocusSceneNodeVisuals(geometry, measured, measured);
            const edges = geometry.edges;
            const edgeIndex = geometry.edgesByNode;
            items[0] = { ...items[0], gridX: -3, gridY: -2 };
            const expected = buildFocusSceneGeometry(options);
            const expectedVisuals = Object.fromEntries(Object.entries(expected.nodes).map(([id, node]) => [id, {
                x: node.slot.x + 22, y: node.slot.y + 18, width: 56, height: 56,
            }]));
            updateFocusSceneNodeVisuals(expected, expectedVisuals, expectedVisuals);

            const update = updateFocusScenePositions(geometry, options);
            assert.strictEqual(geometry.edges, edges);
            assert.strictEqual(geometry.edgesByNode, edgeIndex);
            assert.ok(update.movedFocusIds.length > 0);
            assert.deepStrictEqual(geometry.nodes, expected.nodes);
            assert.deepStrictEqual(geometry.edges.map(edge => edge.path), expected.edges.map(edge => edge.path));
            assert.deepStrictEqual(geometry.origin, expected.origin);
            assert.strictEqual(geometry.width, expected.width);
            assert.strictEqual(geometry.height, expected.height);
            assert.deepStrictEqual(updateFocusScenePositions(geometry, options), { movedFocusIds: [], changedEdges: [] });
        });
    }
});
