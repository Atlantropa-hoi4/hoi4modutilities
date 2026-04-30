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
    isLocalisationIndexEnabled,
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
    });

    it('allows preview indexes to be disabled explicitly', () => {
        configuredFeatureFlags = ['!gfxIndex', '!localisationIndex'];

        assert.strictEqual(isGfxIndexEnabled(), false);
        assert.strictEqual(isLocalisationIndexEnabled(), false);
    });
});
