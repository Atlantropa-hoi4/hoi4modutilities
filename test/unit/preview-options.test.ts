import * as assert from 'assert';
import Module = require('module');

const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = modules._load;
const values = new Map<string, unknown>();
const context = { current: { globalState: {
    get: (key: string) => values.get(key),
    update: async (key: string, value: unknown) => { values.set(key, value); },
} } };
const modulePath = require.resolve('../../src/util/previewoptions');
const previousModule = require.cache[modulePath];
delete require.cache[modulePath];
modules._load = function(request, parent, isMain) {
    if (request === '../context' && parent?.filename.endsWith('previewoptions.js')) {
        return { contextContainer: context };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { getPreviewOptions, setPreviewOption, mioPreviewOptionKeys } = require('../../src/util/previewoptions') as typeof import('../../src/util/previewoptions');
modules._load = originalLoad;
if (previousModule) {
    require.cache[modulePath] = previousModule;
} else {
    delete require.cache[modulePath];
}

describe('persistent preview toolbar options', () => {
    beforeEach(() => values.clear());

    it('leaves unspecified defaults to the webview', () => {
        assert.deepStrictEqual(getPreviewOptions(mioPreviewOptionKeys), {});
    });

    it('keeps false as well as true across panel reads', () => {
        setPreviewOption('mio.showGrid', true);
        setPreviewOption('mio.showOverlaps', false);
        assert.deepStrictEqual(getPreviewOptions(mioPreviewOptionKeys), {
            'mio.showGrid': true,
            'mio.showOverlaps': false,
        });
    });

    it('ignores unknown keys and non-boolean webview messages', () => {
        setPreviewOption('unrelated.setting', true);
        setPreviewOption('mio.showGrid', 'false');
        setPreviewOption('mio.showOverlaps', { enabled: true });
        assert.strictEqual(values.size, 0);
    });
});
