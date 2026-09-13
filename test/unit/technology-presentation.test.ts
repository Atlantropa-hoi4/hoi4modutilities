import * as assert from 'assert';
import * as path from 'path';
import * as vm from 'vm';
import { buildSync } from 'esbuild';

describe('technology presentation controls', () => {
    function preview(initial: Record<string, unknown> = {}) {
        const state = { ...initial };
        const listeners: Record<string, () => void> = {};
        const selector = { value: '', addEventListener: (event: string, listener: () => void) => { listeners[event] = listener; } };
        const label = { textContent: '', dataset: { previewLabelId: 'tank', previewLabelName: '',
            technologyName: 'Armor technology', technologyShort: 'Tank', technologyLong: 'Medium tank' } };
        const module = { exports: {} };
        const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../..', 'webviewsrc/technology/presentation.ts')],
            bundle: true, platform: 'browser', format: 'cjs', write: false,
            define: { VERSION: '"test"', EXTENSION_ID: '"test"' } });
        vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, console, setTimeout, clearTimeout,
            window: { addEventListener: () => undefined, __i18ntable: {} },
            document: { body: { dataset: {} }, getElementById: (id: string) => id === 'technology-name-mode' ? selector : null,
                querySelectorAll: (query: string) => query === '[data-technology-name]' || query.startsWith('[data-preview-label-id]') ? [label] : [] },
            acquireVsCodeApi: () => ({ getState: () => state, setState: (value: unknown) => Object.assign(state, value), postMessage: () => undefined }),
        });
        return { api: module.exports as typeof import('../../webviewsrc/technology/presentation'), state, selector, label, listeners };
    }
    it('switches between ID, technology name, short equipment name and full equipment name', () => {
        const view = preview();
        view.api.initializeTechnologyPresentation('name');
        view.api.applyTechnologyLabels();
        assert.strictEqual(view.label.textContent, 'Armor technology');
        for (const [mode, text] of [['id', 'tank'], ['short', 'Tank'], ['long', 'Medium tank'], ['tech', 'Armor technology']]) {
            view.selector.value = mode;
            view.listeners.change();
            assert.strictEqual(view.label.textContent, text);
            assert.strictEqual(view.state.technologyNameMode, mode);
        }
    });
    it('preserves the legacy ID preference and restores the selected name mode', () => {
        const legacy = preview(); legacy.api.initializeTechnologyPresentation('id'); legacy.api.applyTechnologyLabels();
        assert.strictEqual(legacy.label.textContent, 'tank');
        assert.strictEqual(legacy.selector.value, 'id');
        const restored = preview({ technologyNameMode: 'long', previewLabelMode: 'name' });
        restored.api.initializeTechnologyPresentation('id'); restored.api.applyTechnologyLabels();
        assert.strictEqual(restored.selector.value, 'long');
        assert.strictEqual(restored.label.textContent, 'Medium tank');
    });
});
