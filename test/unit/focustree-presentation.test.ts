import * as assert from 'assert';
import Module = require('module');
import * as path from 'path';
import * as vm from 'vm';
import { buildSync } from 'esbuild';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson } from '../../src/hoiformat/schema';
import { GuiFile, guiFileSchema } from '../../src/hoiformat/gui';
import { StyleTable } from '../../src/util/styletable';

async function withPresentation(run: (api: typeof import('../../src/previewdef/focustree/presentation'), sprites: string[]) => Promise<void>) {
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const original = loader._load;
    const cached = { ...require.cache };
    const sprites: string[] = [];
    for (const key of Object.keys(require.cache)) {
        if (/[\\/]out[\\/]src[\\/]/.test(key)) { delete require.cache[key]; }
    }
    const mocks: Record<string, unknown> = {
        vscode: { env: { language: 'en' } },
        telemetry: { sendEvent: () => undefined },
        context: { contextContainer: { current: null } },
        debug: { debug: () => undefined, error: () => undefined },
        imagecache: { getSpriteByGfxName: async (name: string) => {
            sprites.push(name);
            return { id: name, width: 160, height: 40, frames: [{ uri: `data:image/png;base64,${name}` }] };
        } },
    };
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop()!;
        return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, request, parent, main);
    };
    try { await run(require('../../src/previewdef/focustree/presentation'), sprites); }
    finally {
        loader._load = original;
        for (const key of Object.keys(require.cache)) { if (!cached[key]) { delete require.cache[key]; } }
        Object.assign(require.cache, cached);
    }
}

describe('focus GUI presentation', () => {
    for (const type of ['buttonType', 'iconType']) {
        it(`replaces ${type} defaults and hides controls that require live game state`, async () => {
            await withPresentation(async (api, sprites) => {
                const gui = convertNodeToJson<GuiFile>(parseHoi4File(`guiTypes = {
                    containerWindowType = { name = national_focus_item size = { width = 165 height = 128 }
                        iconType = { name = continuous_glow spriteType = GFX_ongoing_focus_goal }
                        iconType = { name = highlight_glow spriteType = GFX_highlight_focus_goal }
                        ${type} = { name = bg position = { x = 5 y = 40 } spriteType = GFX_technology_unavailable_item_bg }
                        ${type} = { name = symbol position = { x = 5 y = -44 } orientation = center
                            centerposition = yes spriteType = GFX_goal_unknown }
                        iconType = { name = overlay }
                        iconType = { name = historical spriteType = GFX_own_chat }
                        iconType = { name = viewing_flag spriteType = GFX_flag_small2 }
                        iconType = { name = viewing_flag_border spriteType = GFX_diplo_countrylist_flag_frame }
                        instantTextBoxType = { name = name maxWidth = 147 maxHeight = 20 }
                        containerWindowType = { name = mod_decoration
                            iconType = { name = ornament spriteType = GFX_mod_ornament }
                        }
                    }
                }`), guiFileSchema);
                const item = api.findFocusWindow(gui.guitypes.flatMap(value => value.containerwindowtype), 'national_focus_item');
                const styles = new StyleTable();
                const focus = { id: 'FOCUS<id>', textIcon: 'special', overlay: 'GFX_overlay' } as any;
                const html = await api.renderFocusGui(focus, { item, styles: [{ name: 'special', unavailable: 'GFX_special' }] }, styles, [], 96, 130, '<translated>');
                assert.ok(html);
                assert.deepStrictEqual(sprites.sort(), ['GFX_mod_ornament', 'GFX_overlay', 'GFX_special']);
                assert.strictEqual(html!.split('{{iconClass}}').length - 1, 1);
                assert.match(html!, /class="\{\{iconClass\}\} focus-gui-symbol /);
                assert.match(html!, /focus-frame-gfx/);
                assert.match(html!, /focus-decoration-gfx/);
                assert.match(html!, /data-preview-label-name="&lt;translated&gt;"/);
                assert.match(styles.toStyleContent(), /left:87\.5px;top:20px;transform:translate\(-50%, -50%\)/);
                assert.doesNotMatch(styles.toStyleContent(), /GFX_goal_unknown|GFX_technology_unavailable_item_bg/);
                sprites.length = 0;
                await api.renderFocusGui({ ...focus, textIcon: undefined, overlay: undefined }, { item, styles: [] }, new StyleTable(), [], 96, 130);
                assert.deepStrictEqual(sprites.sort(), ['GFX_focus_unavailable', 'GFX_mod_ornament']);
            });
        });
    }

    it('keeps the simple renderer available when no GUI template is loaded', async () => {
        await withPresentation(async api => {
            assert.strictEqual(await api.renderFocusGui({ id: 'FOCUS' } as any, undefined, new StyleTable(), [], 96, 130), undefined);
        });
    });

    it('keeps focus names above title backgrounds regardless of GUI declaration order', async () => {
        await withPresentation(async api => {
            const gui = convertNodeToJson<GuiFile>(parseHoi4File(`guiTypes = {
                containerWindowType = { name = national_focus_item size = { width = 165 height = 128 }
                    instantTextBoxType = { name = name maxWidth = 147 maxHeight = 20 }
                    iconType = { name = bg spriteType = GFX_focus_unavailable }
                }
            }`), guiFileSchema);
            const item = api.findFocusWindow(gui.guitypes.flatMap(value => value.containerwindowtype), 'national_focus_item');
            const styles = new StyleTable();
            const html = await api.renderFocusGui({ id: 'VISIBLE_FOCUS_NAME' } as any,
                { item, styles: [] }, styles, [], 96, 130);

            assert.ok(html);
            assert.ok(html!.indexOf('VISIBLE_FOCUS_NAME') < html!.indexOf('focus-frame-gfx'));
            assert.match(html!, /focus-gui-name/);
            assert.match(styles.toStyleContent(), /z-index:2;pointer-events:none/);
        });
    });
});

describe('focus GFX visibility controls', () => {
    function preview(initial: Record<string, unknown> = {}, onVisibilityChange?: () => void) {
        const state = { ...initial };
        const dataset: Record<string, string> = {};
        const controls = Object.fromEntries(['focus-frame-gfx', 'focus-decoration-gfx'].map(id => {
            const attributes: Record<string, string> = {};
            const listeners: Record<string, () => void> = {};
            return [id, { attributes, listeners,
                setAttribute: (key: string, value: string) => { attributes[key] = value; },
                addEventListener: (event: string, listener: () => void) => { listeners[event] = listener; },
            }];
        }));
        const module = { exports: {} };
        const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../..', 'webviewsrc/focustree/presentation.ts')],
            bundle: true, platform: 'browser', format: 'cjs', write: false,
            define: { VERSION: '"test"', EXTENSION_ID: '"test"' } });
        vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, console, setTimeout, clearTimeout,
            window: { addEventListener: () => undefined, __i18ntable: {} },
            document: { body: { dataset }, getElementById: (id: string) => controls[id] },
            acquireVsCodeApi: () => ({ getState: () => state, setState: (value: unknown) => Object.assign(state, value), postMessage: () => undefined }),
        });
        (module.exports as typeof import('../../webviewsrc/focustree/presentation')).initializeFocusPresentation(onVisibilityChange);
        return { state, dataset, controls };
    }

    it('toggles frames and decorations independently without changing selection or zoom', () => {
        const view = preview({ selectedFocusTreeId: 'tree', scale: 0.8 });
        assert.deepStrictEqual(view.dataset, { focusFrames: 'true', focusDecorations: 'true' });
        view.controls['focus-frame-gfx'].listeners.click();
        assert.deepStrictEqual(view.dataset, { focusFrames: 'false', focusDecorations: 'true' });
        assert.strictEqual(view.controls['focus-frame-gfx'].attributes['aria-pressed'], 'false');
        view.controls['focus-decoration-gfx'].listeners.click();
        const restored = preview(view.state);
        assert.deepStrictEqual(restored.dataset, { focusFrames: 'false', focusDecorations: 'false' });
        restored.controls['focus-frame-gfx'].listeners.click();
        assert.strictEqual(restored.dataset.focusFrames, 'true');
        assert.strictEqual(restored.state.selectedFocusTreeId, 'tree');
        assert.strictEqual(restored.state.scale, 0.8);
    });

    it('requests geometry measurement after applying visibility changes', () => {
        const changes: string[] = [];
        const view = preview({}, () => changes.push(`${view.dataset.focusFrames}/${view.dataset.focusDecorations}`));
        assert.deepStrictEqual(changes, []);
        view.controls['focus-frame-gfx'].listeners.click();
        view.controls['focus-decoration-gfx'].listeners.click();
        assert.deepStrictEqual(changes, ['false/true', 'false/false']);
    });
});
