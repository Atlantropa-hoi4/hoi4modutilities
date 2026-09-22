import * as assert from 'assert';
import { buildSync } from 'esbuild';
import * as path from 'path';
import * as vm from 'vm';
import { ViewportStateStore } from '../../webviewsrc/util/viewportstate';

describe('shared webview viewport persistence', () => {
    it('coalesces scroll and zoom bursts while reads see the latest state immediately', () => {
        const { store, frames, writes } = createStore({ uri: 'preview', scale: 0.5, selected: ['focus'] });
        for (let index = 0; index < 120; index++) {
            store.setState({ xOffset: index, yOffset: index * 2 }, true);
            store.setState({ scale: 0.6 }, true);
        }

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(frames.length, 1);
        assert.deepStrictEqual(store.getState(), {
            uri: 'preview', scale: 0.6, selected: ['focus'], xOffset: 119, yOffset: 238,
        });
        frames.shift()!(0);
        assert.deepStrictEqual(writes, [store.getState()]);
    });

    it('persists edit state synchronously with pending viewport and reused mutable objects', () => {
        const checked = { first: true, second: false };
        const { store, frames, writes } = createStore({ checked, scale: 0.5 });
        store.setState({ xOffset: 80 }, true);
        checked.second = true;
        store.setState({ checked });

        assert.deepStrictEqual(writes, [{ checked: { first: true, second: true }, scale: 0.5, xOffset: 80 }]);
        frames.shift()!(0);
        assert.strictEqual(writes.length, 1, 'the scheduled frame must not write already persisted state');
        checked.first = false;
        store.setState({ checked });
        assert.strictEqual(writes.length, 2, 'object identity must not hide an in-place state change');
        assert.strictEqual(writes[1].checked.first, false);
    });

    it('flushes pending changes without waiting for a backgrounded animation frame', () => {
        const { store, frames, writes } = createStore({ uri: 'preview' });
        store.setState({ xOffset: 40 }, true);
        store.flush();
        assert.deepStrictEqual(writes, [{ uri: 'preview', xOffset: 40 }]);

        store.setState({ yOffset: 50 });
        assert.strictEqual(writes.length, 2);
        frames.shift()!(0);
        assert.strictEqual(writes.length, 2);
    });

    it('keeps failed persistence available for retry with subsequent updates', () => {
        let shouldFail = true;
        const writes: Record<string, unknown>[] = [];
        const store = new ViewportStateStore(() => ({ uri: 'preview' }), state => {
            if (shouldFail) {
                throw new Error('write failed');
            }
            writes.push({ ...state });
        });

        assert.throws(() => store.setState({ scale: 0.7 }), /write failed/);
        assert.strictEqual(store.getState().scale, 0.7);
        shouldFail = false;
        store.setState({ xOffset: 60 });
        assert.deepStrictEqual(writes, [{ uri: 'preview', scale: 0.7, xOffset: 60 }]);
    });
});

describe('shared webview viewport lifecycle', () => {
    let bundle: string;
    before(() => {
        bundle = buildSync({ entryPoints: [path.resolve('webviewsrc/util/common.ts')],
            bundle: true, write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
    });

    it('batches actual zoom and scroll handlers without delaying current scale reads', () => {
        const harness = createViewportHarness(bundle);
        for (let index = 0; index < 120; index++) {
            harness.wheel(index % 2 === 0 ? -1 : 1);
            harness.window.dispatchEvent(new Event('scroll'));
            assert.strictEqual(harness.common.currentScale(), index % 2 === 0 ? 0.6 : 0.5);
        }
        assert.strictEqual(harness.writes.length, 0);
        assert.strictEqual(harness.frames.length, 1);
        harness.frames.shift()!(0);
        assert.strictEqual(harness.writes.length, 1);
        assert.strictEqual(harness.writes[0].uri, 'preview');
        assert.strictEqual(harness.writes[0].scale, 0.5);
        assert.strictEqual(harness.writes[0].xOffset, harness.window.pageXOffset);
    });

    it('flushes on page hide and visibility changes and writes hidden updates immediately', () => {
        const harness = createViewportHarness(bundle);
        harness.window.pageXOffset = 100;
        harness.window.dispatchEvent(new Event('scroll'));
        harness.window.dispatchEvent(new Event('pagehide'));
        assert.strictEqual(harness.writes.length, 1);
        assert.strictEqual(harness.writes[0].xOffset, 100);

        harness.window.pageXOffset = 150;
        harness.window.dispatchEvent(new Event('scroll'));
        harness.document.visibilityState = 'hidden';
        harness.document.dispatchEvent(new Event('visibilitychange'));
        assert.strictEqual(harness.writes.length, 2);
        assert.strictEqual(harness.writes[1].xOffset, 150);

        harness.window.pageXOffset = 200;
        harness.window.dispatchEvent(new Event('scroll'));
        assert.strictEqual(harness.writes.length, 3);
        assert.strictEqual(harness.writes[2].xOffset, 200);
        harness.frames.shift()!(0);
        assert.strictEqual(harness.writes.length, 3);
    });
});

function createStore(initial: Record<string, any>) {
    let persisted = initial;
    const writes: Record<string, any>[] = [];
    const frames: FrameRequestCallback[] = [];
    const store = new ViewportStateStore(() => persisted, state => {
        persisted = JSON.parse(JSON.stringify(state));
        writes.push(persisted);
    }, callback => (frames.push(callback), frames.length), () => undefined);
    return { store, frames, writes };
}

function createViewportHarness(bundle: string) {
    class ElementStub extends EventTarget {
        public style: Record<string, string> = {};
        public dataset = { previewWheel: 'zoom' };
        public append(..._children: unknown[]): void { }
        public setAttribute(_name: string, _value: string): void { }
        public closest(_selector: string): null { return null; }
    }
    const frames: FrameRequestCallback[] = [];
    const writes: Record<string, any>[] = [];
    let persisted: Record<string, unknown> = { uri: 'preview', scale: 0.5, xOffset: 10, yOffset: 20 };
    const document = Object.assign(new EventTarget(), {
        body: new ElementStub(), visibilityState: 'visible', createElement: () => new ElementStub(),
        getElementById: () => null, querySelectorAll: () => [],
    });
    const scroll = (x: number, y: number) => {
        window.scrollX = window.pageXOffset = x;
        window.scrollY = window.pageYOffset = y;
    };
    const window = Object.assign(new EventTarget(), { __i18ntable: {}, scroll, scrollTo: scroll,
        scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0, innerWidth: 800, innerHeight: 600 });
    const module = { exports: {} };
    vm.runInNewContext(bundle, { module, exports: module.exports, document, window, Element: ElementStub,
        requestAnimationFrame: (callback: FrameRequestCallback) => (frames.push(callback), frames.length),
        acquireVsCodeApi: () => ({ getState: () => persisted, setState: (state: Record<string, unknown>) => {
            persisted = JSON.parse(JSON.stringify(state));
            writes.push(persisted);
        } }), console });
    const common = module.exports as typeof import('../../webviewsrc/util/common');
    window.dispatchEvent(new Event('load'));
    common.enableZoom(new ElementStub() as unknown as HTMLDivElement, 0, 0);
    return { common, frames, writes, document, window, wheel: (deltaY: number) => {
        window.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), {
            deltaY, deltaX: 0, deltaMode: 0, pageX: 250, pageY: 150, ctrlKey: false, metaKey: false,
        }));
    } };
}
