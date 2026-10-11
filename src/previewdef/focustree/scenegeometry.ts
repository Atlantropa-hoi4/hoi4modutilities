import type { Format } from '../../hoiformat/gui';
import type { NumberPosition, NumberSize } from '../../util/common';
import type { GridBoxConnection, GridBoxItem } from '../../util/hoi4gui/gridboxcommon';
import { buildFocusPrerequisiteRoutes, routeFocusPrerequisiteGroup } from './prerequisiterouting';
import type { FocusPrerequisiteRouteGroup } from './prerequisiterouting';

export interface FocusSceneRect extends NumberPosition, NumberSize {}

export interface FocusNodeAnchors {
    top: NumberPosition;
    right: NumberPosition;
    bottom: NumberPosition;
    left: NumberPosition;
}

export interface FocusNodeGeometry {
    id: string;
    slot: FocusSceneRect;
    visual: FocusSceneRect;
    connectionVisual: FocusSceneRect;
    exclusiveVisual: FocusSceneRect;
    anchors: FocusNodeAnchors;
}

export type FocusEdgeKind = 'prerequisite' | 'exclusive';

export interface FocusEdgeGeometry {
    id: string;
    sourceId: string;
    targetId: string;
    kind: FocusEdgeKind;
    classNames: string;
    stroke: string;
    strokeWidth: number;
    dashArray?: string;
    points: NumberPosition[];
    path: string;
}

export interface FocusSceneGeometry {
    width: number;
    height: number;
    origin: NumberPosition;
    format: Format['_name'];
    anchorGap: number;
    nodes: Record<string, FocusNodeGeometry>;
    edges: FocusEdgeGeometry[];
    edgesByNode: ReadonlyMap<string, readonly FocusEdgeGeometry[]>;
    prerequisiteRoutes: ReadonlyMap<FocusEdgeGeometry, FocusPrerequisiteRouteGroup>;
}

export interface FocusSceneGeometryOptions {
    items: readonly GridBoxItem[];
    slotSize: NumberSize;
    format?: Format['_name'];
    padding: { left: number; top: number; right: number; bottom: number };
    minimumSize?: NumberSize;
    visualSize?: NumberSize;
    visualOffset?: NumberPosition;
    anchorGap?: number;
}

const defaultVisualWidth = 72;
const defaultVisualHeight = 104;
const defaultVisualTop = 10;

/** Measured bounds that remain valid because the listed cards keep their markup. */
export interface RetainedFocusSceneVisuals {
    geometry: FocusSceneGeometry;
    focusIds: ReadonlySet<string>;
}

export function buildFocusSceneGeometry(
    options: FocusSceneGeometryOptions,
    retained?: RetainedFocusSceneVisuals,
): FocusSceneGeometry {
    const format = options.format ?? 'up';
    const layout = layoutFocusSlots(options, format);
    const visualSize = {
        width: Math.min(options.visualSize?.width ?? defaultVisualWidth, options.slotSize.width),
        height: Math.min(options.visualSize?.height ?? defaultVisualHeight, options.slotSize.height),
    };
    const visualOffset = options.visualOffset ?? {
        x: (options.slotSize.width - visualSize.width) / 2,
        y: Math.min(defaultVisualTop, Math.max(options.slotSize.height - visualSize.height, 0)),
    };
    const anchorGap = options.anchorGap ?? 4;
    const nodes: Record<string, FocusNodeGeometry> = {};
    for (const item of options.items) {
        const slot = layout.slots[item.id];
        const previous = retained?.focusIds.has(item.id) ? retained.geometry.nodes[item.id] : undefined;
        if (previous) {
            const dx = slot.x - previous.slot.x;
            const dy = slot.y - previous.slot.y;
            const visual = translateRect(previous.visual, dx, dy);
            const connectionVisual = translateRect(previous.connectionVisual, dx, dy);
            const exclusiveVisual = translateRect(previous.exclusiveVisual, dx, dy);
            nodes[item.id] = {
                id: item.id,
                slot,
                visual,
                connectionVisual,
                exclusiveVisual,
                anchors: createFocusAnchors(connectionVisual, exclusiveVisual, anchorGap),
            };
            continue;
        }

        const visual: FocusSceneRect = {
            x: slot.x + visualOffset.x,
            y: slot.y + visualOffset.y,
            width: visualSize.width,
            height: visualSize.height,
        };
        nodes[item.id] = {
            id: item.id,
            slot,
            visual,
            connectionVisual: visual,
            exclusiveVisual: visual,
            anchors: createAnchors(visual, anchorGap),
        };
    }

    const edges: FocusEdgeGeometry[] = [];
    const edgesByNode = new Map<string, FocusEdgeGeometry[]>();
    const exclusivePairs = new Set<string>();
    for (const item of options.items) {
        for (let connectionIndex = 0; connectionIndex < item.connections.length; connectionIndex += 1) {
            const connection = item.connections[connectionIndex];
            const target = nodes[connection.target];
            const itemNode = nodes[item.id];
            if (!itemNode || !target) {
                continue;
            }

            const kind: FocusEdgeKind = connection.targetType === 'related' ? 'exclusive' : 'prerequisite';
            let sourceId = item.id;
            let targetId = connection.target;
            if (connection.targetType === 'parent') {
                sourceId = connection.target;
                targetId = item.id;
            }
            if (kind === 'exclusive') {
                const pairKey = [sourceId, targetId].sort().join('\u001f');
                if (exclusivePairs.has(pairKey)) {
                    continue;
                }
                exclusivePairs.add(pairKey);
            }

            const source = nodes[sourceId];
            const destination = nodes[targetId];
            const points = kind === 'exclusive' ? routeExclusive(source, destination) : [];
            const stroke = parseStroke(connection);
            const edge: FocusEdgeGeometry = {
                id: `${kind}:${sourceId}->${targetId}:${connectionIndex}`,
                sourceId,
                targetId,
                kind,
                classNames: connection.classNames ?? '',
                stroke: stroke.color,
                strokeWidth: stroke.width,
                dashArray: stroke.dashArray,
                points,
                path: pointsToPath(points),
            };
            edges.push(edge);
            for (const focusId of new Set([sourceId, targetId])) {
                const adjacent = edgesByNode.get(focusId) ?? [];
                adjacent.push(edge);
                edgesByNode.set(focusId, adjacent);
            }
        }
    }

    const prerequisiteRoutes = buildFocusPrerequisiteRoutes(nodes, edges, format);
    for (const group of new Set(prerequisiteRoutes.values())) {
        for (const { edge, points } of routeFocusPrerequisiteGroup(group, nodes)) {
            edge.points = points;
            edge.path = pointsToPath(points);
        }
    }
    return {
        width: layout.width,
        height: layout.height,
        origin: layout.origin,
        format,
        anchorGap,
        nodes,
        edges,
        edgesByNode,
        prerequisiteRoutes,
    };
}

// Position-only edits retain measured card bounds, edge objects, and adjacency indexes.
export function updateFocusScenePositions(
    geometry: FocusSceneGeometry,
    options: FocusSceneGeometryOptions,
): { movedFocusIds: string[]; changedEdges: FocusEdgeGeometry[] } {
    const layout = layoutFocusSlots(options, geometry.format);
    const visuals: Record<string, FocusSceneRect> = {};
    const exclusiveVisuals: Record<string, FocusSceneRect> = {};
    const connectionVisuals: Record<string, FocusSceneRect> = {};
    for (const [focusId, slot] of Object.entries(layout.slots)) {
        const node = geometry.nodes[focusId];
        if (!node) {
            continue;
        }
        const dx = slot.x - node.slot.x;
        const dy = slot.y - node.slot.y;
        if (dx === 0 && dy === 0) {
            continue;
        }
        node.slot = slot;
        visuals[focusId] = { ...node.visual, x: node.visual.x + dx, y: node.visual.y + dy };
        exclusiveVisuals[focusId] = { ...node.exclusiveVisual, x: node.exclusiveVisual.x + dx, y: node.exclusiveVisual.y + dy };
        connectionVisuals[focusId] = translateRect(node.connectionVisual, dx, dy);
    }
    geometry.origin = layout.origin;
    geometry.width = layout.width;
    geometry.height = layout.height;
    const changedFocusIds = applyFocusSceneNodeVisuals(geometry, visuals, exclusiveVisuals, connectionVisuals);
    const previousRoutes = geometry.prerequisiteRoutes;
    if (changedFocusIds.size > 0) {
        geometry.prerequisiteRoutes = buildFocusPrerequisiteRoutes(geometry.nodes, geometry.edges, geometry.format);
    }
    return {
        movedFocusIds: Object.keys(visuals),
        changedEdges: updateFocusSceneEdges(geometry, changedFocusIds, previousRoutes),
    };
}

function layoutFocusSlots(options: FocusSceneGeometryOptions, format: Format['_name']) {
    const slots: Record<string, FocusSceneRect> = {};
    let minX = 0;
    let minY = 0;
    for (const item of options.items) {
        const position = getRawSlot(item.gridX, item.gridY, format, options.slotSize);
        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        slots[item.id] = { ...position, ...options.slotSize };
    }
    const origin = { x: options.padding.left - minX, y: options.padding.top - minY };
    let maxX = 0;
    let maxY = 0;
    for (const slot of Object.values(slots)) {
        slot.x += origin.x;
        slot.y += origin.y;
        maxX = Math.max(maxX, slot.x + slot.width);
        maxY = Math.max(maxY, slot.y + slot.height);
    }
    return {
        slots,
        origin,
        width: Math.max(options.minimumSize?.width ?? 1, maxX + options.padding.right),
        height: Math.max(options.minimumSize?.height ?? 1, maxY + options.padding.bottom),
    };
}

export function updateFocusSceneNodeVisuals(
    geometry: FocusSceneGeometry,
    visualByFocusId: Readonly<Record<string, FocusSceneRect>>,
    exclusiveVisualByFocusId: Readonly<Record<string, FocusSceneRect>> = visualByFocusId,
    connectionVisualByFocusId: Readonly<Record<string, FocusSceneRect>> = visualByFocusId,
): FocusEdgeGeometry[] {
    return updateFocusSceneEdges(geometry,
        applyFocusSceneNodeVisuals(geometry, visualByFocusId, exclusiveVisualByFocusId, connectionVisualByFocusId));
}

function applyFocusSceneNodeVisuals(
    geometry: FocusSceneGeometry,
    visualByFocusId: Readonly<Record<string, FocusSceneRect>>,
    exclusiveVisualByFocusId: Readonly<Record<string, FocusSceneRect>>,
    connectionVisualByFocusId: Readonly<Record<string, FocusSceneRect>>,
): Set<string> {
    const changedFocusIds = new Set<string>();
    for (const [focusId, visual] of Object.entries(visualByFocusId)) {
        const node = geometry.nodes[focusId];
        if (!node || visual.width <= 0 || visual.height <= 0) {
            continue;
        }
        const exclusiveVisual = exclusiveVisualByFocusId[focusId] ?? visual;
        const connectionVisual = connectionVisualByFocusId[focusId] ?? visual;
        if (rectEquals(node.visual, visual) && rectEquals(node.exclusiveVisual, exclusiveVisual)
            && rectEquals(node.connectionVisual, connectionVisual)) {
            continue;
        }
        node.visual = { ...visual };
        node.exclusiveVisual = { ...exclusiveVisual };
        node.connectionVisual = { ...connectionVisual };
        node.anchors = createFocusAnchors(node.connectionVisual, node.exclusiveVisual, geometry.anchorGap);
        changedFocusIds.add(focusId);
    }

    return changedFocusIds;
}

function updateFocusSceneEdges(
    geometry: FocusSceneGeometry,
    changedFocusIds: ReadonlySet<string>,
    previousRoutes?: ReadonlyMap<FocusEdgeGeometry, FocusPrerequisiteRouteGroup>,
): FocusEdgeGeometry[] {
    if (changedFocusIds.size === 0) {
        return [];
    }

    const adjacentEdges = new Set<FocusEdgeGeometry>();
    const groups = new Set<FocusPrerequisiteRouteGroup>();
    const addGroup = (edge: FocusEdgeGeometry) => {
        const group = geometry.prerequisiteRoutes.get(edge);
        if (group) { groups.add(group); }
    };
    for (const focusId of changedFocusIds) {
        for (const edge of geometry.edgesByNode.get(focusId) ?? []) {
            adjacentEdges.add(edge);
            addGroup(edge);
            previousRoutes?.get(edge)?.edges.forEach(addGroup);
        }
    }
    const changedEdges: FocusEdgeGeometry[] = [];
    const applyPath = (edge: FocusEdgeGeometry, points: NumberPosition[]) => {
        edge.points = points;
        const path = pointsToPath(points);
        if (path !== edge.path) {
            edge.path = path;
            changedEdges.push(edge);
        }
    };
    for (const edge of adjacentEdges) {
        if (edge.kind !== 'exclusive') {
            continue;
        }
        const source = geometry.nodes[edge.sourceId];
        const target = geometry.nodes[edge.targetId];
        applyPath(edge, routeExclusive(source, target));
    }
    for (const group of groups) {
        for (const { edge, points } of routeFocusPrerequisiteGroup(group, geometry.nodes)) {
            applyPath(edge, points);
        }
    }
    return changedEdges;
}

function translateRect(rect: FocusSceneRect, dx: number, dy: number): FocusSceneRect {
    return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

function rectEquals(left: FocusSceneRect, right: FocusSceneRect): boolean {
    return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function getRawSlot(
    gridX: number,
    gridY: number,
    format: Format['_name'],
    slotSize: NumberSize,
): NumberPosition {
    switch (format) {
        case 'down': return { x: gridX * slotSize.width, y: -gridY * slotSize.height };
        case 'left': return { x: gridY * slotSize.width, y: gridX * slotSize.height };
        case 'right': return { x: gridY * slotSize.width, y: -gridX * slotSize.height };
        default: return { x: gridX * slotSize.width, y: gridY * slotSize.height };
    }
}

function createAnchors(rect: FocusSceneRect, gap: number): FocusNodeAnchors {
    return {
        top: { x: rect.x + rect.width / 2, y: rect.y - gap },
        right: { x: rect.x + rect.width + gap, y: rect.y + rect.height / 2 },
        bottom: { x: rect.x + rect.width / 2, y: rect.y + rect.height + gap },
        left: { x: rect.x - gap, y: rect.y + rect.height / 2 },
    };
}

function createFocusAnchors(visual: FocusSceneRect, icon: FocusSceneRect, gap: number): FocusNodeAnchors {
    const iconCenter = center(icon);
    return {
        top: { x: iconCenter.x, y: visual.y - gap },
        right: { x: visual.x + visual.width + gap, y: iconCenter.y },
        bottom: { x: iconCenter.x, y: visual.y + visual.height + gap },
        left: { x: visual.x - gap, y: iconCenter.y },
    };
}

function routeExclusive(source: FocusNodeGeometry, target: FocusNodeGeometry): NumberPosition[] {
    // Labels and layout padding must not move exclusive links away from the focus icon.
    const sourceCenter = center(source.exclusiveVisual);
    const targetCenter = center(target.exclusiveVisual);
    const sourceAnchors = createAnchors(source.exclusiveVisual, 0);
    const targetAnchors = createAnchors(target.exclusiveVisual, 0);
    if (Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)) {
        const top = Math.max(source.exclusiveVisual.y, target.exclusiveVisual.y);
        const bottom = Math.min(source.exclusiveVisual.y + source.exclusiveVisual.height,
            target.exclusiveVisual.y + target.exclusiveVisual.height);
        if (top <= bottom) {
            const y = (top + bottom) / 2;
            // Edges paint behind cards, so extend under the icons to bridge transparent padding.
            return compactPoints([{ x: sourceCenter.x, y }, { x: targetCenter.x, y }]);
        }

        const forward = targetCenter.x >= sourceCenter.x;
        const start = forward ? sourceAnchors.right : sourceAnchors.left;
        const end = forward ? targetAnchors.left : targetAnchors.right;
        const corridorX = (start.x + end.x) / 2;
        return compactPoints([sourceCenter, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, targetCenter]);
    }

    const left = Math.max(source.exclusiveVisual.x, target.exclusiveVisual.x);
    const right = Math.min(source.exclusiveVisual.x + source.exclusiveVisual.width,
        target.exclusiveVisual.x + target.exclusiveVisual.width);
    if (left <= right) {
        const x = (left + right) / 2;
        return compactPoints([{ x, y: sourceCenter.y }, { x, y: targetCenter.y }]);
    }

    const forward = targetCenter.y >= sourceCenter.y;
    const start = forward ? sourceAnchors.bottom : sourceAnchors.top;
    const end = forward ? targetAnchors.top : targetAnchors.bottom;
    const corridorY = (start.y + end.y) / 2;
    return compactPoints([sourceCenter, { x: start.x, y: corridorY }, { x: end.x, y: corridorY }, targetCenter]);
}

function compactPoints(points: NumberPosition[]): NumberPosition[] {
    return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function center(rect: FocusSceneRect): NumberPosition {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function pointsToPath(points: readonly NumberPosition[]): string {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function parseStroke(connection: GridBoxConnection): { width: number; color: string; dashArray?: string } {
    const match = /^([\d.]+)px\s+(solid|dashed|dotted)\s+(.+)$/.exec(connection.style?.trim() ?? '');
    if (!match) {
        return { width: 1, color: 'currentColor' };
    }
    return {
        width: Number(match[1]) || 1,
        color: match[3],
        dashArray: match[2] === 'dashed' ? '6 4' : match[2] === 'dotted' ? '2 3' : undefined,
    };
}
