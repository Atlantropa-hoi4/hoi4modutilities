import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const mockWorkspaceFolders: Array<{ uri: { fsPath: string; path: string; scheme: string; toString: () => string } }> = [];
const mockFiles = new Set<string>();
let mockReadDelayMs = 0;

function normalizeMockPath(value: string): string {
    return path.normalize(value).toLowerCase();
}

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            FileType: {
                File: 1,
                Directory: 2,
            },
            Uri: {
                parse: (value: string) => ({ toString: () => value }),
                file: (value: string) => ({ fsPath: value, path: value, scheme: 'file', toString: () => `file:///${value}` }),
                joinPath: (base: { fsPath?: string; path?: string }, ...segments: string[]) => ({
                    fsPath: path.join(base.fsPath ?? base.path ?? '', ...segments),
                    path: path.join(base.path ?? base.fsPath ?? '', ...segments),
                    scheme: 'file',
                    toString: () => `file:///${path.join(base.path ?? base.fsPath ?? '', ...segments)}`,
                }),
            },
            workspace: {
                workspaceFolders: mockWorkspaceFolders,
                textDocuments: [],
                getConfiguration: () => ({
                    installPath: '',
                    loadDlcContents: false,
                    modFile: '',
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
                fs: {
                    stat: async (uri: { fsPath: string }) => {
                        if (!mockFiles.has(normalizeMockPath(uri.fsPath))) {
                            throw new Error(`missing ${uri.fsPath}`);
                        }

                        return { type: 1, mtime: 1 };
                    },
                    readFile: async (uri: { fsPath: string }) => {
                        if (mockReadDelayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, mockReadDelayMs));
                        }

                        return Buffer.from(uri.fsPath);
                    },
                    readDirectory: async () => [],
                },
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    getModRootCandidatePaths,
    isPathCoveredByReplacePath,
    readFileFromModOrHOI4,
} = require('../../src/util/fileloader') as typeof import('../../src/util/fileloader');

describe('fileloader mod root helpers', () => {
    beforeEach(() => {
        mockWorkspaceFolders.length = 0;
        mockFiles.clear();
        mockReadDelayMs = 0;
    });

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

    it('treats replace_path entries as covering their descendants', () => {
        assert.strictEqual(isPathCoveredByReplacePath('common', 'common'), true);
        assert.strictEqual(isPathCoveredByReplacePath('common/national_focus', 'common'), true);
        assert.strictEqual(isPathCoveredByReplacePath('common/national_focus/file.txt', 'common/national_focus'), true);
        assert.strictEqual(isPathCoveredByReplacePath('history/countries', 'common'), false);
    });

    it('releases file read slots after queued reads complete', async () => {
        const root = path.join('C:', 'workspace');
        mockWorkspaceFolders.push({
            uri: {
                fsPath: root,
                path: root,
                scheme: 'file',
                toString: () => `file:///${root}`,
            },
        });
        mockReadDelayMs = 1;

        const relativePaths = Array.from({ length: 13 }, (_, index) => `file-${index}.txt`);
        for (const relativePath of [...relativePaths, 'after-queue.txt']) {
            mockFiles.add(normalizeMockPath(path.join(root, relativePath)));
        }

        await Promise.all(relativePaths.map(relativePath => readFileFromModOrHOI4(relativePath, { hoi4: false })));
        const nextRead = readFileFromModOrHOI4('after-queue.txt', { hoi4: false });

        const result = await Promise.race([
            nextRead,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('read slot was not released')), 250)),
        ]);

        assert.ok(result[0].toString().endsWith('after-queue.txt'));
    });
});
