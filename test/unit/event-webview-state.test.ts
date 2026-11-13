import * as assert from 'assert';
import { buildSync } from 'esbuild';
import * as path from 'path';
import * as vm from 'vm';
import type { EventGraphEdge, EventGraphEventNode, EventGraphNode, EventGraphOptionNode } from '../../src/previewdef/event/payload';
import { eventDetailsKeys } from '../../webviewsrc/eventdetailsstate';
import { matchesQuery } from '../../webviewsrc/eventsearch';

const eventNode = (id = 'event:0', eventId = 'sample.1'): EventGraphEventNode => ({
    id, kind: 'event', eventId, eventType: 'country', scope: 'ROOT',
    title: { key: `${eventId}.t`, text: 'Translated event' }, trigger: true,
    major: false, hidden: false, fireOnlyOnce: false, isTriggeredOnly: true, loop: false, meanTimeToHappenBase: 1,
    nav: { file: 'events/sample.txt', start: 10, end: 20 },
});
const optionNode = (id = 'option:1'): EventGraphOptionNode => ({
    id, kind: 'option', name: { key: 'sample.1.a', text: '번역된 선택지' }, trigger: true,
    nav: { file: 'events/sample.txt', start: 30, end: 40 },
});
const edge = (from: string, to: string): EventGraphEdge => ({
    from, to, structural: true, source: 'option', scope: '', days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
});

describe('event search and details selection', () => {
    it('searches event and option identifiers and translations without depending on the displayed label', () => {
        assert.ok(matchesQuery(eventNode(), 'SAMPLE.1'));
        assert.ok(matchesQuery(eventNode(), 'translated'));
        assert.ok(matchesQuery(optionNode(), 'SAMPLE.1.A'));
        assert.ok(matchesQuery(optionNode(), '번역된'));
        assert.strictEqual(matchesQuery(optionNode(), '   '), false);
        assert.strictEqual(matchesQuery(optionNode(), 'missing'), false);
        assert.ok(matchesQuery({ id: 'missing', kind: 'unresolved', eventId: 'unknown.1', scope: 'ROOT' }, 'UNKNOWN'));
    });

    it('keeps semantic selection after traversal IDs, source offsets and unrelated nodes change', () => {
        const original = [eventNode(), optionNode()];
        const first = eventDetailsKeys(original, [edge(original[0].id, original[1].id)]);
        const changed = [eventNode('unrelated', 'unrelated.1'), eventNode('event:8'), optionNode('option:9')];
        changed[1].nav = { file: 'events/sample.txt', start: 100, end: 200 };
        changed[2].nav = { file: 'events/sample.txt', start: 300, end: 400 };
        const next = eventDetailsKeys(changed, [edge(changed[1].id, changed[2].id)]);
        assert.strictEqual(first.get(original[0].id), next.get(changed[1].id));
        assert.strictEqual(first.get(original[1].id), next.get(changed[2].id));
    });

    it('distinguishes repeated option names within one event and between different owners', () => {
        const nodes: EventGraphNode[] = [eventNode(), optionNode(), optionNode('option:2'),
            eventNode('other', 'sample.2'), optionNode('option:4')];
        const keys = eventDetailsKeys(nodes, [edge('event:0', 'option:1'), edge('event:0', 'option:2'), edge('other', 'option:4')]);
        assert.strictEqual(new Set(keys.values()).size, nodes.length);
    });

    it('retains the right duplicate choice when an earlier choice is inserted and effect references move', () => {
        const first = { ...optionNode('a'), aiChanceScript: 'factor = 10', effectsRef: 0 };
        const selected = { ...optionNode('b'), aiChanceScript: 'factor = 90', effectsRef: 1 };
        const effects = (content: string): import('../../src/previewdef/event/payload').EffectTreeNode[] =>
            [{ kind: 'line', scopeName: 'ROOT', content }];
        const original = eventDetailsKeys([eventNode(), first, selected], [edge('event:0', 'a'), edge('event:0', 'b')],
            [effects('add_stability = 0.1'), effects('add_stability = 0.2')]);
        const inserted = { ...optionNode('new'), aiChanceScript: 'factor = 50', effectsRef: 0 };
        const next = eventDetailsKeys([eventNode('event:8'), inserted, { ...first, effectsRef: 1 }, { ...selected, id: 'b:9', effectsRef: 2 }],
            [edge('event:8', 'new'), edge('event:8', 'a'), edge('event:8', 'b:9')],
            [effects('add_stability = 0.3'), effects('add_stability = 0.1'), effects('add_stability = 0.2')]);
        assert.strictEqual(original.get('b'), next.get('b:9'));
        assert.notStrictEqual(original.get('b'), next.get('a'));
    });
});

describe('event details dialog persistence', () => {
    let bundle: string;
    before(() => {
        bundle = buildSync({ entryPoints: [path.resolve('webviewsrc/eventdetails.ts')], bundle: true,
            write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
    });

    it('restores updated details after refresh and ignores a late close from the old dialog', () => {
        const harness = detailsHarness(bundle);
        const card = harness.append(eventNode(), 'selection');
        card.children[0].dispatchEvent(new Event('click'));
        const oldDialog = harness.dialog()!;
        assert.strictEqual(harness.state().eventDetailsOpen, true);
        assert.strictEqual(oldDialog.attributes.get('aria-labelledby'), 'event-details-title');
        harness.controller.beginRender();
        card.remove();
        harness.append({ ...eventNode('event:5'), descriptions: [{ text: { key: 'new', text: 'Updated description' } }] }, 'selection');
        harness.controller.restore();
        const restored = harness.dialog()!;
        assert.notStrictEqual(restored, oldDialog);
        assert.ok(restored.children.some(child => child.textContent === 'Updated description'));
        oldDialog.dispatchEvent(new Event('close'));
        assert.strictEqual(harness.state().eventDetailsOpen, true);
        assert.strictEqual(harness.dialog(), restored);
        assert.strictEqual(harness.state().scale, 0.5);
    });

    it('restores a saved selection on reload and persists closing with focus returned to the current button', () => {
        const harness = detailsHarness(bundle, { eventDetailsOpen: true, eventDetailsSelection: 'option' });
        const card = harness.append(optionNode(), 'option');
        harness.controller.restore();
        harness.dialog()!.close();
        assert.strictEqual(harness.state().eventDetailsOpen, false);
        assert.strictEqual(harness.document.activeElement, card.children[0]);
        harness.controller.beginRender();
        harness.append(optionNode(), 'option');
        harness.controller.restore();
        assert.strictEqual(harness.dialog(), undefined);
    });

    it('clears removed or filtered selections and restores focus without reopening another node', () => {
        const harness = detailsHarness(bundle);
        harness.append(eventNode(), 'removed').children[0].dispatchEvent(new Event('click'));
        harness.controller.beginRender();
        harness.append(eventNode('other', 'sample.2'), 'other');
        harness.controller.restore();
        assert.strictEqual(harness.dialog(), undefined);
        assert.strictEqual(harness.state().eventDetailsOpen, false);
        assert.strictEqual(harness.state().eventDetailsSelection, undefined);
        assert.strictEqual(harness.document.activeElement, harness.search);
    });
});

function detailsHarness(bundle: string, initial: Record<string, unknown> = {}) {
    let state: Record<string, unknown> = { scale: 0.5, ...initial };
    class ElementStub extends EventTarget {
        public className = '';
        public id = '';
        public textContent = '';
        public readonly children: ElementStub[] = [];
        public readonly attributes = new Map<string, string>();
        public parent: ElementStub | undefined;
        public open = false;
        constructor(public readonly tagName = 'div') { super(); }
        public get isConnected(): boolean { return this === document.body || !!this.parent?.isConnected; }
        public append(...children: ElementStub[]): void {
            for (const child of children) { child.parent = this; this.children.push(child); }
        }
        public setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
        public contains(element: ElementStub | null): boolean {
            return this === element || this.children.some(child => child.contains(element));
        }
        public focus(): void { document.activeElement = this; }
        public showModal(): void { this.open = true; this.children[1]?.focus(); }
        public close(): void { this.open = false; this.dispatchEvent(new Event('close')); }
        public remove(): void {
            if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
            this.parent = undefined;
        }
    }
    const search = new ElementStub('input');
    const document = { body: new ElementStub('body'), activeElement: null as ElementStub | null,
        createElement: (tagName: string) => new ElementStub(tagName), getElementById: () => search };
    const module = { exports: {} };
    vm.runInNewContext(bundle, { module, exports: module.exports, document, window: { __i18ntable: {} }, console });
    const { EventDetailsController } = module.exports as typeof import('../../webviewsrc/eventdetails');
    const controller = new EventDetailsController(() => state, patch => { state = { ...state, ...patch }; });
    return { controller, document, search, state: () => state,
        dialog: () => document.body.children.find(child => child.tagName === 'dialog'),
        append: (node: EventGraphEventNode | EventGraphOptionNode, key: string) => {
            const card = new ElementStub();
            document.body.append(card);
            controller.append(card as unknown as HTMLElement, node, true, key);
            return card;
        } };
}
