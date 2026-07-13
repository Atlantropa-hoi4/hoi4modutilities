import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const mockWorkspaceFolders: Array<{ uri: { fsPath: string; path: string; scheme: string; toString: () => string } }> = [];
const mockFiles = new Set<string>();
const mockDirectories = new Set<string>();
const mockReadContents = new Map<string, string>();
const mockReadCounts = new Map<string, number>();
const mockModifiedTimes = new Map<string, number>();
const mockDirectoryEntries = new Map<string, Array<[string, number]>>();
let mockReadDelayMs = 0;
let mockConfigurationModFile = '';
let mockConfigurationLoadDlcContents = false;

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
                parse: (value: string) => {
                    const fsPath = value.startsWith('file:///') ? value.slice('file:///'.length) : value;
                    return {
                        fsPath,
                        path: fsPath,
                        scheme: value.match(/^([^:]+):/)?.[1] ?? 'file',
                        toString: () => value,
                    };
                },
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
                    loadDlcContents: mockConfigurationLoadDlcContents,
                    modFile: mockConfigurationModFile,
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
                fs: {
                    stat: async (uri: { fsPath: string }) => {
                        const normalizedPath = normalizeMockPath(uri.fsPath);
                        const type = mockFiles.has(normalizedPath)
                            ? 1
                            : mockDirectories.has(normalizedPath) ? 2 : undefined;
                        if (type === undefined) {
                            throw new Error(`missing ${uri.fsPath}`);
                        }

                        return { type, mtime: mockModifiedTimes.get(normalizedPath) ?? 1 };
                    },
                    readFile: async (uri: { fsPath: string }) => {
                        if (mockReadDelayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, mockReadDelayMs));
                        }

                        const normalizedPath = normalizeMockPath(uri.fsPath);
                        mockReadCounts.set(normalizedPath, (mockReadCounts.get(normalizedPath) ?? 0) + 1);
                        return Buffer.from(mockReadContents.get(normalizedPath) ?? uri.fsPath);
                    },
                    readDirectory: async (uri: { fsPath: string }) =>
                        mockDirectoryEntries.get(normalizeMockPath(uri.fsPath)) ?? [],
                },
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    clearDlcZipCache,
    getModRootCandidatePaths,
    isPathCoveredByReplacePath,
    listFilesInDlcZipEntries,
    listFilesFromModOrHOI4,
    readFileFromModOrHOI4,
} = require('../../src/util/fileloader') as typeof import('../../src/util/fileloader');

describe('fileloader mod root helpers', () => {
    beforeEach(() => {
        mockWorkspaceFolders.length = 0;
        mockFiles.clear();
        mockDirectories.clear();
        mockReadContents.clear();
        mockReadCounts.clear();
        mockModifiedTimes.clear();
        mockDirectoryEntries.clear();
        mockReadDelayMs = 0;
        mockConfigurationModFile = '';
        mockConfigurationLoadDlcContents = false;
        clearDlcZipCache();
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

    it('prefers DLC files over base files and isolates dlc:false reads', async () => {
        const relativePath = 'common/example.txt';
        const installRoot = 'server.hoi4installpath:/';
        const dlcRoot = path.join(installRoot, 'dlc');
        const dlcFolderName = 'dlc001';
        const dlcFolder = path.join(dlcRoot, dlcFolderName);
        const dlcFile = path.join(dlcFolder, relativePath);
        const baseFile = path.join(installRoot, relativePath);

        mockConfigurationLoadDlcContents = true;
        mockDirectories.add(normalizeMockPath(dlcRoot));
        mockDirectories.add(normalizeMockPath(dlcFolder));
        mockDirectoryEntries.set(normalizeMockPath(dlcRoot), [[dlcFolderName, 2]]);
        mockDirectoryEntries.set(normalizeMockPath(dlcFolder), []);
        mockFiles.add(normalizeMockPath(dlcFile));
        mockFiles.add(normalizeMockPath(baseFile));
        mockReadContents.set(normalizeMockPath(dlcFile), 'dlc');
        mockReadContents.set(normalizeMockPath(baseFile), 'base');

        const [withDlc, withoutDlc] = await Promise.all([
            readFileFromModOrHOI4(relativePath, { mod: false }),
            readFileFromModOrHOI4(relativePath, { mod: false, dlc: false }),
        ]);

        assert.strictEqual(withDlc[0].toString(), 'dlc');
        assert.strictEqual(withDlc[1].fsPath, dlcFile);
        assert.strictEqual(withoutDlc[0].toString(), 'base');
        assert.strictEqual(withoutDlc[1].fsPath, baseFile);

        const dlcOnly = await readFileFromModOrHOI4(relativePath, { mod: false, hoi4: false });
        assert.strictEqual(dlcOnly[0].toString(), 'dlc');
    });

    it('lists DLC files before base files and isolates dlc:false lists', async () => {
        const relativePath = 'common';
        const installRoot = 'server.hoi4installpath:/';
        const dlcRoot = path.join(installRoot, 'dlc');
        const dlcFolderName = 'dlc001';
        const dlcFolder = path.join(dlcRoot, dlcFolderName);
        const dlcContentFolder = path.join(dlcFolder, relativePath);
        const baseContentFolder = path.join(installRoot, relativePath);

        mockConfigurationLoadDlcContents = true;
        for (const directory of [dlcRoot, dlcFolder, dlcContentFolder, baseContentFolder]) {
            mockDirectories.add(normalizeMockPath(directory));
        }
        mockDirectoryEntries.set(normalizeMockPath(dlcRoot), [[dlcFolderName, 2]]);
        mockDirectoryEntries.set(normalizeMockPath(dlcFolder), []);
        mockDirectoryEntries.set(normalizeMockPath(dlcContentFolder), [
            ['dlc-only.txt', 1],
            ['shared.txt', 1],
        ]);
        mockDirectoryEntries.set(normalizeMockPath(baseContentFolder), [
            ['shared.txt', 1],
            ['base-only.txt', 1],
        ]);

        const [withDlc, withoutDlc] = await Promise.all([
            listFilesFromModOrHOI4(relativePath, { mod: false }),
            listFilesFromModOrHOI4(relativePath, { mod: false, dlc: false }),
        ]);

        assert.deepStrictEqual(withDlc, ['dlc-only.txt', 'shared.txt', 'base-only.txt']);
        assert.deepStrictEqual(withoutDlc, ['shared.txt', 'base-only.txt']);
    });

    it('lists recursive DLC ZIP files without requiring explicit directory entries', () => {
        const entries = [
            { entryName: 'interface/root.gfx', isDirectory: false },
            { entryName: 'interface/sub/nested.gfx', isDirectory: false },
            { entryName: 'interface/sub/deeper/second.gfx', isDirectory: false },
            { entryName: 'common/ignored.txt', isDirectory: false },
        ] as any;

        assert.deepStrictEqual(listFilesInDlcZipEntries(entries, 'interface'), ['root.gfx']);
        assert.deepStrictEqual(listFilesInDlcZipEntries(entries, 'interface', true), [
            'root.gfx',
            'sub/nested.gfx',
            'sub/deeper/second.gfx',
        ]);
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

    it('reuses selected mod root resolution across a file read burst', async () => {
        const modFile = path.join('C:', 'mods', 'burst.mod');
        const modRoot = path.join('C:', 'mods', 'burst-content');
        const normalizedModFile = normalizeMockPath(modFile);
        mockConfigurationModFile = modFile;
        mockFiles.add(normalizedModFile);
        mockDirectories.add(normalizeMockPath(modRoot));
        mockReadContents.set(normalizedModFile, `path = "${modRoot.replace(/\\/g, '/')}"`);

        const relativePaths = Array.from({ length: 24 }, (_, index) => `common/file-${index}.txt`);
        for (const relativePath of relativePaths) {
            mockFiles.add(normalizeMockPath(path.join(modRoot, relativePath)));
        }

        await Promise.all(relativePaths.map(relativePath => readFileFromModOrHOI4(relativePath, { hoi4: false })));

        assert.strictEqual(mockReadCounts.get(normalizedModFile), 1);
    });

    it('refreshes selected mod roots after the descriptor changes', async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;

        try {
            const modFile = path.join('C:', 'mods', 'changing.mod');
            const firstModRoot = path.join('C:', 'mods', 'first-content');
            const secondModRoot = path.join('C:', 'mods', 'second-content');
            const normalizedModFile = normalizeMockPath(modFile);
            mockConfigurationModFile = modFile;
            mockFiles.add(normalizedModFile);
            mockDirectories.add(normalizeMockPath(firstModRoot));
            mockReadContents.set(normalizedModFile, `path = "${firstModRoot.replace(/\\/g, '/')}"`);
            mockFiles.add(normalizeMockPath(path.join(firstModRoot, 'first.txt')));

            await readFileFromModOrHOI4('first.txt', { hoi4: false });

            mockDirectories.add(normalizeMockPath(secondModRoot));
            mockReadContents.set(normalizedModFile, `path = "${secondModRoot.replace(/\\/g, '/')}"`);
            mockModifiedTimes.set(normalizedModFile, 2);
            const secondRelativePaths = Array.from({ length: 24 }, (_, index) => `second-${index}.txt`);
            for (const relativePath of secondRelativePaths) {
                mockFiles.add(normalizeMockPath(path.join(secondModRoot, relativePath)));
            }
            now += 5_001;

            const resolvedFiles = await Promise.all(secondRelativePaths.map(relativePath =>
                readFileFromModOrHOI4(relativePath, { hoi4: false })));

            assert.strictEqual(resolvedFiles[0][1].fsPath, path.join(secondModRoot, secondRelativePaths[0]));
            assert.strictEqual(mockReadCounts.get(normalizedModFile), 2);
        } finally {
            Date.now = originalNow;
        }
    });
});
