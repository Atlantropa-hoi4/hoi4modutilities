import type { NumberPosition } from '../../src/util/common';
import type { GridBoxItem } from '../../src/util/hoi4gui/gridboxcommon';
import { htmlAttributeEscape } from '../../src/util/htmlescape';
import {
    buildFocusSceneGeometry,
    FocusEdgeGeometry,
    FocusSceneGeometry,
    FocusSceneGeometryOptions,
    FocusSceneRect,
    updateFocusSceneNodeVisuals,
} from '../../src/previewdef/focustree/scenegeometry';
import { currentScale } from '../util/common';
import {
    FocusCardRenderInput,
    finishFocusCard,
    isSameFocusCardMarkup,
    renderFocusCardHtml,
    updateFocusCardTitles,
} from './cards';
import { FocusSceneMeasurementBatcher } from './measurementbatcher';
import { measureFocusSceneNodeVisuals } from './scenegeometry';

export interface FocusSceneRenderRequest {
    treeId: string;
    items: readonly GridBoxItem[];
    positions: Readonly<Record<string, NumberPosition>>;
    geometryOptions: FocusSceneGeometryOptions;
    getCardInput(focusId: string): FocusCardRenderInput | undefined;
    isChecked(focusId: string): boolean;
    /** Nodes that should appear in the first synchronous batch (anchor, selection, relations). */
    priorityFocusIds: ReadonlySet<string>;
    anchorFocusId?: string;
    /** Visible area in scene coordinates, used to materialize on-screen nodes first. */
    viewport?: FocusSceneRect;
    /** Discards all nodes, e.g. after switching trees. */
    reset?: boolean;
}

export interface FocusSceneHooks {
    onNodeRendered(focusId: string, wrapper: HTMLElement, card: HTMLElement): void;
    onEdgeRendered(edge: FocusEdgeGeometry, element: SVGPathElement): void;
    onNodesRemoved(focusIds: readonly string[]): void;
    onMaterialized(): void;
}

export interface FocusSceneRenderResult {
    geometry: FocusSceneGeometry;
    reset: boolean;
    mountedCount: number;
    removedCount: number;
    rerenderedCount: number;
    movedCount: number;
}

const initialNodeLimit = 120;
const frameBudgetMs = 6;
const batchSize = 32;
const minNodesPerFrame = 16;
const maxNodesPerFrame = 512;
const targetFrameIntervalMs = 24;
const svgNamespace = 'http://www.w3.org/2000/svg';

/**
 * Owns the retained focus scene. Renders reconcile against the mounted nodes by focus id, so
 * source edits only touch cards, transforms, and edges that actually changed. Off-screen work
 * is materialized in frame-budgeted batches, closest to the viewport first.
 */
export class FocusScene {
    private sceneRoot: HTMLDivElement | undefined;
    private edgeSvg: SVGSVGElement | undefined;
    private edgeLayer: SVGGElement | undefined;
    private nodeLayer: HTMLDivElement | undefined;
    private geometry: FocusSceneGeometry | undefined;
    private request: FocusSceneRenderRequest | undefined;
    private itemsById = new Map<string, GridBoxItem>();
    private readonly wrappers = new Map<string, HTMLElement>();
    private readonly cards = new Map<string, HTMLElement>();
    private readonly renderInputs = new Map<string, FocusCardRenderInput>();
    private readonly renderedPositions = new Map<string, NumberPosition>();
    private readonly edgeElements = new Map<string, SVGPathElement>();
    private readonly edgeSignatures = new Map<string, string>();
    private workQueue: string[] = [];
    private nodesPerFrame = 64;
    private lastWorkFrameTime: number | undefined;
    private frame: number | undefined;
    private generation = 0;
    private readonly measurement = new FocusSceneMeasurementBatcher(ids => this.measure(ids), initialNodeLimit);

    constructor(
        private readonly toolbarHeight: number,
        private readonly hooks: FocusSceneHooks,
    ) {}

    public get currentGeometry(): FocusSceneGeometry | undefined {
        return this.geometry;
    }

    public get root(): HTMLDivElement | undefined {
        return this.sceneRoot;
    }

    public getWrapper(focusId: string): HTMLElement | undefined {
        return this.wrappers.get(focusId);
    }

    public getCard(focusId: string): HTMLElement | undefined {
        return this.cards.get(focusId);
    }

    public mountedFocusIds(): IterableIterator<string> {
        return this.cards.keys();
    }

    public forEachCard(callback: (card: HTMLElement, focusId: string) => void): void {
        this.cards.forEach(callback);
    }

    public getEdgeElement(edgeId: string): SVGPathElement | undefined {
        return this.edgeElements.get(edgeId);
    }

    public forEachEdgeElement(callback: (element: SVGPathElement, edgeId: string) => void): void {
        this.edgeElements.forEach(callback);
    }

    public getAdjacentEdges(focusId: string): readonly FocusEdgeGeometry[] {
        return this.geometry?.edgesByNode.get(focusId) ?? [];
    }

    public render(host: HTMLElement, request: FocusSceneRenderRequest): FocusSceneRenderResult {
        const canReconcile = !request.reset
            && !!this.geometry
            && this.request?.treeId === request.treeId
            && !!this.sceneRoot?.isConnected;
        return canReconcile ? this.reconcile(request) : this.reset(host, request);
    }

    /** Mounts the given nodes now, e.g. before scrolling a search result into view. */
    public ensureMounted(focusIds: readonly string[]): void {
        const ids = focusIds.filter(focusId => this.needsWork(focusId));
        if (ids.length === 0) {
            return;
        }
        this.renderNodes(ids);
        const done = new Set(ids);
        this.workQueue = this.workQueue.filter(focusId => !done.has(focusId));
    }

    public scheduleMeasurement(focusIds: Iterable<string>): void {
        this.measurement.schedule(focusIds);
    }

    public measureAllMounted(): void {
        this.measurement.schedule(Array.from(this.wrappers.keys()));
    }

    public suspendMeasurement(focusId: string): void {
        this.measurement.suspend(focusId);
    }

    public resumeMeasurement(focusId: string): void {
        this.measurement.resume(focusId);
    }

    public getVisibleFocusIds(mountedOnly = true): string[] {
        const geometry = this.geometry;
        const sceneRoot = this.sceneRoot;
        if (!geometry || !sceneRoot) {
            return [];
        }

        const rect = sceneRoot.getBoundingClientRect();
        const scale = currentScale();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const visible: string[] = [];
        for (const node of Object.values(geometry.nodes)) {
            const wrapper = this.wrappers.get(node.id);
            if ((mountedOnly && !wrapper) || wrapper?.classList.contains('focus-branch-hidden')) {
                continue;
            }
            const left = rect.left + node.slot.x * scale;
            const top = rect.top + node.slot.y * scale;
            if (left + node.slot.width * scale > 0
                && left < viewportWidth
                && top + node.slot.height * scale > this.toolbarHeight
                && top < viewportHeight) {
                visible.push(node.id);
            }
        }
        return visible;
    }

    public clear(): void {
        this.generation += 1;
        this.cancelFrame();
        this.measurement.clear();
        this.workQueue = [];
        this.lastWorkFrameTime = undefined;
        const removed = Array.from(this.wrappers.keys());
        this.wrappers.clear();
        this.cards.clear();
        this.renderInputs.clear();
        this.renderedPositions.clear();
        this.edgeElements.clear();
        this.edgeSignatures.clear();
        this.nodeLayer?.replaceChildren();
        this.edgeLayer?.replaceChildren();
        this.geometry = undefined;
        this.request = undefined;
        this.itemsById = new Map();
        if (removed.length > 0) {
            this.hooks.onNodesRemoved(removed);
        }
    }

    private reset(host: HTMLElement, request: FocusSceneRenderRequest): FocusSceneRenderResult {
        this.clear();
        this.ensureLayers(host);
        const geometry = buildFocusSceneGeometry(request.geometryOptions);
        this.geometry = geometry;
        this.request = request;
        this.itemsById = new Map(request.items.map(item => [item.id, item]));
        this.applySceneSize(geometry, request.geometryOptions);
        const ordered = this.orderByPriority(Object.keys(geometry.nodes), request);
        const initial = ordered.slice(0, initialNodeLimit);
        this.renderNodes(initial);
        this.workQueue = ordered.slice(initial.length);
        // Let the first frame paint only the nearest nodes before materializing the rest.
        const generation = this.generation;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            if (generation === this.generation) {
                this.scheduleWork();
            }
        });
        return { geometry, reset: true, mountedCount: initial.length, removedCount: 0, rerenderedCount: 0, movedCount: 0 };
    }

    private reconcile(request: FocusSceneRenderRequest): FocusSceneRenderResult {
        const previous = this.geometry!;
        this.request = request;
        this.itemsById = new Map(request.items.map(item => [item.id, item]));

        // Cards with unchanged markup keep their DOM nodes. Stale cards stay visible until their
        // replacement is rendered, so all kept cards retain their last measured bounds.
        const retained = new Set<string>();
        const kept = new Set<string>();
        const removed: string[] = [];
        for (const focusId of this.wrappers.keys()) {
            if (!this.itemsById.has(focusId)) {
                removed.push(focusId);
                continue;
            }
            kept.add(focusId);
            const input = request.getCardInput(focusId);
            const renderedInput = this.renderInputs.get(focusId);
            if (input && renderedInput && isSameFocusCardMarkup(renderedInput, input)) {
                retained.add(focusId);
                this.renderInputs.set(focusId, input);
            }
        }

        const geometry = buildFocusSceneGeometry(request.geometryOptions, { geometry: previous, focusIds: kept });
        this.geometry = geometry;
        for (const focusId of removed) {
            this.removeNode(focusId);
        }
        if (removed.length > 0) {
            this.hooks.onNodesRemoved(removed);
        }

        let movedCount = 0;
        for (const [focusId, wrapper] of this.wrappers) {
            const previousNode = previous.nodes[focusId];
            const node = geometry.nodes[focusId];
            if (!previousNode || previousNode.slot.x !== node.slot.x || previousNode.slot.y !== node.slot.y) {
                wrapper.style.transform = toTransform(node.slot);
                movedCount += 1;
            }
            const position = request.positions[focusId];
            const renderedPosition = this.renderedPositions.get(focusId);
            const card = this.cards.get(focusId);
            const input = this.renderInputs.get(focusId);
            if (card && input && position && (!renderedPosition
                || renderedPosition.x !== position.x || renderedPosition.y !== position.y)) {
                updateFocusCardTitles(card, input.focus, position, input.labelMode);
                this.renderedPositions.set(focusId, { ...position });
            }
        }
        this.applySceneSize(geometry, request.geometryOptions);
        this.reconcileEdges(geometry);

        // Everything that is unmounted or stale is re-queued, closest to the viewport first.
        const work = Object.keys(geometry.nodes).filter(focusId => !retained.has(focusId));
        const ordered = this.orderByPriority(work, request);
        const visible = new Set(this.getVisibleFocusIds(false));
        const immediate = ordered.filter(focusId => visible.has(focusId) || request.priorityFocusIds.has(focusId));
        const rerenderedCount = work.filter(focusId => this.wrappers.has(focusId)).length;
        this.renderNodes(immediate);
        const done = new Set(immediate);
        this.cancelFrame();
        this.lastWorkFrameTime = undefined;
        this.workQueue = ordered.filter(focusId => !done.has(focusId));
        this.scheduleWork();
        return {
            geometry,
            reset: false,
            mountedCount: immediate.length,
            removedCount: removed.length,
            rerenderedCount,
            movedCount,
        };
    }

    private ensureLayers(host: HTMLElement): void {
        let sceneRoot = this.sceneRoot?.isConnected ? this.sceneRoot : undefined;
        if (!sceneRoot) {
            sceneRoot = document.createElement('div');
            sceneRoot.id = 'focus-gridbox';
            sceneRoot.style.position = 'absolute';
            sceneRoot.style.left = '0';
            sceneRoot.style.top = '0';

            const edgeSvg = document.createElementNS(svgNamespace, 'svg');
            edgeSvg.classList.add('focus-connection-layer');
            edgeSvg.setAttribute('aria-hidden', 'true');
            edgeSvg.style.position = 'absolute';
            edgeSvg.style.inset = '0';
            edgeSvg.style.overflow = 'visible';
            edgeSvg.style.pointerEvents = 'none';
            const edgeLayer = document.createElementNS(svgNamespace, 'g');
            edgeSvg.appendChild(edgeLayer);

            const nodeLayer = document.createElement('div');
            nodeLayer.className = 'focus-node-layer';
            nodeLayer.style.position = 'absolute';
            nodeLayer.style.inset = '0';

            sceneRoot.append(edgeSvg, nodeLayer);
            host.replaceChildren(sceneRoot);
            this.sceneRoot = sceneRoot;
            this.edgeSvg = edgeSvg;
            this.edgeLayer = edgeLayer;
            this.nodeLayer = nodeLayer;
        }
    }

    private applySceneSize(geometry: FocusSceneGeometry, options: FocusSceneGeometryOptions): void {
        const { sceneRoot, edgeSvg, nodeLayer } = this;
        if (!sceneRoot || !edgeSvg || !nodeLayer) {
            return;
        }
        sceneRoot.style.width = `${geometry.width}px`;
        sceneRoot.style.height = `${geometry.height}px`;
        edgeSvg.setAttribute('width', String(geometry.width));
        edgeSvg.setAttribute('height', String(geometry.height));
        edgeSvg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
        nodeLayer.style.setProperty('--focus-slot-width', `${options.slotSize.width}px`);
        nodeLayer.style.setProperty('--focus-slot-height', `${options.slotSize.height}px`);
    }

    private orderByPriority(focusIds: readonly string[], request: FocusSceneRenderRequest): string[] {
        const geometry = this.geometry!;
        if (focusIds.length <= 1) {
            return [...focusIds];
        }

        const viewport = request.viewport;
        const intersectsViewport = (rect: FocusSceneRect) => !!viewport
            && rect.x <= viewport.x + viewport.width
            && rect.x + rect.width >= viewport.x
            && rect.y <= viewport.y + viewport.height
            && rect.y + rect.height >= viewport.y;
        const viewportHasNodes = !!viewport && Object.values(geometry.nodes).some(node => intersectsViewport(node.slot));
        const anchor = (request.anchorFocusId ? geometry.nodes[request.anchorFocusId] : undefined)
            ?? geometry.nodes[focusIds[0]];
        const center = viewportHasNodes && viewport
            ? { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }
            : { x: anchor.slot.x + anchor.slot.width / 2, y: anchor.slot.y + anchor.slot.height / 2 };
        return focusIds
            .map(focusId => {
                const slot = geometry.nodes[focusId].slot;
                return {
                    focusId,
                    priority: request.priorityFocusIds.has(focusId) ? 2 : viewportHasNodes && intersectsViewport(slot) ? 1 : 0,
                    distance: Math.abs(slot.x + slot.width / 2 - center.x) + Math.abs(slot.y + slot.height / 2 - center.y),
                };
            })
            .sort((left, right) => right.priority - left.priority || left.distance - right.distance)
            .map(entry => entry.focusId);
    }

    private needsWork(focusId: string): boolean {
        if (!this.geometry?.nodes[focusId]) {
            return false;
        }
        if (!this.wrappers.has(focusId)) {
            return true;
        }
        const input = this.request?.getCardInput(focusId);
        const renderedInput = this.renderInputs.get(focusId);
        return !!input && (!renderedInput || !isSameFocusCardMarkup(renderedInput, input));
    }

    /** Parses one HTML string per batch, then mounts new nodes or swaps stale ones. */
    private renderNodes(focusIds: readonly string[]): void {
        const geometry = this.geometry;
        const request = this.request;
        const nodeLayer = this.nodeLayer;
        if (!geometry || !request || !nodeLayer || focusIds.length === 0) {
            return;
        }

        const entries: Array<{ focusId: string; input: FocusCardRenderInput }> = [];
        let html = '';
        for (const focusId of focusIds) {
            const node = geometry.nodes[focusId];
            const item = this.itemsById.get(focusId);
            const input = request.getCardInput(focusId);
            const position = request.positions[focusId];
            if (!node || !item || !input || !position) {
                continue;
            }
            const renderedInput = this.renderInputs.get(focusId);
            if (this.wrappers.has(focusId) && renderedInput && isSameFocusCardMarkup(renderedInput, input)) {
                continue;
            }
            entries.push({ focusId, input });
            html += `<div id="focus_${htmlAttributeEscape(focusId)}" class="${htmlAttributeEscape(`${item.classNames ?? ''} focus`)}">`
                + renderFocusCardHtml(input, position)
                + '</div>';
        }
        if (entries.length === 0) {
            return;
        }

        const template = document.createElement('template');
        template.innerHTML = html;
        const parsed = Array.from(template.content.children) as HTMLElement[];
        const mountFragment = document.createDocumentFragment();
        const mountedIds: string[] = [];
        const renderedIds: string[] = [];
        entries.forEach((entry, index) => {
            const wrapper = parsed[index];
            if (!wrapper) {
                return;
            }
            const card = (wrapper.firstElementChild as HTMLElement | null)?.dataset.focusId !== undefined
                ? wrapper.firstElementChild as HTMLElement
                : wrapper.querySelector<HTMLElement>('[data-focus-id]');
            if (!card) {
                return;
            }
            wrapper.style.transform = toTransform(geometry.nodes[entry.focusId].slot);
            finishFocusCard(card, entry.input, request.isChecked(entry.focusId));
            const existing = this.wrappers.get(entry.focusId);
            if (existing) {
                existing.replaceWith(wrapper);
            } else {
                mountFragment.appendChild(wrapper);
                mountedIds.push(entry.focusId);
            }
            this.wrappers.set(entry.focusId, wrapper);
            this.cards.set(entry.focusId, card);
            this.renderInputs.set(entry.focusId, entry.input);
            this.renderedPositions.set(entry.focusId, { ...request.positions[entry.focusId] });
            this.hooks.onNodeRendered(entry.focusId, wrapper, card);
            renderedIds.push(entry.focusId);
        });
        nodeLayer.appendChild(mountFragment);
        this.appendEdgesForNodes(mountedIds);
        this.measurement.schedule(renderedIds);
    }

    private removeNode(focusId: string): void {
        this.wrappers.get(focusId)?.remove();
        this.wrappers.delete(focusId);
        this.cards.delete(focusId);
        this.renderInputs.delete(focusId);
        this.renderedPositions.delete(focusId);
    }

    private reconcileEdges(geometry: FocusSceneGeometry): void {
        const nextEdges = new Map(geometry.edges.map(edge => [edge.id, edge]));
        for (const [edgeId, element] of this.edgeElements) {
            const edge = nextEdges.get(edgeId);
            if (!edge || !this.wrappers.has(edge.sourceId) || !this.wrappers.has(edge.targetId)) {
                element.remove();
                this.edgeElements.delete(edgeId);
                this.edgeSignatures.delete(edgeId);
                continue;
            }
            const signature = getEdgeSignature(edge);
            const previousSignature = this.edgeSignatures.get(edgeId);
            if (signature === previousSignature) {
                continue;
            }
            if (previousSignature !== undefined && withoutPath(previousSignature) === withoutPath(signature)) {
                element.setAttribute('d', edge.path);
                this.edgeSignatures.set(edgeId, signature);
                continue;
            }
            const replacement = createEdgeElement(edge);
            element.replaceWith(replacement);
            this.edgeElements.set(edgeId, replacement);
            this.edgeSignatures.set(edgeId, signature);
            this.hooks.onEdgeRendered(edge, replacement);
        }
        this.appendEdges(geometry.edges);
    }

    private appendEdgesForNodes(focusIds: readonly string[]): void {
        const geometry = this.geometry;
        if (!geometry || focusIds.length === 0) {
            return;
        }
        const candidates = new Map<string, FocusEdgeGeometry>();
        for (const focusId of focusIds) {
            geometry.edgesByNode.get(focusId)?.forEach(edge => candidates.set(edge.id, edge));
        }
        this.appendEdges(candidates.values());
    }

    private appendEdges(edges: Iterable<FocusEdgeGeometry>): void {
        const edgeLayer = this.edgeLayer;
        if (!edgeLayer) {
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const edge of edges) {
            if (this.edgeElements.has(edge.id)
                || !this.wrappers.has(edge.sourceId)
                || !this.wrappers.has(edge.targetId)) {
                continue;
            }
            const element = createEdgeElement(edge);
            this.edgeElements.set(edge.id, element);
            this.edgeSignatures.set(edge.id, getEdgeSignature(edge));
            fragment.appendChild(element);
            this.hooks.onEdgeRendered(edge, element);
        }
        edgeLayer.appendChild(fragment);
    }

    private scheduleWork(): void {
        if (this.frame !== undefined) {
            return;
        }
        if (this.workQueue.length === 0) {
            this.hooks.onMaterialized();
            return;
        }
        const generation = this.generation;
        this.frame = requestAnimationFrame(frameTime => {
            this.frame = undefined;
            if (generation !== this.generation) {
                return;
            }
            this.adaptNodesPerFrame(frameTime);
            const startedAt = performance.now();
            let processed = 0;
            while (this.workQueue.length > 0
                && processed < this.nodesPerFrame
                && performance.now() - startedAt < frameBudgetMs) {
                const count = Math.min(batchSize, this.nodesPerFrame - processed);
                const batch = this.workQueue.splice(0, count).filter(focusId => this.needsWork(focusId));
                this.renderNodes(batch);
                processed += count;
            }
            if (this.workQueue.length === 0) {
                this.lastWorkFrameTime = undefined;
            }
            this.scheduleWork();
        });
    }

    /**
     * The JavaScript budget does not cover style, layout, and paint of the inserted cards, so the
     * per-frame node count follows the measured frame interval to keep frames short.
     */
    private adaptNodesPerFrame(frameTime: number): void {
        if (this.lastWorkFrameTime !== undefined) {
            const interval = frameTime - this.lastWorkFrameTime;
            if (interval > targetFrameIntervalMs * 2) {
                this.nodesPerFrame = Math.max(minNodesPerFrame, Math.floor(this.nodesPerFrame / 2));
            } else if (interval < targetFrameIntervalMs) {
                this.nodesPerFrame = Math.min(maxNodesPerFrame, Math.ceil(this.nodesPerFrame * 1.25));
            }
        }
        this.lastWorkFrameTime = frameTime;
    }

    private cancelFrame(): void {
        if (this.frame !== undefined) {
            cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }
    }

    private measure(focusIds: readonly string[]): void {
        const geometry = this.geometry;
        const sceneRoot = this.sceneRoot;
        if (!geometry || !sceneRoot) {
            return;
        }
        const scale = currentScale();
        const sceneRect = sceneRoot.getBoundingClientRect();
        const visualByFocusId: Record<string, FocusSceneRect> = {};
        const exclusiveVisualByFocusId: Record<string, FocusSceneRect> = {};
        for (const focusId of focusIds) {
            const wrapper = this.wrappers.get(focusId);
            if (!wrapper || !wrapper.isConnected || wrapper.classList.contains('focus-branch-hidden')) {
                continue;
            }
            const measured = measureFocusSceneNodeVisuals(wrapper, sceneRect, scale);
            visualByFocusId[focusId] = measured.visual;
            exclusiveVisualByFocusId[focusId] = measured.exclusiveVisual;
        }
        const changedEdges = updateFocusSceneNodeVisuals(geometry, visualByFocusId, exclusiveVisualByFocusId);
        for (const edge of changedEdges) {
            const element = this.edgeElements.get(edge.id);
            if (element) {
                element.setAttribute('d', edge.path);
                this.edgeSignatures.set(edge.id, getEdgeSignature(edge));
            }
        }
    }
}

function toTransform(slot: FocusSceneRect): string {
    return `translate3d(${slot.x}px, ${slot.y}px, 0)`;
}

function getEdgeSignature(edge: FocusEdgeGeometry): string {
    return `${edge.stroke}\u0000${edge.strokeWidth}\u0000${edge.dashArray ?? ''}\u0000${edge.classNames}\u0000${edge.path}`;
}

function withoutPath(signature: string): string {
    return signature.slice(0, signature.lastIndexOf('\u0000'));
}

function createEdgeElement(edge: FocusEdgeGeometry): SVGPathElement {
    const path = document.createElementNS(svgNamespace, 'path');
    path.dataset.focusEdgeId = edge.id;
    path.dataset.focusSourceId = edge.sourceId;
    path.dataset.focusTargetId = edge.targetId;
    path.setAttribute('d', edge.path);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', edge.stroke);
    path.setAttribute('stroke-width', String(edge.strokeWidth));
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    if (edge.dashArray) {
        path.setAttribute('stroke-dasharray', edge.dashArray);
    }
    for (const className of edge.classNames.split(/\s+/)) {
        if (className) {
            path.classList.add(className);
        }
    }
    return path;
}
