import * as assert from 'assert';
import Module = require('module');
import type { FocusTreeRenderBaseState } from '../../src/previewdef/focustree/contentbuilder';
import type * as FocusSchema from '../../src/previewdef/focustree/schema';
import type * as HoiParser from '../../src/hoiformat/hoiparser';
import type * as FocusIconAssets from '../../src/previewdef/focustree/focusicongfx';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const resolvedFileCalls: Array<{ name: string; gfxFiles: string[] }> = [];
const broadScanCalls: string[] = [];
const localisationCalls: string[] = [];
let localisationIndexEnabled = false;
/** The game's default unknown-focus icon can be decoded. */
let defaultFocusIconAvailable = true;

function mockLoad(this: unknown, request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
            },
            Uri: {
                joinPath: () => ({ toString: () => 'mock-uri' }),
            },
        };
    }

    if ((request.endsWith('/util/featureflags') || request === '../../util/featureflags')
        && parent?.filename?.includes('focustree') && !/previewsession(?:\.test)?\.js$/.test(parent.filename)) {
        return {
            isUseConditionInFocusEnabled: () => false,
            isLocalisationIndexEnabled: () => localisationIndexEnabled,
            featureFlagsAsScript: () => ({ content: '' }),
        };
    }

    if ((request.endsWith('/util/localisationIndex') || request === '../../util/localisationIndex')
        && parent?.filename?.includes('focustree') && !/previewsession(?:\.test)?\.js$/.test(parent.filename)) {
        const resolveText = (key: string) => {
            localisationCalls.push(key);
            return key === 'FOCUS_A'
                ? 'Localized focus A'
                : key === 'FOCUS_FILTER_ARMY_BONUS'
                    ? 'Army bonus'
                : key === 'FOCUS_DYNAMIC'
                    ? 'Dynamic $COUNTRY$ [Root.GetName]'
                    : undefined;
        };
        return {
            getLocalisedTextQuick: async (key: string) => resolveText(key),
            getLocalisedTextQuickIfReady: resolveText,
            isLocalisationIndexReady: () => localisationIndexEnabled,
            createLocalisedTextQuickIfReadyResolver: () => localisationIndexEnabled
                ? resolveText
                : (key: string) => key,
        };
    }

    if ((request.endsWith('/util/i18n') || request === '../../util/i18n')
        && parent?.filename?.includes('contentbuilder')) {
        return {
            localize: (_key: string, fallback: string) => fallback,
            i18nTableAsScript: () => ({ content: '' }),
        };
    }

    if ((request.endsWith('/util/image/imagecache') || request === '../../util/image/imagecache')
        && parent?.filename?.includes('contentbuilder')) {
        return {
            getSpriteByGfxNameFromResolvedFiles: async (name: string, gfxFiles: string[]) => {
                resolvedFileCalls.push({ name, gfxFiles });
                return name === 'GFX_FOCUS_A'
                    ? { image: { width: 64, height: 64, uri: 'test-icon.png' } }
                    : name === 'GFX_FOCUS_B'
                        ? { image: { width: 64, height: 64, uri: 'second-icon.png' } }
                    : name === 'GFX_INLAY'
                        ? {
                            image: { width: 48, height: 48, uri: 'inlay-icon.png' },
                            frames: [{ width: 48, height: 48, uri: 'inlay-icon.png' }],
                        }
                    : undefined;
            },
            getSpriteByGfxName: async (name: string) => {
                broadScanCalls.push(name);
                return undefined;
            },
            getImageByPath: async () => defaultFocusIconAvailable ? { width: 64, height: 64, uri: 'default-icon.png' } : undefined,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
}

nodeModule._load = mockLoad;

const {
    buildFocusTreeRenderPayloadFromBaseState,
} = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
const { getFocusTree } = require('../../src/previewdef/focustree/schema') as typeof FocusSchema;
const { parseHoi4File } = require('../../src/hoiformat/hoiparser') as typeof HoiParser;
const { createEmptyFocusIconAssetResolution } = require('../../src/previewdef/focustree/focusicongfx') as typeof FocusIconAssets;

describe('focustree contentbuilder', () => {
    beforeEach(() => {
        nodeModule._load = mockLoad;
        resolvedFileCalls.length = 0;
        broadScanCalls.length = 0;
        localisationCalls.length = 0;
        localisationIndexEnabled = false;
        defaultFocusIconAvailable = true;
    });

    after(() => {
        nodeModule._load = originalLoad;
    });

    it('retains the complete source catalog but decodes and styles only the selected tree', async () => {
        const trees = getFocusTree(parseHoi4File(`
            focus_tree = { id = tree_a focus = { id = FOCUS_A icon = GFX_FOCUS_A x = 0 y = 0 } }
            focus_tree = { id = tree_b focus = { id = FOCUS_B icon = GFX_FOCUS_B x = 1 y = 0 } }
        `), [], 'common/national_focus/test.txt');
        const allFocuses = trees.flatMap(tree => Object.values(tree.focuses));
        const resolution = {
            ...createEmptyFocusIconAssetResolution(),
            gfxFiles: ['interface/custom_icons.gfx'],
            gfxFileByIconName: { GFX_FOCUS_A: 'interface/custom_icons.gfx', GFX_FOCUS_B: 'interface/custom_icons.gfx' },
        };
        // Match the existing simplified grid fixture used by this suite.
        const base = {
            focusTrees: trees, allFocuses, allInlays: [],
            focusById: Object.fromEntries(allFocuses.map(focus => [focus.id, focus])),
            gfxFiles: ['interface/custom_icons.gfx'],
            focusIconGfxFileByName: {}, focusIconAssetResolution: resolution,
            focusIconStyleSignature: resolution.styleSignature,
            gridBox: { position: { x: 0, y: 0 } }, xGridSize: 96, yGridSize: 130,
            focusPositionDocumentVersion: 1, focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {}, hasFocusSelector: true, hasWarningsButton: false,
            loadDurationMs: 0, deferredAssetLoad: false, localisationIndexReady: false,
        } as unknown as FocusTreeRenderBaseState;
        const first = await buildFocusTreeRenderPayloadFromBaseState({ ...base, assetTreeIds: ['tree_a'] });
        assert.deepStrictEqual(first.payload.focusTrees.map(tree => tree.id), ['tree_a', 'tree_b']);
        assert.deepStrictEqual(first.payload.sourceFocusTrees, trees);
        assert.strictEqual(first.metrics.focusCount, 2);
        assert.strictEqual(first.metrics.renderedFocusCount, 1);
        assert.match(first.payload.dynamicStyleCss, /st-focus-icon-GFX_FOCUS_A/);
        assert.match(first.payload.dynamicStyleCss, /test-icon\.png/);
        assert.doesNotMatch(first.payload.dynamicStyleCss, /st-focus-icon-GFX_FOCUS_B|second-icon\.png/);
        resolvedFileCalls.length = 0;
        const second = await buildFocusTreeRenderPayloadFromBaseState({ ...base, assetTreeIds: ['tree_b'] });
        assert.strictEqual(second.payload.selectedTreeId, 'tree_b');
        assert.strictEqual(second.metrics.renderedFocusCount, 1);
        assert.match(second.payload.dynamicStyleCss, /st-focus-icon-GFX_FOCUS_B/);
        assert.match(second.payload.dynamicStyleCss, /second-icon\.png/);
        assert.doesNotMatch(second.payload.dynamicStyleCss, /st-focus-icon-GFX_FOCUS_A|test-icon\.png/);
    });

    it('decodes only materialized focuses and keeps every other icon of the scene a placeholder', async () => {
        const trees = getFocusTree(parseHoi4File(`
            focus_tree = { id = tree_a
                focus = { id = FOCUS_A icon = GFX_FOCUS_A x = 0 y = 0 }
                focus = { id = FOCUS_B icon = GFX_FOCUS_B x = 1 y = 0 }
                focus = { id = FOCUS_C icon = GFX_FOCUS_C x = 2 y = 0 }
            }
            focus_tree = { id = tree_b focus = { id = FOCUS_D icon = GFX_FOCUS_D x = 0 y = 0 } }
        `), [], 'common/national_focus/test.txt');
        const allFocuses = trees.flatMap(tree => Object.values(tree.focuses));
        const resolution = {
            ...createEmptyFocusIconAssetResolution(),
            gfxFiles: ['interface/custom_icons.gfx'],
            gfxFileByIconName: Object.fromEntries(['A', 'B', 'C', 'D'].map(id => [`GFX_FOCUS_${id}`, 'interface/custom_icons.gfx'])),
        };
        const base = {
            focusTrees: trees, allFocuses, allInlays: [],
            focusById: Object.fromEntries(allFocuses.map(focus => [focus.id, focus])),
            gfxFiles: ['interface/custom_icons.gfx'],
            focusIconGfxFileByName: {}, focusIconAssetResolution: resolution,
            focusIconStyleSignature: resolution.styleSignature,
            gridBox: { position: { x: 0, y: 0 } }, xGridSize: 96, yGridSize: 130,
            focusPositionDocumentVersion: 1, focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {}, hasFocusSelector: true, hasWarningsButton: false,
            loadDurationMs: 0, deferredAssetLoad: false, localisationIndexReady: false,
            assetTreeIds: ['tree_a'],
        } as unknown as FocusTreeRenderBaseState;

        const result = await buildFocusTreeRenderPayloadFromBaseState(base, undefined, undefined, undefined, ['FOCUS_B', 'FOCUS_D', 'MISSING']);
        assert.deepStrictEqual(result.payload.materializedFocusIds, ['FOCUS_B'], 'ids outside the asset trees are dropped');
        assert.deepStrictEqual(resolvedFileCalls.map(call => call.name), ['GFX_FOCUS_B'], 'only the materialized icon is decoded');
        assert.strictEqual(result.metrics.renderedFocusCount, 3);
        assert.strictEqual(result.metrics.materializedFocusCount, 1);
        assert.match(result.payload.dynamicStyleCss, /\.st-focus-icon-GFX_FOCUS_B \{[^}]*second-icon\.png[^}]*--focus-icon-state: loaded/);
        assert.match(result.payload.dynamicStyleCss, /\.st-focus-icon-GFX_FOCUS_A \{[^}]*background: grey[^}]*--focus-icon-state: placeholder/);
        assert.match(result.payload.dynamicStyleCss, /\.st-focus-icon-GFX_FOCUS_C \{[^}]*background: grey[^}]*--focus-icon-state: placeholder/);
        assert.doesNotMatch(result.payload.dynamicStyleCss, /test-icon\.png|GFX_FOCUS_D/);
    });

    it('keeps an icon that focuses share real when one is materialized, also after merging another scene', async () => {
        const { mergeFocusTreeStyleRules } = require('../../src/previewdef/focustree/renderpayloadpatch') as typeof import('../../src/previewdef/focustree/renderpayloadpatch');
        const trees = getFocusTree(parseHoi4File(`
            focus_tree = { id = tree_a
                focus = { id = FOCUS_A icon = GFX_FOCUS_A x = 0 y = 0 }
                focus = { id = FOCUS_A_UNSEEN icon = GFX_FOCUS_A x = 1 y = 0 }
            }
            focus_tree = { id = tree_b
                focus = { id = FOCUS_SHARING icon = GFX_FOCUS_A x = 0 y = 0 }
                focus = { id = FOCUS_B icon = GFX_FOCUS_B x = 1 y = 0 }
            }
        `), [], 'common/national_focus/test.txt');
        const allFocuses = trees.flatMap(tree => Object.values(tree.focuses));
        const resolution = {
            ...createEmptyFocusIconAssetResolution(),
            gfxFiles: ['interface/custom_icons.gfx'],
            gfxFileByIconName: { GFX_FOCUS_A: 'interface/custom_icons.gfx', GFX_FOCUS_B: 'interface/custom_icons.gfx' },
        };
        const base = {
            focusTrees: trees, allFocuses, allInlays: [],
            focusById: Object.fromEntries(allFocuses.map(focus => [focus.id, focus])),
            gfxFiles: ['interface/custom_icons.gfx'],
            focusIconGfxFileByName: {}, focusIconAssetResolution: resolution,
            focusIconStyleSignature: resolution.styleSignature,
            gridBox: { position: { x: 0, y: 0 } }, xGridSize: 96, yGridSize: 130,
            focusPositionDocumentVersion: 1, focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {}, hasFocusSelector: true, hasWarningsButton: false,
            loadDurationMs: 0, deferredAssetLoad: false, localisationIndexReady: false,
        } as unknown as FocusTreeRenderBaseState;
        const iconKey = 'st-focus-icon-GFX_FOCUS_A';
        const loaded = /test-icon\.png[\s\S]*--focus-icon-state: loaded/;

        // A full build: the materialized focus's real rule wins over its unseen twin's placeholder.
        const first = await buildFocusTreeRenderPayloadFromBaseState({ ...base, assetTreeIds: ['tree_a'] }, undefined, undefined, undefined, ['FOCUS_A']);
        const firstRules = first.payload.dynamicStyleRules!;
        assert.match(firstRules.get(iconKey) ?? '', loaded);

        // tree_b joins that scene without materialized focuses; FOCUS_SHARING uses the same icon.
        const second = await buildFocusTreeRenderPayloadFromBaseState(
            { ...base, assetTreeIds: ['tree_b'] }, undefined, undefined, undefined, ['FOCUS_A'], firstRules);
        const secondRules = second.payload.dynamicStyleRules!;
        assert.strictEqual(secondRules.has(iconKey), false, 'no placeholder for an icon the joined scene already has');
        assert.match(secondRules.get('st-focus-icon-GFX_FOCUS_B') ?? '', /--focus-icon-state: placeholder/);
        const merged = mergeFocusTreeStyleRules(first.payload.dynamicStyleCss, firstRules, secondRules);
        assert.strictEqual(merged.dynamicStyleRules.get(iconKey), firstRules.get(iconKey));
        assert.doesNotMatch(merged.appendedCss, /st-focus-icon-GFX_FOCUS_A/);
        const cascaded = Array.from(merged.dynamicStyleCss.matchAll(/\.st-focus-icon-GFX_FOCUS_A \{([^}]*)\}/g)).at(-1)?.[1] ?? '';
        assert.match(cascaded, loaded, 'the merged stylesheet still renders the shared icon for real');

        // A standalone build of tree_b still styles every icon it uses.
        const standalone = await buildFocusTreeRenderPayloadFromBaseState({ ...base, assetTreeIds: ['tree_b'] }, undefined, undefined, undefined, []);
        assert.match(standalone.payload.dynamicStyleRules?.get(iconKey) ?? '', /--focus-icon-state: placeholder/);
    });

    it('marks an icon without any decodable image as unavailable, never as loaded', async () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = { id = tree_a
                focus = { id = FOCUS_A icon = GFX_FOCUS_A x = 0 y = 0 }
                focus = { id = FOCUS_MISSING icon = GFX_MISSING x = 1 y = 0 }
            }
        `), [], 'common/national_focus/test.txt');
        const options = {
            focusIconAssetResolution: {
                ...createEmptyFocusIconAssetResolution(),
                gfxFileByIconName: { GFX_FOCUS_A: 'interface/custom_icons.gfx', GFX_MISSING: 'interface/custom_icons.gfx' },
            },
            xGridSize: 96,
            yGridSize: 130,
            useNativeSize: false,
            existingStyleRules: new Map<string, string>(),
        };

        const withDefault = new Map((await contentbuilder.renderFocusAssetStylePatch([tree.focuses.FOCUS_MISSING], options)).rules);
        assert.match(withDefault.get('st-focus-icon-GFX_MISSING') ?? '', /default-icon\.png[\s\S]*--focus-icon-state: loaded/,
            'an unresolved sprite shows the game default unknown-focus icon, a real decoded image');

        defaultFocusIconAvailable = false;
        const rules = new Map((await contentbuilder.renderFocusAssetStylePatch([tree.focuses.FOCUS_A, tree.focuses.FOCUS_MISSING], options)).rules);
        assert.match(rules.get('st-focus-icon-GFX_FOCUS_A') ?? '', /test-icon\.png[\s\S]*--focus-icon-state: loaded/);
        assert.match(rules.get('st-focus-icon-GFX_MISSING') ?? '', /background: grey;[\s\S]*--focus-icon-state: unavailable/);
    });

    it('sends only asset rules the webview lacks unless it asks for them again', async () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = { id = tree_a
                focus = { id = FOCUS_A icon = GFX_FOCUS_A x = 0 y = 0 }
                focus = { id = FOCUS_B icon = GFX_FOCUS_B x = 1 y = 0 }
            }
        `), [], 'common/national_focus/test.txt');
        const options = {
            focusIconAssetResolution: {
                ...createEmptyFocusIconAssetResolution(),
                gfxFileByIconName: { GFX_FOCUS_A: 'interface/custom_icons.gfx', GFX_FOCUS_B: 'interface/custom_icons.gfx' },
            },
            xGridSize: 96,
            yGridSize: 130,
            useNativeSize: false,
            existingStyleRules: new Map<string, string>(),
        };
        const first = await contentbuilder.renderFocusAssetStylePatch([tree.focuses.FOCUS_A], options);
        assert.match(first.css, /\.st-focus-icon-GFX_FOCUS_A \{[^}]*test-icon\.png/);

        // The webview already shows A for real and B as a placeholder.
        const existingStyleRules = new Map([...first.rules, ['st-focus-icon-GFX_FOCUS_B', 'background: grey;'] as [string, string]]);
        const second = await contentbuilder.renderFocusAssetStylePatch([tree.focuses.FOCUS_A, tree.focuses.FOCUS_B], { ...options, existingStyleRules });
        assert.deepStrictEqual(second.rules.map(([key]) => key), ['st-focus-icon-GFX_FOCUS_B']);
        assert.match(second.css, /second-icon\.png/);

        const resent = await contentbuilder.renderFocusAssetStylePatch([tree.focuses.FOCUS_A], {
            ...options,
            existingStyleRules,
            resendFocusIds: new Set(['FOCUS_A']),
        });
        assert.deepStrictEqual(resent.rules.map(([key]) => key), ['st-focus-icon-GFX_FOCUS_A']);
    });

    it('renders a hidden polite status region for focus icon loading', () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const html = contentbuilder.renderFocusTreeShellHtml({ toString: () => 'file:///focus.txt' } as any, {} as any, 1, {});
        assert.match(html, /<div id="focus-asset-status" role="status" aria-live="polite" aria-atomic="true" hidden>/);
        assert.match(html, /<button type="button" id="focus-asset-retry" hidden>Retry<\/button>/);
        assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    });

    it('keeps deferred focus icon styles lightweight while using ready localisation', async () => {
        localisationIndexEnabled = true;
        const focus = {
            id: 'FOCUS_A',
            layoutEditKey: 'focus_a',
            x: 0,
            y: 0,
            icon: [{ icon: 'GFX_FOCUS_A', condition: { _type: 'and', items: [] } }],
            availableIfCapitulated: false,
            hasAiWillDo: false,
            hasCompletionReward: false,
            prerequisite: [],
            prerequisiteGroupCount: 0,
            prerequisiteFocusCount: 0,
            exclusive: [],
            exclusiveCount: 0,
            hasAllowBranch: false,
            inAllowBranch: [],
            allowBranch: undefined,
            relativePositionId: undefined,
            offset: [],
            token: undefined,
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
            lintWarningCount: 0,
            lintInfoCount: 0,
        };
        const focusTree = {
            id: 'tree_a',
            kind: 'focus',
            focuses: { FOCUS_A: focus },
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [focus],
            allInlays: [],
            focusById: { FOCUS_A: focus },
            gfxFiles: ['interface/custom_icons.gfx'],
            focusIconGfxFileByName: {},
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: true,
        } as any);

        assert.strictEqual(result.payload.deferredAssetLoad, true);
        assert.doesNotMatch(result.payload.dynamicStyleCss, /test-icon\.png/);
        assert.match(result.payload.dynamicStyleCss, /background:\s*grey/);
        assert.deepStrictEqual(resolvedFileCalls, []);
        assert.strictEqual(result.metrics.deferredAssetLoad, true);
        assert.ok(result.metrics.localisationResolveDurationMs >= 0);
    });

    it('hides the inlay selector by default in the shell markup', async () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const html = contentbuilder.renderFocusTreeShellHtml(
            { toString: () => 'file:///focus.txt' } as any,
            {} as any,
            1,
            {},
        );

        assert.match(html, /id="inlay-window-container"[^>]*style="display:none;"/);
        assert.match(html, /id="search-filters"[^>]*role="combobox"[^>]*aria-multiselectable="true"/);
        assert.doesNotMatch(html, /<select id="search-filters"/);
    });

    it('resolves focus search filter labels without changing their ids', async () => {
        localisationIndexEnabled = true;
        const focusTree = {
            id: 'tree_a',
            focuses: {},
            inlayWindows: [],
            warnings: [],
            searchFilters: ['FOCUS_FILTER_ARMY_BONUS'],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [],
            allInlays: [],
            focusById: {},
            gfxFiles: [],
            focusIconGfxFileByName: {},
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: true,
        } as any);

        assert.deepStrictEqual(result.payload.focusTrees[0].searchFilters, ['FOCUS_FILTER_ARMY_BONUS']);
        assert.deepStrictEqual(result.payload.focusTrees[0].searchFilterLabels, {
            FOCUS_FILTER_ARMY_BONUS: 'Army bonus',
        });
    });

    it('keeps the fixed toolbar above interactive focus and inlay layers', () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const html = contentbuilder.renderFocusTreeShellHtml(
            { toString: () => 'file:///focus.txt' } as any,
            {} as any,
            1,
            {},
        );

        assert.match(html, /\.st-toolbar-height\s*\{[^}]*z-index:\s*10;/);
    });

    it('prevents warning entries from inheriting the global active button scale', async () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const html = contentbuilder.renderFocusTreeShellHtml(
            { toString: () => 'file:///focus.txt' } as any,
            {} as any,
            1,
            {},
        );

        assert.match(html, /\.st-warnings-entry:active\s*\{[^}]*transform:\s*none;[^}]*transition:\s*none;/);
    });

    it('prevents warning entries from inheriting the global icon button size', async () => {
        const contentbuilder = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');
        const html = contentbuilder.renderFocusTreeShellHtml(
            { toString: () => 'file:///focus.txt' } as any,
            {} as any,
            1,
            {},
        );

        assert.match(html, /\.st-warnings-entry\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*min-height:\s*56px;/);
        assert.match(html, /\.st-warnings\s*\{[^}]*gap:\s*12px;/);
    });

    it('registers shared focus card styles even before any real focus html is rendered', async () => {
        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [],
            allFocuses: [],
            allInlays: [],
            focusById: {},
            gfxFiles: [],
            focusIconGfxFileByName: {},
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: false,
        } as any);

        assert.match(result.payload.dynamicStyleCss, /\.st-focus-common\s*\{/);
        assert.match(result.payload.dynamicStyleCss, /\.st-focus-icon-slot\s*\{/);
        assert.match(result.payload.dynamicStyleCss, /\.st-focus-span\s*\{/);
    });

    it('surfaces dynamic localisation tokens as focus preview warnings', async () => {
        localisationIndexEnabled = true;
        const focus = {
            id: 'FOCUS_DYNAMIC',
            layoutEditKey: 'focus_dynamic',
            x: 0,
            y: 0,
            icon: [],
            availableIfCapitulated: false,
            hasAiWillDo: false,
            hasCompletionReward: false,
            prerequisite: [],
            prerequisiteGroupCount: 0,
            prerequisiteFocusCount: 0,
            exclusive: [],
            exclusiveCount: 0,
            hasAllowBranch: false,
            inAllowBranch: [],
            allowBranch: undefined,
            relativePositionId: undefined,
            offset: [],
            token: { start: 10, end: 30 },
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
            lintWarningCount: 0,
            lintInfoCount: 0,
        };
        const focusTree = {
            id: 'tree_dynamic',
            kind: 'focus',
            focuses: { FOCUS_DYNAMIC: focus },
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [focus],
            allInlays: [],
            focusById: { FOCUS_DYNAMIC: focus },
            gfxFiles: [],
            focusIconGfxFileByName: {},
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: true,
        } as any);

        assert.strictEqual(result.payload.hasWarningsButton, true);
        assert.ok(focusTree.warnings.some((warning: any) =>
            warning.code === 'focus-localisation-dynamic-token'
            && warning.severity === 'info'
            && warning.source === 'FOCUS_DYNAMIC'
            && warning.navigations[0].start === 10));
    });

    it('reuses resolved focus icon gfx files while preparing icon styles', async () => {
        const assetStyleBatches: string[] = [];
        const focus = {
            id: 'FOCUS_A',
            layoutEditKey: 'focus_a',
            x: 0,
            y: 0,
            icon: [{ icon: 'GFX_FOCUS_A', condition: { _type: 'and', items: [] } }],
            availableIfCapitulated: false,
            hasAiWillDo: false,
            hasCompletionReward: false,
            prerequisite: [],
            prerequisiteGroupCount: 0,
            prerequisiteFocusCount: 0,
            exclusive: [],
            exclusiveCount: 0,
            hasAllowBranch: false,
            inAllowBranch: [],
            allowBranch: undefined,
            relativePositionId: undefined,
            offset: [],
            token: undefined,
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
            lintWarningCount: 0,
            lintInfoCount: 0,
        };
        const focusTree = {
            id: 'tree_a',
            kind: 'focus',
            focuses: { FOCUS_A: focus },
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [focus],
            allInlays: [],
            focusById: { FOCUS_A: focus },
            gfxFiles: ['interface/mapped_icons.gfx', 'interface/other_icons.gfx'],
            focusIconGfxFileByName: { GFX_FOCUS_A: 'interface/mapped_icons.gfx' },
            focusIconAssetResolution: {
                gfxFiles: ['interface/mapped_icons.gfx'],
                gfxFileByIconName: { GFX_FOCUS_A: 'interface/mapped_icons.gfx' },
                textureFiles: ['gfx/interface/goals/focus_a.dds'],
                textureFileByIconName: { GFX_FOCUS_A: 'gfx/interface/goals/focus_a.dds' },
                textureExpiryTokenByIconName: { GFX_FOCUS_A: 'mtime-1' },
                unresolvedIconNames: [],
                styleSignature: 'focus-a',
            },
            focusIconStyleSignature: 'focus-a',
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: false,
        } as any, undefined, batch => {
            assetStyleBatches.push(batch.css);
        });

        assert.match(result.payload.dynamicStyleCss, /test-icon\.png/);
        assert.strictEqual(assetStyleBatches.length, 1);
        assert.match(assetStyleBatches[0], /test-icon\.png/);
        assert.deepStrictEqual(resolvedFileCalls, [
            { name: 'GFX_FOCUS_A', gfxFiles: ['interface/mapped_icons.gfx'] },
        ]);
        assert.deepStrictEqual(broadScanCalls, []);
    });

    it('uses the default icon for unresolved focus icons without broad gfx scans', async () => {
        const focus = {
            id: 'FOCUS_A',
            layoutEditKey: 'focus_a',
            x: 0,
            y: 0,
            icon: [{ icon: 'GFX_MISSING', condition: { _type: 'and', items: [] } }],
            availableIfCapitulated: false,
            hasAiWillDo: false,
            hasCompletionReward: false,
            prerequisite: [],
            prerequisiteGroupCount: 0,
            prerequisiteFocusCount: 0,
            exclusive: [],
            exclusiveCount: 0,
            hasAllowBranch: false,
            inAllowBranch: [],
            allowBranch: undefined,
            relativePositionId: undefined,
            offset: [],
            token: undefined,
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
            lintWarningCount: 0,
            lintInfoCount: 0,
        };
        const focusTree = {
            id: 'tree_a',
            kind: 'focus',
            focuses: { FOCUS_A: focus },
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [focus],
            allInlays: [],
            focusById: { FOCUS_A: focus },
            gfxFiles: ['interface/other_icons.gfx'],
            focusIconGfxFileByName: {},
            focusIconAssetResolution: {
                gfxFiles: [],
                gfxFileByIconName: {},
                textureFiles: [],
                textureFileByIconName: {},
                textureExpiryTokenByIconName: {},
                unresolvedIconNames: ['GFX_MISSING'],
                styleSignature: 'missing',
            },
            focusIconStyleSignature: 'missing',
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: false,
        } as any);

        assert.match(result.payload.dynamicStyleCss, /default-icon\.png/);
        assert.deepStrictEqual(resolvedFileCalls, []);
        assert.deepStrictEqual(broadScanCalls, []);
    });

    it('renders resolved inlay gfx without broad gfx index scans', async () => {
        const focusTree = {
            id: 'tree_a',
            kind: 'focus',
            focuses: {},
            inlayWindowRefs: [],
            inlayWindows: [{
                id: 'inlay_a',
                file: 'common/focus_inlay_windows/test.txt',
                position: { x: 0, y: 0 },
                visible: true,
                internal: false,
                conditionExprs: [],
                scriptedImages: [{
                    id: 'slot_a',
                    gfxOptions: [{
                        gfxName: 'GFX_INLAY',
                        gfxFile: 'interface/inlay_icons.gfx',
                        condition: { _type: 'and', items: [] },
                    }],
                }],
                scriptedButtons: [],
                guiWindow: undefined,
            }],
            inlayConditionExprs: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };

        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [focusTree],
            allFocuses: [],
            allInlays: focusTree.inlayWindows,
            focusById: {},
            gfxFiles: ['interface/inlay_icons.gfx'],
            focusIconGfxFileByName: {},
            focusIconAssetResolution: {
                gfxFiles: [],
                gfxFileByIconName: {},
                textureFiles: [],
                textureFileByIconName: {},
                textureExpiryTokenByIconName: {},
                unresolvedIconNames: [],
                styleSignature: 'inlay',
            },
            focusIconStyleSignature: 'inlay',
            gridBox: { position: { x: 0, y: 0 } },
            xGridSize: 96,
            yGridSize: 130,
            focusPositionDocumentVersion: 1,
            focusPositionActiveFile: 'common/national_focus/test.txt',
            conditionPresetsByTree: {},
            hasFocusSelector: false,
            hasWarningsButton: false,
            loadDurationMs: 1,
            deferredAssetLoad: false,
        } as any);

        assert.match(result.payload.dynamicStyleCss, /inlay-icon\.png/);
        assert.deepStrictEqual(resolvedFileCalls, [
            { name: 'GFX_INLAY', gfxFiles: ['interface/inlay_icons.gfx'] },
        ]);
        assert.deepStrictEqual(broadScanCalls, []);
    });

    it('stops a large focus payload build at a cooperative cancellation checkpoint', async () => {
        localisationIndexEnabled = true;
        const focuses = Array.from({ length: 512 }, (_, index) => ({
            id: `FOCUS_${index}`,
            layoutEditKey: `focus_${index}`,
            x: index,
            y: 0,
            icon: [],
            availableIfCapitulated: false,
            hasAiWillDo: false,
            hasCompletionReward: false,
            prerequisite: [],
            prerequisiteGroupCount: 0,
            prerequisiteFocusCount: 0,
            exclusive: [],
            exclusiveCount: 0,
            hasAllowBranch: false,
            inAllowBranch: [],
            offset: [],
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
            lintWarningCount: 0,
            lintInfoCount: 0,
        }));
        const focusById = Object.fromEntries(focuses.map(focus => [focus.id, focus]));
        const focusTree = {
            id: 'tree_cancel',
            kind: 'focus',
            focuses: focusById,
            inlayWindowRefs: [],
            inlayWindows: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };
        let cancelled = false;
        const isCancelled = () => cancelled;
        const cancellation = setImmediate(() => {
            cancelled = true;
        });

        await assert.rejects(
            buildFocusTreeRenderPayloadFromBaseState({
                focusTrees: [focusTree],
                allFocuses: focuses,
                allInlays: [],
                focusById,
                gfxFiles: [],
                focusIconGfxFileByName: {},
                gridBox: { position: { x: 0, y: 0 } },
                xGridSize: 96,
                yGridSize: 130,
                focusPositionDocumentVersion: 1,
                focusPositionActiveFile: 'common/national_focus/test.txt',
                conditionPresetsByTree: {},
                hasFocusSelector: false,
                hasWarningsButton: false,
                loadDurationMs: 1,
                deferredAssetLoad: true,
                localisationIndexReady: true,
            } as any, isCancelled),
            /Focus tree render cancelled/,
        ).finally(() => clearImmediate(cancellation));

        assert.ok(localisationCalls.length < focuses.length);
    });

    it('bounds full icon asset work before observing cancellation', async () => {
        const focuses = Array.from({ length: 96 }, (_, index) => ({
            id: `FOCUS_ICON_${index}`,
            x: index,
            y: 0,
            icon: [{ icon: `GFX_CANCEL_${index}`, condition: { _type: 'and', items: [] } }],
            prerequisite: [],
            exclusive: [],
            inAllowBranch: [],
            offset: [],
            file: 'common/national_focus/test.txt',
            isInCurrentFile: true,
        }));
        const focusById = Object.fromEntries(focuses.map(focus => [focus.id, focus]));
        const gfxFileByIconName = Object.fromEntries(
            focuses.map((focus, index) => [focus.icon[0].icon, `interface/cancel_${index}.gfx`]),
        );
        const focusTree = {
            id: 'tree_icon_cancel',
            kind: 'focus',
            focuses: focusById,
            inlayWindowRefs: [],
            inlayWindows: [],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };
        let cancelled = false;
        const cancellation = setImmediate(() => {
            cancelled = true;
        });

        await assert.rejects(
            buildFocusTreeRenderPayloadFromBaseState({
                focusTrees: [focusTree],
                allFocuses: focuses,
                allInlays: [],
                focusById,
                gfxFiles: Object.values(gfxFileByIconName),
                focusIconGfxFileByName: gfxFileByIconName,
                focusIconAssetResolution: {
                    gfxFiles: Object.values(gfxFileByIconName),
                    gfxFileByIconName,
                    textureFiles: [],
                    textureFileByIconName: {},
                    textureExpiryTokenByIconName: {},
                    unresolvedIconNames: [],
                    styleSignature: 'cancel-icons',
                },
                focusIconStyleSignature: 'cancel-icons',
                gridBox: { position: { x: 0, y: 0 } },
                xGridSize: 96,
                yGridSize: 130,
                focusPositionDocumentVersion: 1,
                focusPositionActiveFile: 'common/national_focus/test.txt',
                conditionPresetsByTree: {},
                hasFocusSelector: false,
                hasWarningsButton: false,
                loadDurationMs: 1,
                deferredAssetLoad: false,
                localisationIndexReady: false,
            } as any, () => cancelled),
            /Focus tree render cancelled/,
        ).finally(() => clearImmediate(cancellation));

        assert.strictEqual(resolvedFileCalls.length, 32);
    });

    it('bounds inlay asset work before observing cancellation', async () => {
        const inlay = {
            id: 'inlay_cancel',
            file: 'common/focus_inlay_windows/cancel.txt',
            visible: true,
            internal: false,
            conditionExprs: [],
            scriptedImages: [{
                id: 'slot_cancel',
                gfxOptions: Array.from({ length: 64 }, (_, index) => ({
                    gfxName: `GFX_INLAY_CANCEL_${index}`,
                    gfxFile: `interface/inlay_cancel_${index}.gfx`,
                    condition: { _type: 'and', items: [] },
                })),
            }],
            scriptedButtons: [],
            guiWindow: undefined,
        };
        const focusTree = {
            id: 'tree_inlay_cancel',
            kind: 'focus',
            focuses: {},
            inlayWindowRefs: [],
            inlayWindows: [inlay],
            allowBranchOptions: [],
            conditionExprs: [],
            isSharedFocues: false,
            warnings: [],
        };
        let cancelled = false;
        const cancellation = setImmediate(() => {
            cancelled = true;
        });

        await assert.rejects(
            buildFocusTreeRenderPayloadFromBaseState({
                focusTrees: [focusTree],
                allFocuses: [],
                allInlays: [inlay],
                focusById: {},
                gfxFiles: [],
                focusIconGfxFileByName: {},
                focusIconAssetResolution: {
                    gfxFiles: [],
                    gfxFileByIconName: {},
                    textureFiles: [],
                    textureFileByIconName: {},
                    textureExpiryTokenByIconName: {},
                    unresolvedIconNames: [],
                    styleSignature: 'cancel-inlays',
                },
                focusIconStyleSignature: 'cancel-inlays',
                gridBox: { position: { x: 0, y: 0 } },
                xGridSize: 96,
                yGridSize: 130,
                focusPositionDocumentVersion: 1,
                focusPositionActiveFile: 'common/national_focus/test.txt',
                conditionPresetsByTree: {},
                hasFocusSelector: false,
                hasWarningsButton: false,
                loadDurationMs: 1,
                deferredAssetLoad: false,
                localisationIndexReady: false,
            } as any, () => cancelled),
            /Focus tree render cancelled/,
        ).finally(() => clearImmediate(cancellation));

        assert.strictEqual(resolvedFileCalls.length, 32);
    });
});
