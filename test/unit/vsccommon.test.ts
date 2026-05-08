import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

const directConfigurationValues = {
    installPath: 'direct-install-path',
    loadDlcContents: false,
    modFile: 'direct.mod',
    featureFlags: ['directFlag'],
    previewLocalisation: 'English',
};
const configurationGetValues = {
    installPath: 'get-install-path',
    loadDlcContents: true,
    modFile: 'get.mod',
    featureFlags: ['getFlag'],
    previewLocalisation: 'Korean',
};

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    ...directConfigurationValues,
                    get: (key: keyof typeof configurationGetValues, defaultValue: unknown) =>
                        configurationGetValues[key] ?? defaultValue,
                    has: () => false,
                    inspect: () => undefined,
                    update: async () => undefined,
                }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/vsccommon')];
const {
    getConfiguration,
    getLanguageIdInYml,
} = require('../../src/util/vsccommon') as typeof import('../../src/util/vsccommon');

nodeModule._load = originalLoad;
delete require.cache[require.resolve('../../src/util/vsccommon')];

describe('vscode configuration helpers', () => {
    it('reads extension settings through WorkspaceConfiguration.get before direct properties', () => {
        const configuration = getConfiguration();

        assert.strictEqual(configuration.previewLocalisation, 'Korean');
        assert.strictEqual(configuration.installPath, 'get-install-path');
        assert.deepStrictEqual(configuration.featureFlags, ['getFlag']);
        assert.strictEqual(getLanguageIdInYml(), 'l_korean');
    });
});
