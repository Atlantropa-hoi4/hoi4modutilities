import type { Format } from '../../hoiformat/gui';
import type { NumberPosition } from '../../util/common';
import type { FocusEdgeGeometry, FocusNodeGeometry } from './scenegeometry';

export interface FocusPrerequisiteRouteGroup {
    axis: 'x' | 'y';
    forward: boolean;
    edges: readonly FocusEdgeGeometry[];
    styleKeys: readonly string[];
}

interface RouteInterval {
    edge: FocusEdgeGeometry;
    start: number;
    end: number;
}

/** Related branches between the same rows share a rail instead of nearly parallel bends. */
export function buildFocusPrerequisiteRoutes(
    nodes: Readonly<Record<string, FocusNodeGeometry>>,
    edges: readonly FocusEdgeGeometry[],
    format: Format['_name'],
): ReadonlyMap<FocusEdgeGeometry, FocusPrerequisiteRouteGroup> {
    const axis = format === 'left' || format === 'right' ? 'x' : 'y';
    const crossAxis = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'height' : 'width';
    const rows = new Map<string, RouteInterval[]>();
    for (const edge of edges) {
        if (edge.kind !== 'prerequisite') {
            continue;
        }
        const source = nodes[edge.sourceId].slot;
        const target = nodes[edge.targetId].slot;
        const sourceCross = source[crossAxis] + source[crossSize] / 2;
        const targetCross = target[crossAxis] + target[crossSize] / 2;
        // Same-row links need their own detour below/beside the cards.
        const key = source[axis] === target[axis]
            ? edge.id : `${source[axis]}\u001f${target[axis]}`;
        const intervals = rows.get(key) ?? [];
        intervals.push({ edge, start: Math.min(sourceCross, targetCross), end: Math.max(sourceCross, targetCross) });
        rows.set(key, intervals);
    }

    const routes = new Map<FocusEdgeGeometry, FocusPrerequisiteRouteGroup>();
    for (const intervals of rows.values()) {
        intervals.sort((left, right) => left.start - right.start || left.end - right.end);
        let component: FocusEdgeGeometry[] = [];
        let end = -Infinity;
        const finish = () => {
            if (component.length === 0) {
                return;
            }
            const first = component[0];
            const group: FocusPrerequisiteRouteGroup = {
                axis,
                forward: nodes[first.targetId].slot[axis] >= nodes[first.sourceId].slot[axis],
                edges: component,
                styleKeys: [...new Set(component.map(styleKey))].sort(),
            };
            component.forEach(edge => routes.set(edge, group));
        };
        for (const interval of intervals) {
            if (interval.start > end) {
                finish();
                component = [];
            }
            component.push(interval.edge);
            end = Math.max(end, interval.end);
        }
        finish();
    }
    return routes;
}

export function routeFocusPrerequisiteGroup(
    group: FocusPrerequisiteRouteGroup,
    nodes: Readonly<Record<string, FocusNodeGeometry>>,
): { edge: FocusEdgeGeometry; points: NumberPosition[] }[] {
    const direction = group.forward ? 1 : -1;
    const ports = group.edges.map(edge => {
        const source = nodes[edge.sourceId];
        const target = nodes[edge.targetId].exclusiveVisual;
        const start = group.axis === 'y' && group.forward ? source.anchors.bottom : {
            x: source.exclusiveVisual.x + source.exclusiveVisual.width / 2,
            y: source.exclusiveVisual.y + source.exclusiveVisual.height / 2,
        };
        // Image rectangles include transparent padding. Incoming lines continue under the symbol.
        const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
        return { edge, start, end };
    });
    const sourceLimit = ports.reduce((limit, port) => Math.max(limit, direction * port.start[group.axis]), -Infinity);
    const targetLimit = ports.reduce((limit, port) => Math.min(limit, direction * port.end[group.axis]), Infinity);
    const available = targetLimit - sourceLimit;
    const spacing = available > 0 ? Math.min(8, available / (group.styleKeys.length + 1)) : 8;
    const center = available > 0 ? (sourceLimit + targetLimit) / 2
        : sourceLimit + 12 + spacing * (group.styleKeys.length - 1) / 2;

    return ports.map(({ edge, start, end }) => {
        const styleIndex = group.styleKeys.indexOf(styleKey(edge));
        const rail = direction * (center + (styleIndex - (group.styleKeys.length - 1) / 2) * spacing);
        const points = group.axis === 'x'
            ? [start, { x: rail, y: start.y }, { x: rail, y: end.y }, end]
            : [start, { x: start.x, y: rail }, { x: end.x, y: rail }, end];
        return {
            edge,
            points: points.filter((point, index) => index === 0
                || point.x !== points[index - 1].x || point.y !== points[index - 1].y),
        };
    });
}

function styleKey(edge: FocusEdgeGeometry): string {
    return JSON.stringify([edge.stroke, edge.strokeWidth, edge.dashArray ?? '']);
}
