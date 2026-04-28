import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            Uri: {
                parse: (value: string) => ({ toString: () => value }),
                file: (value: string) => ({ fsPath: value, path: value, scheme: 'file', toString: () => `file:///${value}` }),
                joinPath: (base: { fsPath?: string; path?: string }, ...segments: string[]) => ({
                    fsPath: path.join(base.fsPath ?? base.path ?? '', ...segments),
                    path: path.join(base.path ?? base.fsPath ?? '', ...segments),
                    scheme: 'file',
                }),
            },
            workspace: {
                workspaceFolders: [],
                textDocuments: [],
                getConfiguration: () => ({
                    installPath: '',
                    loadDlcContents: false,
                    modFile: '',
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    getModRootCandidatePaths,
} = require('../../src/util/fileloader') as typeof import('../../src/util/fileloader');

describe('fileloader mod root helpers', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('uses descriptor.mod parent directory as a mod content root', () => {
        const modRoot = path.join('C:', 'Users', 'Administrator', 'Documents', 'Paradox Interactive', 'Hearts of Iron IV', 'mod', 'Kaiserreich-Meowl');
        const candidates = getModRootCandidatePaths(path.join(modRoot, 'descriptor.mod'), 'mod/Kaiserreich-Meowl');

        assert.strictEqual(candidates[0], modRoot);
    });

    it('can resolve launcher .mod paths relative to the HOI4 user data folder', () => {
        const hoi4UserDir = path.join('C:', 'Users', 'Administrator', 'Documents', 'Paradox Interactive', 'Hearts of Iron IV');
        const launcherModFile = path.join(hoi4UserDir, 'mod', 'Kaiserreich-Meowl.mod');
        const candidates = getModRootCandidatePaths(launcherModFile, 'mod/Kaiserreich-Meowl');

        assert.ok(candidates.includes(path.join(hoi4UserDir, 'mod', 'Kaiserreich-Meowl')));
    });
});
