import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let configuredFeatureFlags: string[] = [];

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            FileType: {
                File: 1,
                Directory: 2,
            },
            workspace: {
                getConfiguration: () => ({
                    featureFlags: configuredFeatureFlags,
                }),
                fs: {
                    readDirectory: async () => [],
                },
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    isGfxIndexEnabled,
    isIdeaPreviewEnabled,
    isDecisionPreviewEnabled,
    isIdeaSwapIndexEnabled,
    isLocalisationIndexEnabled,
    isRightButtonDragEnabled,
    isTechnologyShowIdEnabled,
    featureFlagsAsScript,
} = require('../../src/util/featureflags') as typeof import('../../src/util/featureflags');

nodeModule._load = originalLoad;
delete require.cache[require.resolve('../../src/util/vsccommon')];

describe('feature flag helpers', () => {
    beforeEach(() => {
        configuredFeatureFlags = [];
    });

    it('enables preview indexes without opt-in feature flags', () => {
        assert.strictEqual(isGfxIndexEnabled(), true);
        assert.strictEqual(isLocalisationIndexEnabled(), true);
        assert.strictEqual(isIdeaPreviewEnabled(), true);
        assert.strictEqual(isDecisionPreviewEnabled(), true);
        assert.strictEqual(isIdeaSwapIndexEnabled(), false);
    });

    it('allows preview indexes to be disabled explicitly', () => {
        configuredFeatureFlags = ['!gfxIndex', '!localisationIndex', '!ideaPreview', '!decisionPreview'];

        assert.strictEqual(isGfxIndexEnabled(), false);
        assert.strictEqual(isLocalisationIndexEnabled(), false);
        assert.strictEqual(isIdeaPreviewEnabled(), false);
        assert.strictEqual(isDecisionPreviewEnabled(), false);
    });

    it('enables raw technology IDs only when requested', () => {
        assert.strictEqual(isTechnologyShowIdEnabled(), false);

        configuredFeatureFlags = ['technologyShowId'];

        assert.strictEqual(isTechnologyShowIdEnabled(), true);
    });

    it('serializes resolved webview feature flags while preserving local technology ID settings', () => {
        configuredFeatureFlags = ['technologyShowId', '!rightButtonDrag'];

        assert.strictEqual(isRightButtonDragEnabled(), false);
        const script = featureFlagsAsScript();
        const state = JSON.parse(script.slice('window.__featureflags = '.length, -1));

        assert.strictEqual(state.localisationIndex, true);
        assert.strictEqual(state.rightButtonDrag, false);
        assert.strictEqual(state.technologyShowId, true);
    });
});
