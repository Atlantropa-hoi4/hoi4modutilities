import * as assert from 'assert';
import { withInlayNavigationFixture } from '../inlayNavigationFixture';
import { inlaySourceNavigation, inlayWindowNavigation } from '../../src/previewdef/focustree/inlaynavigation';

/** These tests use the real GUI renderer and the host navigation handler. */
describe('focus inlay source navigation', () => {
    it('renders ordinary GUI children under one explicit reference navigator', async () => {
        await withInlayNavigationFixture(async fixture => {
            const navigators = [...fixture.html.matchAll(/<div\b([^>]*\bclass="[^"]*\bnavigator\b[^"]*"[^>]*)>/g)];
            assert.strictEqual(navigators.length, 4, 'one reference and three scripted controls navigate');
            assert.ok(fixture.html.includes('data-inlay-id="inlay"'));
            assert.ok(fixture.html.includes('file="common/national_focus/a&amp;&quot;quoted.txt"'));
            assert.ok(fixture.html.includes('file="common/focus_inlay_windows/a&amp;&quot;definition.txt"'));
            for (const [, attributes] of navigators) {
                assert.match(attributes, /\bfile="[^"]+"/);
                assert.doesNotMatch(attributes, /(?:start|end)="(?:undefined|NaN)"/);
            }
            const target = fixture.views[0].inlayWindows[0].navigation!;
            assert.deepStrictEqual(target, fixture.expected.reference);
            assert.strictEqual(fixture.selectedText(target), 'inlay_window');
            assert.deepStrictEqual(await fixture.navigate({ command: 'navigate', ...target }), target);
        });
    });

    it('keeps scripted images and buttons at their definition rather than GUI offsets', async () => {
        await withInlayNavigationFixture(async fixture => {
            for (const [target, selected] of [
                [fixture.expected.images[0], 'image_slot'],
                [fixture.expected.images[1], 'image_button'],
                [fixture.expected.button, 'button_slot'],
            ] as const) {
                assert.ok(fixture.html.includes(`start="${target.start}" end="${target.end}"`));
                assert.strictEqual(fixture.selectedText(target), selected);
                assert.deepStrictEqual(await fixture.navigate({ command: 'navigate', ...target }), target);
            }
        });
    });

    it('keeps separate reference targets when two trees reuse a shared inlay template', async () => {
        await withInlayNavigationFixture(async fixture => {
            const first = fixture.views[0].inlayWindows[0];
            const second = fixture.views[1].inlayWindows[0];
            assert.strictEqual(first.id, second.id);
            assert.deepStrictEqual(first.navigation, fixture.expected.reference);
            assert.deepStrictEqual(second.navigation, fixture.expected.second);
            assert.deepStrictEqual(await fixture.navigate({ command: 'navigate', ...second.navigation }), fixture.expected.second);
            assert.strictEqual(fixture.selectedText(second.navigation!), 'inlay_window');
        });
    });

    it('refreshes reference ranges and render signatures after source offsets change', async () => {
        await withInlayNavigationFixture(async fixture => {
            const shifted = fixture.shiftReference(27);
            assert.notStrictEqual(fixture.signature(shifted), fixture.signature(fixture.inlay));
            const target = fixture.view(shifted).inlayWindows[0].navigation!;
            assert.strictEqual(target.start, fixture.expected.reference.start + 27);
            assert.strictEqual(target.end, fixture.expected.reference.end + 27);
            assert.strictEqual(fixture.selectedText(target), 'inlay_window');
            assert.deepStrictEqual(await fixture.navigate({ command: 'navigate', ...target, documentVersion: 2 }), target);
        });
    });

    it('retains explicit definition navigation for older snapshots without a reference', async () => {
        await withInlayNavigationFixture(async fixture => {
            const legacy = { ...fixture.inlay, referenceFile: undefined, referenceToken: undefined };
            assert.deepStrictEqual(fixture.view(legacy).inlayWindows[0].navigation, fixture.expected.definition);
            const html = await fixture.render(legacy);
            assert.ok(html.includes(`start="${fixture.expected.definition.start}" end="${fixture.expected.definition.end}"`));
            assert.deepStrictEqual(await fixture.navigate({ command: 'navigate', ...inlayWindowNavigation(legacy) }), fixture.expected.definition);
        });
    });

    it('does not make source-less inlays navigate to the active focus file', async () => {
        await withInlayNavigationFixture(async fixture => {
            const sourceLess = { ...fixture.inlay, file: '', referenceFile: undefined, referenceToken: undefined };
            const html = await fixture.render(sourceLess);
            assert.strictEqual(fixture.view(sourceLess).inlayWindows[0].navigation, undefined);
            const rootTag = html.slice(0, html.indexOf('>'));
            assert.doesNotMatch(rootTag, /\bnavigator\b|\bfile=|\bstart=|\bend=/);
        });
    });

    it('normalizes invalid source ranges without emitting non-finite offsets', () => {
        assert.strictEqual(inlaySourceNavigation({ token: { start: 1, end: 2 } }), undefined);
        assert.deepStrictEqual(inlaySourceNavigation({ file: 'custom/inlay.txt' }), { file: 'custom/inlay.txt', start: 0, end: 0 });
        for (const start of [-1, NaN, Infinity, 0.5]) {
            assert.deepStrictEqual(inlaySourceNavigation({ file: 'custom/inlay.txt', token: { start, end: 3 } }),
                { file: 'custom/inlay.txt', start: 0, end: 3 });
        }
        assert.deepStrictEqual(inlaySourceNavigation({ file: 'custom/inlay.txt', token: { start: 10, end: 9 } }),
            { file: 'custom/inlay.txt', start: 10, end: 10 });
    });
});
