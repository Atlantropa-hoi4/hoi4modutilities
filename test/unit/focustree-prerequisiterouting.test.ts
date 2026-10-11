import * as assert from 'assert';
import {
    buildFocusSceneGeometry,
    updateFocusSceneNodeVisuals,
    updateFocusScenePositions,
} from '../../src/previewdef/focustree/scenegeometry';
import type { FocusEdgeGeometry, FocusSceneRect } from '../../src/previewdef/focustree/scenegeometry';
import type { GridBoxItem } from '../../src/util/hoi4gui/gridboxcommon';

function scene(format: 'up' | 'down' | 'left' | 'right' = 'up') {
    const items: GridBoxItem[] = [
        { id: 'swords', gridX: 0, gridY: 1, connections: [] },
        { id: 'greasing', gridX: 2, gridY: 1, connections: [] },
        { id: 'orbital', gridX: 5, gridY: 1, connections: [] },
        { id: 'past', gridX: 1, gridY: 2, connections: [
            { target: 'swords', targetType: 'parent', style: '1px solid blue' },
            { target: 'greasing', targetType: 'parent', style: '1px solid blue' },
            { target: 'future', targetType: 'related', style: '1px solid red' },
        ] },
        { id: 'future', gridX: 5, gridY: 2, connections: [
            { target: 'greasing', targetType: 'parent', style: '1px solid blue' },
            { target: 'orbital', targetType: 'parent', style: '1px solid blue' },
        ] },
        { id: 'march', gridX: 3, gridY: 3, connections: [
            { target: 'past', targetType: 'parent', style: '1px dashed blue' },
            { target: 'future', targetType: 'parent', style: '1px dashed blue' },
        ] },
    ];
    const options = { items, format, slotSize: { width: 96, height: 130 },
        padding: { left: 0, top: 0, right: 0, bottom: 0 } };
    const geometry = buildFocusSceneGeometry(options);
    const transform = (rect: FocusSceneRect): FocusSceneRect => format === 'up' ? rect
        : format === 'down' ? { ...rect, y: 700 - rect.y - rect.height }
            : { x: rect.y, y: format === 'right' ? 700 - rect.x - rect.width : rect.x,
                width: rect.height, height: rect.width };
    const icons: Record<string, FocusSceneRect> = {};
    const captions: Record<string, FocusSceneRect> = {};
    const frames: Record<string, FocusSceneRect> = {};
    for (const item of items) {
        const x = item.gridX * 96 + 89;
        const y = item.gridY * 130;
        icons[item.id] = transform(item.id === 'past' ? { x: x - 88, y: y + 10, width: 176, height: 128 }
            : item.id === 'future' ? { x: x - 88, y: y - 6, width: 176, height: 160 }
                : { x: x - 48, y: y + 46, width: 96, height: 64 });
        captions[item.id] = transform({ x: x - 60, y: y + 124, width: 120,
            height: item.id === 'greasing' ? 34 : 14 });
        frames[item.id] = transform({ x: x - 80, y: y + 110, width: 160, height: 44 });
    }
    const measure = (framesVisible: boolean, decorationVisible: boolean) => {
        const bodies = Object.fromEntries(items.map(item => [item.id,
            union([captions[item.id], ...(framesVisible ? [frames[item.id]] : [])])]));
        const visuals = Object.fromEntries(items.map(item => [item.id, union([
            bodies[item.id], icons[item.id], ...(decorationVisible
                ? [transform({ x: item.gridX * 96 - 100, y: item.gridY * 130 - 100, width: 400, height: 400 })] : []),
        ])]));
        return updateFocusSceneNodeVisuals(geometry, visuals, icons, bodies);
    };
    return { geometry, items, options, measure, icons, captions };
}

function union(rects: FocusSceneRect[]): FocusSceneRect {
    const x = Math.min(...rects.map(rect => rect.x));
    const y = Math.min(...rects.map(rect => rect.y));
    return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
        height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}

function rail(edge: FocusEdgeGeometry, axis: 'x' | 'y'): number | undefined {
    const cross = axis === 'x' ? 'y' : 'x';
    return edge.points.find((point, index) => index > 0 && point[axis] === edge.points[index - 1][axis]
        && point[cross] !== edge.points[index - 1][cross])?.[axis];
}

describe('focus prerequisite routing', () => {
    for (const format of ['up', 'down', 'left', 'right'] as const) {
        for (const framesVisible of [true, false]) {
            it(`joins one-line and wrapped labels on one ${format} rail with frames ${framesVisible ? 'on' : 'off'}`, () => {
                const { geometry, measure, icons } = scene(format);
                measure(framesVisible, true);
                const axis = format === 'left' || format === 'right' ? 'x' : 'y';
                const solid = geometry.edges.filter(edge => edge.kind === 'prerequisite' && !edge.dashArray);
                const rails = solid.map(edge => rail(edge, axis)).filter(value => value !== undefined);
                assert.strictEqual(new Set(rails).size, 1, 'Wrapped labels must not create parallel rails');
                for (const edge of geometry.edges.filter(candidate => candidate.kind === 'prerequisite')) {
                    const icon = icons[edge.targetId];
                    assert.deepStrictEqual(edge.points[edge.points.length - 1], {
                        x: icon.x + icon.width / 2, y: icon.y + icon.height / 2,
                    });
                }
            });
        }
    }

    it('keeps dashed outgoing stems connected to captions when padded icons extend below them', () => {
        const { geometry, measure, captions } = scene();
        measure(false, false);
        const dashed = geometry.edges.filter(edge => edge.dashArray);
        assert.strictEqual(new Set(dashed.map(edge => rail(edge, 'y'))).size, 1);
        for (const edge of dashed) {
            const caption = captions[edge.sourceId];
            assert.strictEqual(edge.points[0].y, caption.y + caption.height + geometry.anchorGap);
            assert.ok(edge.points[1].y - edge.points[0].y >= 12, 'The outgoing stem must be visibly longer than one dash');
        }
    });

    it('does not move connection ports or paths when only ornaments change', () => {
        const { geometry, measure } = scene();
        measure(true, true);
        const paths = geometry.edges.map(edge => edge.path);
        assert.deepStrictEqual(measure(true, false), []);
        assert.deepStrictEqual(geometry.edges.map(edge => edge.path), paths);
    });

    it('updates other branches on the shared rail when one parent label changes', () => {
        const { geometry, measure } = scene();
        measure(false, false);
        const sibling = geometry.edges.find(edge => edge.sourceId === 'swords' && edge.targetId === 'past')!;
        const previous = sibling.path;
        const parent = geometry.nodes.greasing;
        const body = { ...parent.connectionVisual, height: parent.connectionVisual.height + 10 };
        const changed = updateFocusSceneNodeVisuals(geometry, { greasing: parent.visual },
            { greasing: parent.exclusiveVisual }, { greasing: body });
        assert.notStrictEqual(sibling.path, previous);
        assert.ok(changed.includes(sibling));
        assert.strictEqual(new Set(geometry.edges.filter(edge => edge.kind === 'prerequisite' && !edge.dashArray)
            .map(edge => rail(edge, 'y')).filter(value => value !== undefined)).size, 1);
    });

    it('rebuilds shared routes after moves and keeps measured bounds and edge objects', () => {
        const { geometry, measure, items, options } = scene();
        measure(false, false);
        const edges = geometry.edges;
        const oldSlot = { ...geometry.nodes.greasing.slot };
        const oldBody = { ...geometry.nodes.greasing.connectionVisual };
        items[1] = { ...items[1], gridY: 0 };
        updateFocusScenePositions(geometry, options);
        assert.strictEqual(geometry.edges, edges);
        assert.deepStrictEqual(geometry.nodes.greasing.connectionVisual, {
            ...oldBody, y: oldBody.y + geometry.nodes.greasing.slot.y - oldSlot.y,
        });
        const fresh = buildFocusSceneGeometry(options, { geometry, focusIds: new Set(items.map(item => item.id)) });
        assert.deepStrictEqual(geometry.edges.map(edge => edge.path), fresh.edges.map(edge => edge.path));
    });

    it('keeps dashed and solid prerequisite semantics on distinct rails', () => {
        const { geometry, items, options } = scene();
        items[3].connections[1] = { ...items[3].connections[1], style: '1px dashed blue' };
        const rebuilt = buildFocusSceneGeometry(options, { geometry, focusIds: new Set(items.map(item => item.id)) });
        const edges = rebuilt.edges.filter(edge => edge.targetId === 'past' && edge.kind === 'prerequisite');
        assert.notStrictEqual(rail(edges[0], 'y'), rail(edges[1], 'y'));
        assert.strictEqual(edges[1].dashArray, '6 4');
    });
});
