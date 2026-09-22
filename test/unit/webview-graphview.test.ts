import * as assert from 'assert';
import { buildSync } from 'esbuild';
import * as path from 'path';
import * as vm from 'vm';

describe('shared event and decision graph measurements', () => {
    let bundle: string;
    before(() => {
        bundle = buildSync({ entryPoints: [path.resolve('webviewsrc/util/graphview.ts')],
            bundle: true, write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
    });

    it('measures every card and label in one read phase before drawing a large graph', () => {
        const harness = createGraphHarness(bundle, 0.5);
        const nodes = Array.from({ length: 401 }, (_, index) => ({ id: String(index) }));
        const edges = nodes.slice(1).map(node => ({ from: '0', to: node.id }));
        const result = harness.render(nodes, edges);

        assert.strictEqual(result.rendered.length, 401);
        assert.strictEqual(result.renderedEdges.length, 400);
        assert.strictEqual(harness.stats.reads, 801, 'a label height must reuse its width measurement');
        assert.strictEqual(harness.stats.readPhases, 1, 'drawing edges must not trigger further layout reads');
        assert.ok(harness.elements.filter(element => element.className === 'ev-chip')
            .every(element => element.style.visibility === '' && Number.isFinite(parseFloat(element.style.top))));
    });

    it('preserves graph coordinates at different zoom levels and removes labels for missing endpoints', () => {
        const nodes = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
        const edges = [{ from: 'first', to: 'second' }, { from: 'first', to: 'third' },
            { from: 'missing', to: 'third' }];
        const full = createGraphHarness(bundle, 1).render(nodes, edges);
        const zoomed = createGraphHarness(bundle, 0.5).render(nodes, edges);

        assert.strictEqual(full.renderedEdges.length, 2);
        assert.deepStrictEqual(Array.from(full.rendered, item => ({ ...item.element.style })),
            Array.from(zoomed.rendered, item => ({ ...item.element.style })));
        assert.deepStrictEqual(Array.from(full.renderedEdges, item => ({ ...item.chip!.style })),
            Array.from(zoomed.renderedEdges, item => ({ ...item.chip!.style })));
        assert.deepStrictEqual(Array.from(full.renderedEdges, item => item.path.getAttribute('d')),
            Array.from(zoomed.renderedEdges, item => item.path.getAttribute('d')));
    });
});

function createGraphHarness(bundle: string, scale: number) {
    const stats = { reads: 0, readPhases: 0, dirty: true };
    const elements: ElementStub[] = [];
    class ElementStub extends EventTarget {
        public className = '';
        public dataset: Record<string, string> = {};
        public style = new Proxy({} as Record<string, string>, {
            set: (target, key: string, value: string) => {
                stats.dirty = true;
                target[key] = value;
                return true;
            },
        });
        private attributes = new Map<string, string>();
        public appendChild(_element: unknown): void { stats.dirty = true; }
        public remove(): void { stats.dirty = true; }
        public setAttribute(key: string, value: string): void {
            this.attributes.set(key, value);
            stats.dirty = true;
        }
        public getAttribute(key: string): string | undefined { return this.attributes.get(key); }
        public getBoundingClientRect() {
            stats.reads++;
            if (stats.dirty) { stats.readPhases++; }
            stats.dirty = false;
            return this.className === 'ev-chip' ? { width: 90 * scale, height: 24 * scale }
                : { width: 200 * scale, height: 80 * scale };
        }
    }
    const createElement = () => {
        const element = new ElementStub();
        elements.push(element);
        return element;
    };
    const document = { createElement, createElementNS: createElement };
    const module = { exports: {} };
    vm.runInNewContext(bundle, { module, exports: module.exports, document, window: Object.assign(new EventTarget(), { __i18ntable: {} }),
        acquireVsCodeApi: () => ({ getState: () => ({ scale }), setState: () => undefined }), console });
    const { renderGraph } = module.exports as typeof import('../../webviewsrc/util/graphview');
    return {
        stats,
        elements,
        render: (nodes: { id: string }[], edges: { from: string; to: string }[]) => renderGraph({
            content: createElement() as unknown as HTMLDivElement, nodes, edges, roots: [nodes[0].id],
            buildCard: () => createElement() as unknown as HTMLDivElement,
            chipGuarded: () => false, chipText: () => 'label', edgeClass: () => 'edge',
        }),
    };
}
