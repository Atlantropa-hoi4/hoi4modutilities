import type { Format } from '../../hoiformat/gui';
import type { NumberPosition, NumberSize } from '../../util/common';
import type { GridBoxConnection, GridBoxItem } from '../../util/hoi4gui/gridboxcommon';

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

export function buildFocusSceneGeometry(options: FocusSceneGeometryOptions): FocusSceneGeometry {
    const format = options.format ?? 'up';
    const rawSlots = Object.fromEntries(options.items.map(item => [
        item.id,
        getRawSlot(item.gridX, item.gridY, format, options.slotSize),
    ]));
    const rawSlotValues = Object.values(rawSlots);
    const minSlotX = rawSlotValues.length > 0 ? Math.min(...rawSlotValues.map(slot => slot.x)) : 0;
    const minSlotY = rawSlotValues.length > 0 ? Math.min(...rawSlotValues.map(slot => slot.y)) : 0;
    const origin = {
        x: options.padding.left - Math.min(0, minSlotX),
        y: options.padding.top - Math.min(0, minSlotY),
    };
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
        const rawSlot = rawSlots[item.id];
        const slot: FocusSceneRect = {
            x: rawSlot.x + origin.x,
            y: rawSlot.y + origin.y,
            width: options.slotSize.width,
            height: options.slotSize.height,
        };
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
            exclusiveVisual: visual,
            anchors: createAnchors(visual, anchorGap),
        };
    }

    const edges: FocusEdgeGeometry[] = [];
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
            const points = kind === 'exclusive'
                ? routeExclusive(source, destination)
                : routePrerequisite(source, destination, format);
            const stroke = parseStroke(connection);
            edges.push({
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
            });
        }
    }

    const maxSlotX = Object.values(nodes).reduce((max, node) => Math.max(max, node.slot.x + node.slot.width), 0);
    const maxSlotY = Object.values(nodes).reduce((max, node) => Math.max(max, node.slot.y + node.slot.height), 0);
    return {
        width: Math.max(options.minimumSize?.width ?? 1, maxSlotX + options.padding.right),
        height: Math.max(options.minimumSize?.height ?? 1, maxSlotY + options.padding.bottom),
        origin,
        format,
        anchorGap,
        nodes,
        edges,
    };
}

export function updateFocusSceneNodeVisuals(
    geometry: FocusSceneGeometry,
    visualByFocusId: Readonly<Record<string, FocusSceneRect>>,
    exclusiveVisualByFocusId: Readonly<Record<string, FocusSceneRect>> = visualByFocusId,
): FocusEdgeGeometry[] {
    const changedFocusIds = new Set<string>();
    for (const [focusId, visual] of Object.entries(visualByFocusId)) {
        const node = geometry.nodes[focusId];
        if (!node || visual.width <= 0 || visual.height <= 0) {
            continue;
        }
        node.visual = { ...visual };
        node.exclusiveVisual = { ...(exclusiveVisualByFocusId[focusId] ?? visual) };
        node.anchors = createAnchors(node.visual, geometry.anchorGap);
        changedFocusIds.add(focusId);
    }

    if (changedFocusIds.size === 0) {
        return [];
    }

    const changedEdges: FocusEdgeGeometry[] = [];
    for (const edge of geometry.edges) {
        if (!changedFocusIds.has(edge.sourceId) && !changedFocusIds.has(edge.targetId)) {
            continue;
        }
        const source = geometry.nodes[edge.sourceId];
        const target = geometry.nodes[edge.targetId];
        edge.points = edge.kind === 'exclusive'
            ? routeExclusive(source, target)
            : routePrerequisite(source, target, geometry.format);
        edge.path = pointsToPath(edge.points);
        changedEdges.push(edge);
    }
    return changedEdges;
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

function routePrerequisite(
    source: FocusNodeGeometry,
    target: FocusNodeGeometry,
    format: Format['_name'],
): NumberPosition[] {
    if (format === 'left' || format === 'right') {
        const forward = target.visual.x >= source.visual.x;
        const start = forward ? source.anchors.right : source.anchors.left;
        const end = forward ? target.anchors.left : target.anchors.right;
        const corridorX = (start.x + end.x) / 2;
        return compactPoints([start, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, end]);
    }

    const forward = target.visual.y >= source.visual.y;
    const start = forward ? source.anchors.bottom : source.anchors.top;
    const end = forward ? target.anchors.top : target.anchors.bottom;
    const corridorY = (start.y + end.y) / 2;
    return compactPoints([start, { x: start.x, y: corridorY }, { x: end.x, y: corridorY }, end]);
}

function routeExclusive(source: FocusNodeGeometry, target: FocusNodeGeometry): NumberPosition[] {
    // Labels and layout padding must not move exclusive links away from the focus icon.
    const sourceCenter = center(source.exclusiveVisual);
    const targetCenter = center(target.exclusiveVisual);
    const sourceAnchors = createAnchors(source.exclusiveVisual, 0);
    const targetAnchors = createAnchors(target.exclusiveVisual, 0);
    if (Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)) {
        const forward = targetCenter.x >= sourceCenter.x;
        const start = forward ? sourceAnchors.right : sourceAnchors.left;
        const end = forward ? targetAnchors.left : targetAnchors.right;
        const corridorX = (start.x + end.x) / 2;
        return compactPoints([start, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, end]);
    }

    const forward = targetCenter.y >= sourceCenter.y;
    const start = forward ? sourceAnchors.bottom : sourceAnchors.top;
    const end = forward ? targetAnchors.top : targetAnchors.bottom;
    const corridorY = (start.y + end.y) / 2;
    return compactPoints([start, { x: start.x, y: corridorY }, { x: end.x, y: corridorY }, end]);
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
