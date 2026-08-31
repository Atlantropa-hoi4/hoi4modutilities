import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const resolvedFileCalls: Array<{ name: string; gfxFiles: string[] }> = [];
const broadScanCalls: string[] = [];
const localisationCalls: string[] = [];
let localisationIndexEnabled = false;

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
        && parent?.filename?.includes('focustree')) {
        return {
            isUseConditionInFocusEnabled: () => false,
            isLocalisationIndexEnabled: () => localisationIndexEnabled,
            featureFlagsAsScript: () => ({ content: '' }),
        };
    }

    if ((request.endsWith('/util/localisationIndex') || request === '../../util/localisationIndex')
        && parent?.filename?.includes('focusrender')) {
        const resolveText = (key: string) => {
            localisationCalls.push(key);
            return key === 'FOCUS_A'
                ? 'Localized focus A'
                : key === 'FOCUS_DYNAMIC'
                    ? 'Dynamic $COUNTRY$ [Root.GetName]'
                    : undefined;
        };
        return {
            getLocalisedTextQuick: async (key: string) => resolveText(key),
            getLocalisedTextQuickIfReady: resolveText,
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
            getImageByPath: async () => ({ width: 64, height: 64, uri: 'default-icon.png' }),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
}

nodeModule._load = mockLoad;

const {
    buildFocusTreeRenderPayloadFromBaseState,
} = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');

describe('focustree contentbuilder', () => {
    beforeEach(() => {
        nodeModule._load = mockLoad;
        resolvedFileCalls.length = 0;
        broadScanCalls.length = 0;
        localisationCalls.length = 0;
        localisationIndexEnabled = false;
    });

    after(() => {
        nodeModule._load = originalLoad;
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
        assert.match(html, /id="search-filters"[^>]*multiple/);
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
        } as any);

        assert.match(result.payload.dynamicStyleCss, /test-icon\.png/);
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
        setTimeout(() => {
            cancelled = true;
        }, 0);

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
        );

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
        setTimeout(() => {
            cancelled = true;
        }, 0);

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
        );

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
        setTimeout(() => {
            cancelled = true;
        }, 0);

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
        );

        assert.strictEqual(resolvedFileCalls.length, 32);
    });
});
