import * as assert from 'assert';
import {
    FocusTreeStyleLedger,
    FocusTreeStyleReceiver,
    serializeFocusTreeStyleRules,
} from '../../src/previewdef/focustree/stylesync';
import type { FocusTreeStyleSync } from '../../src/previewdef/focustree/webviewupdate';

/** Rules of serialized test CSS, in order; raw records start with `#`. */
function parseRules(css: string): Array<[selector: string, content: string]> {
    return Array.from(css.matchAll(/([.#][^\s{]+) \{\s*([^}]*?)\s*\}/g), match => [match[1], match[2]]);
}

/** A webview stylesheet keyed by selector, as `stylesheet.ts` keeps it in the CSSOM. */
function createSheet() {
    const rules = new Map<string, string>();
    const operations: Array<{ kind: 'replace' | 'append'; css: string }> = [];
    return {
        rules,
        operations,
        replace(css: string) {
            operations.push({ kind: 'replace', css });
            rules.clear();
            parseRules(css).forEach(([selector, content]) => rules.set(selector, content));
        },
        append(css: string) {
            operations.push({ kind: 'append', css });
            parseRules(css).forEach(([selector, content]) => {
                rules.delete(selector);
                rules.set(selector, content);
            });
        },
    };
}

function createLedger(options: { compactionMinChars?: number; compactionRatio?: number } = {}) {
    let baseCount = 0;
    return new FocusTreeStyleLedger({ createBaseId: () => `base-${++baseCount}`, ...options });
}

/** The webview's rules after the syncs, keyed like the ledger. */
function expectedSheet(ledger: FocusTreeStyleLedger): Map<string, string> {
    return new Map(parseRules(serializeFocusTreeStyleRules(ledger.rules) + ledger.rawStyleCss));
}

describe('focus tree style sync', () => {
    it('sends the whole stylesheet first, then only new rules of a merged scene', () => {
        const ledger = createLedger();
        const sheet = createSheet();
        const receiver = new FocusTreeStyleReceiver(sheet, () => assert.fail('no resync expected'));
        const sceneA = new Map([['st-common', 'display: block;'], ['st-focus-icon-GFX_A', 'real:A;']]);

        const first = ledger.sync(sceneA);
        assert.strictEqual(first?.kind, 'full');
        assert.strictEqual(receiver.apply(first), true);

        // Scene B shares the template rule and adds its own icon.
        const second = ledger.sync(new Map([['st-common', 'display: block;'], ['st-focus-icon-GFX_B', 'placeholder;']]));
        assert.strictEqual(second?.kind, 'delta');
        assert.deepStrictEqual(parseRules(second?.css ?? ''), [['.st-focus-icon-GFX_B', 'placeholder;']],
            'unchanged shared rules and loaded icons do not travel again');
        assert.strictEqual(receiver.apply(second), true);

        // A cached revisit or a rebuild with the same rules sends nothing.
        assert.strictEqual(ledger.sync(sceneA), undefined);
        assert.deepStrictEqual(sheet.rules, expectedSheet(ledger));
        assert.deepStrictEqual(sheet.operations.map(operation => operation.kind), ['replace', 'append']);
    });

    it('sends exactly the rules whose asset changed and keeps the rest of every scene', () => {
        const ledger = createLedger();
        const sheet = createSheet();
        const receiver = new FocusTreeStyleReceiver(sheet, () => assert.fail('no resync expected'));
        receiver.apply(ledger.sync(new Map([
            ['st-focus-icon-GFX_A', 'real:A@1;'],
            ['st-focus-icon-GFX_B', 'real:B@1;'],
            ['st-focus-icon-GFX_C', 'placeholder;'],
        ])));

        // A dependency refresh of scene A only re-decodes A's icons; B's scene keeps its rules.
        const sync = ledger.sync(new Map([['st-focus-icon-GFX_A', 'real:A@2;'], ['st-focus-icon-GFX_C', 'placeholder;']]));
        assert.deepStrictEqual(parseRules(sync?.css ?? ''), [['.st-focus-icon-GFX_A', 'real:A@2;']]);
        receiver.apply(sync);
        assert.strictEqual(sheet.rules.get('.st-focus-icon-GFX_A'), 'real:A@2;');
        assert.strictEqual(sheet.rules.get('.st-focus-icon-GFX_B'), 'real:B@1;', 'rules are never pruned by scene');
        assert.deepStrictEqual(sheet.rules, expectedSheet(ledger));
    });

    it('compacts superseded same-selector history into one stylesheet of the latest rules', () => {
        const ledger = createLedger({ compactionMinChars: 20, compactionRatio: 0.5 });
        const sheet = createSheet();
        const receiver = new FocusTreeStyleReceiver(sheet, () => assert.fail('no resync expected'));
        receiver.apply(ledger.sync(new Map([['st-a', 'placeholder;'], ['st-b', 'placeholder;']])));

        const delta = ledger.sync([['st-a', 'real-image-body-1;']]);
        assert.strictEqual(delta?.kind, 'delta', 'one superseded placeholder is below the threshold');
        receiver.apply(delta);
        assert.strictEqual(ledger.state.supersededChars, 'placeholder;'.length);

        const compacted = ledger.sync([['st-a', 'real-image-body-2;']]);
        assert.strictEqual(compacted?.kind, 'full', 'enough superseded bodies compact the stylesheet');
        assert.deepStrictEqual(parseRules(compacted?.css ?? ''), [
            ['.st-b', 'placeholder;'],
            ['.st-a', 'real-image-body-2;'],
        ], 'each selector appears once with its latest rule, changed rules last');
        receiver.apply(compacted);
        assert.strictEqual(ledger.state.supersededChars, 0);
        assert.deepStrictEqual(sheet.rules, expectedSheet(ledger));
        assert.deepStrictEqual(sheet.operations.map(operation => operation.kind), ['replace', 'append', 'replace']);

        // After compaction, deltas apply on the new base again.
        const next = ledger.sync([['st-c', 'placeholder;']]);
        assert.strictEqual(next?.kind, 'delta');
        assert.strictEqual(receiver.apply(next), true);
    });

    it('preserves the raw block through deltas and compaction, and resyncs when it changes', () => {
        const ledger = createLedger({ compactionMinChars: 1, compactionRatio: 0 });
        const sheet = createSheet();
        const receiver = new FocusTreeStyleReceiver(sheet, () => assert.fail('no resync expected'));
        const raw = '#continuousFocuses { width:400px;height:200px; }';
        const first = ledger.sync([['st-a', 'one;']], raw);
        assert.match(first?.css ?? '', /#continuousFocuses/);
        receiver.apply(first);

        // The same raw block does not travel again; superseded rules compact with it included.
        const compacted = ledger.sync([['st-a', 'two;']], raw);
        assert.strictEqual(compacted?.kind, 'full');
        assert.match(compacted?.css ?? '', /#continuousFocuses \{ width:400px;height:200px; \}/);
        receiver.apply(compacted);
        assert.strictEqual(sheet.rules.get('#continuousFocuses'), 'width:400px;height:200px;');

        const relaxed = createLedger();
        relaxed.sync([['st-a', 'one;']], raw);
        assert.strictEqual(relaxed.sync([['st-b', 'two;']], raw)?.kind, 'delta');
        assert.strictEqual(relaxed.sync([], '')?.kind, 'full', 'a raw block can only lose selectors in a whole stylesheet');
        assert.strictEqual(relaxed.rawStyleCss, '');
    });

    it('asks once for a whole stylesheet when a delta does not fit, and drops deltas until it arrives', () => {
        const ledger = createLedger();
        const sheet = createSheet();
        const requests: string[] = [];
        const receiver = new FocusTreeStyleReceiver(sheet, () => requests.push('resync'));
        receiver.apply(ledger.sync([['st-a', 'one;']]));

        // A delta of this base went missing.
        ledger.sync([['st-b', 'two;']]);
        const unfit = ledger.sync([['st-c', 'three;']]);
        assert.strictEqual(receiver.apply(unfit), false);
        assert.strictEqual(receiver.apply(ledger.sync([['st-d', 'four;']])), false);
        assert.deepStrictEqual(requests, ['resync'], 'one request until the whole stylesheet arrives');

        const resync = ledger.resync();
        assert.strictEqual(resync.kind, 'full');
        assert.strictEqual(receiver.apply(resync), true);
        assert.deepStrictEqual(sheet.rules, expectedSheet(ledger));
        assert.strictEqual(receiver.apply(ledger.sync([['st-e', 'five;']])), true);
        assert.deepStrictEqual(requests, ['resync']);
    });

    it('sends a restored webview every recorded rule on a new base', () => {
        const ledger = createLedger();
        const original = createSheet();
        new FocusTreeStyleReceiver(original, () => assert.fail('no resync expected'))
            .apply(ledger.sync([['st-a', 'one;'], ['st-b', 'two;']]));
        const before = ledger.state;

        // The webview document was recreated: it holds no stylesheet, so deltas cannot apply.
        ledger.invalidateDelivery();
        const restored = createSheet();
        const restoredRequests: string[] = [];
        const receiver = new FocusTreeStyleReceiver(restored, () => restoredRequests.push('resync'));
        const sync = ledger.sync([['st-c', 'three;']]) as FocusTreeStyleSync;
        assert.strictEqual(sync.kind, 'full');
        assert.notStrictEqual(sync.baseId, before.baseId);
        assert.strictEqual(receiver.apply(sync), true);
        assert.deepStrictEqual([...restored.rules.keys()], ['.st-a', '.st-b', '.st-c']);
        assert.deepStrictEqual(restoredRequests, []);

        // A delta of the previous base is rejected instead of being applied to the new one.
        const stale: FocusTreeStyleSync = { kind: 'delta', baseId: before.baseId, baseVersion: before.version, version: before.version + 1, css: '.st-x { stale; }\n' };
        assert.strictEqual(receiver.apply(stale), false);
        assert.strictEqual(restored.rules.has('.st-x'), false);
        assert.deepStrictEqual(restoredRequests, ['resync']);
    });

    it('forgets every rule when the session renders a new webview document', () => {
        const ledger = createLedger();
        ledger.sync([['st-a', 'one;']], '#raw { a:b; }');
        ledger.clear();
        assert.deepStrictEqual(ledger.state.ruleCount, 0);
        const sync = ledger.sync([['st-b', 'two;']]);
        assert.strictEqual(sync?.kind, 'full');
        assert.deepStrictEqual(parseRules(sync?.css ?? ''), [['.st-b', 'two;']]);
    });
});
