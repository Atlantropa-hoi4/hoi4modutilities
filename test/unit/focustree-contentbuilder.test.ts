import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
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
            useConditionInFocus: false,
            localisationIndex: false,
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
            getSpriteByGfxNameFromResolvedFiles: async (name: string) => name === 'GFX_FOCUS_A'
                ? { image: { width: 64, height: 64, uri: 'test-icon.png' } }
                : undefined,
            getSpriteByGfxName: async () => undefined,
            getImageByPath: async () => ({ width: 64, height: 64, uri: 'default-icon.png' }),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    buildFocusTreeRenderPayloadFromBaseState,
} = require('../../src/previewdef/focustree/contentbuilder') as typeof import('../../src/previewdef/focustree/contentbuilder');

describe('focustree contentbuilder', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('keeps deferred focus icon styles lightweight during deferred asset loads', async () => {
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
    });

    it('registers shared focus card styles even before any real focus html is rendered', async () => {
        const result = await buildFocusTreeRenderPayloadFromBaseState({
            focusTrees: [],
            allFocuses: [],
            allInlays: [],
            focusById: {},
            gfxFiles: [],
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
});
