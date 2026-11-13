import * as assert from 'assert';
import { buildSync } from 'esbuild';
import * as vm from 'vm';

describe('country label rendering lifecycle', () => {
    let bundle: string;
    before(() => {
        bundle = buildSync({ stdin: { contents: `export { Renderer } from './webviewsrc/worldmap/renderer';
            export { TopBar } from './webviewsrc/worldmap/topbar';`, resolveDir: process.cwd(), loader: 'ts' },
        bundle: true, write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
    });

    it('does not publish a prepared font after its map was superseded or disposed', async () => {
        const harness = renderingHarness(bundle);
        let current = true;
        const pending = harness.Renderer.prepareCountryLabels({ lineHeight: 20, imageUri: 'data:image/png;base64,test', glyphs: {} }, () => current);
        for (let attempt = 0; attempt < 10 && harness.images.length === 0; attempt++) { await Promise.resolve(); }
        assert.strictEqual(harness.images.length, 1);
        current = false;
        harness.images[0].onload?.();
        await pending;
        assert.strictEqual(harness.Renderer.mapFontImages.size, 0);
    });

    for (const change of ['refresh', 'dispose']) {
        it(`does not export after ${change} while country labels are loading`, async () => {
            const harness = renderingHarness(bundle);
            let finish!: () => void;
            const labels = new Promise<void>(resolve => { finish = resolve; });
            let generation = 1;
            const map = { width: 10, height: 10 };
            const owner = { disposed: false, colorSet$: { value: 'owner' }, display: { selectedValues$: { value: ['countryname'] } },
                loader: { worldMap: map, mapGeneration: 1,
                    isCurrentMap: (_map: unknown, version: number) => version === generation,
                    requestCountryLabels: () => labels } };
            const pending = harness.TopBar.prototype.exportMap.call(owner, { command: 'requestexportmap', scale: 2 });
            if (change === 'refresh') { generation++; } else { owner.disposed = true; }
            finish();
            await pending;
            assert.strictEqual(harness.messages.length, 0);
        });
    }
});

function renderingHarness(bundle: string) {
    const images: { onload?: () => void; onerror?: () => void; src: string }[] = [];
    const messages: unknown[] = [];
    class ImageStub {
        public onload?: () => void;
        public onerror?: () => void;
        public src = '';
        constructor() { images.push(this); }
    }
    const module = { exports: {} };
    vm.runInNewContext(bundle, { module, exports: module.exports, window: Object.assign(new EventTarget(), { __i18ntable: {} }),
        Image: ImageStub, console, acquireVsCodeApi: () => ({ getState: () => ({}), setState: () => undefined,
            postMessage: (message: unknown) => messages.push(message) }) });
    return { ...module.exports as { Renderer: any; TopBar: any }, images, messages };
}
