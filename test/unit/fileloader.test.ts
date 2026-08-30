import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
delete require.cache[require.resolve('../../src/util/fileloader')];
delete require.cache[require.resolve('../../src/util/modfile')];
delete require.cache[require.resolve('../../src/util/vsccommon')];
const moduleCacheBeforeMock = new Set(Object.keys(require.cache));
const mockWorkspaceFolders: Array<{ uri: { fsPath: string; path: string; scheme: string; toString: () => string } }> = [];
const mockFiles = new Set<string>();
const mockDirectories = new Set<string>();
const mockReadContents = new Map<string, string>();
const mockReadCounts = new Map<string, number>();
const mockDirectoryReadCounts = new Map<string, number>();
const mockModifiedTimes = new Map<string, number>();
const mockDirectoryEntries = new Map<string, Array<[string, number]>>();
let mockReadDelayMs = 0;
let mockDirectoryReadDelayMs = 0;
let mockConfigurationModFile = '';
let mockConfigurationLoadDlcContents = false;
let mockConfigurationInstallPath = '';

function normalizeMockPath(value: string): string {
    return path.normalize(value).toLowerCase();
}

function createMockUri(value: string) {
    return {
        fsPath: value,
        path: value,
        scheme: 'file',
        toString: () => `file:///${value}`,
    };
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
                    installPath: mockConfigurationInstallPath,
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
                        const normalizedPath = normalizeMockPath(uri.fsPath);
                        const content = mockReadContents.get(normalizedPath) ?? uri.fsPath;
                        mockReadCounts.set(normalizedPath, (mockReadCounts.get(normalizedPath) ?? 0) + 1);
                        if (mockReadDelayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, mockReadDelayMs));
                        }

                        return Buffer.from(content);
                    },
                    readDirectory: async (uri: { fsPath: string }) => {
                        const normalizedPath = normalizeMockPath(uri.fsPath);
                        const entries = [...(mockDirectoryEntries.get(normalizedPath) ?? [])];
                        mockDirectoryReadCounts.set(
                            normalizedPath,
                            (mockDirectoryReadCounts.get(normalizedPath) ?? 0) + 1,
                        );
                        if (mockDirectoryReadDelayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, mockDirectoryReadDelayMs));
                        }
                        return entries;
                    },
                },
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    clearDlcZipCache,
    createFileLoaderCacheKey,
    createSelectedModSourceCacheKey,
    getModRootCandidatePaths,
    isPathCoveredByReplacePath,
    listFilesInDlcZipEntries,
    listFilesFromModOrHOI4,
    readFileFromModOrHOI4,
    refreshFileContentSource,
} = require('../../src/util/fileloader') as typeof import('../../src/util/fileloader');
const {
    refreshSelectedModSource,
} = require('../../src/util/modfile') as typeof import('../../src/util/modfile');
nodeModule._load = originalLoad;
for (const moduleId of Object.keys(require.cache)) {
    if (!moduleCacheBeforeMock.has(moduleId) && moduleId.includes(`${path.sep}src${path.sep}`)) {
        delete require.cache[moduleId];
    }
}

describe('fileloader mod root helpers', () => {
    beforeEach(() => {
        mockWorkspaceFolders.length = 0;
        mockFiles.clear();
        mockDirectories.clear();
        mockReadContents.clear();
        mockReadCounts.clear();
        mockDirectoryReadCounts.clear();
        mockModifiedTimes.clear();
        mockDirectoryEntries.clear();
        mockReadDelayMs = 0;
        mockDirectoryReadDelayMs = 0;
        mockConfigurationModFile = '';
        mockConfigurationLoadDlcContents = false;
        mockConfigurationInstallPath = '';
        clearDlcZipCache();
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

    it('loads files from launcher-declared dependency mods after the selected mod', async () => {
        const registryRoot = path.join('C:', 'hoi4-user', 'mod');
        const selectedModFile = path.join(registryRoot, 'selected.mod');
        const selectedModRoot = path.join('C:', 'workshop', 'selected-content');
        const dependencyModFile = path.join(registryRoot, 'dependency.mod');
        const dependencyModRoot = path.join('C:', 'workshop', 'dependency-content');
        const relativePath = 'interface/dependency-colors.gfx';
        const dependencyInterfaceRoot = path.join(dependencyModRoot, 'interface');

        mockConfigurationModFile = selectedModFile;
        for (const file of [selectedModFile, dependencyModFile, path.join(dependencyModRoot, relativePath)]) {
            mockFiles.add(normalizeMockPath(file));
        }
        for (const directory of [registryRoot, selectedModRoot, dependencyModRoot, dependencyInterfaceRoot]) {
            mockDirectories.add(normalizeMockPath(directory));
        }
        mockDirectoryEntries.set(normalizeMockPath(registryRoot), [
            ['selected.mod', 1],
            ['dependency.mod', 1],
        ]);
        mockDirectoryEntries.set(normalizeMockPath(dependencyInterfaceRoot), [
            ['dependency-colors.gfx', 1],
        ]);
        mockReadContents.set(normalizeMockPath(selectedModFile), [
            'name = "Selected Mod"',
            `path = "${selectedModRoot.replace(/\\/g, '/')}"`,
            'dependencies = { "External Icons" }',
        ].join('\n'));
        mockReadContents.set(normalizeMockPath(dependencyModFile), [
            'name = "External Icons"',
            `path = "${dependencyModRoot.replace(/\\/g, '/')}"`,
        ].join('\n'));
        mockReadContents.set(normalizeMockPath(path.join(dependencyModRoot, relativePath)), 'dependency-icon');

        const resolved = await readFileFromModOrHOI4(relativePath, { hoi4: false });
        const listed = await listFilesFromModOrHOI4('interface', {
            recursively: true,
            hoi4: false,
            dlc: false,
        });

        assert.strictEqual(resolved[0].toString(), 'dependency-icon');
        assert.strictEqual(resolved[1].fsPath, path.join(dependencyModRoot, relativePath));
        assert.deepStrictEqual(listed, ['dependency-colors.gfx']);
    });

    it('keeps selected mod files ahead of dependency mod files', async () => {
        const registryRoot = path.join('C:', 'hoi4-user', 'mod');
        const selectedModFile = path.join(registryRoot, 'priority-selected.mod');
        const selectedModRoot = path.join(registryRoot, 'priority-selected-content');
        const dependencyModFile = path.join(registryRoot, 'priority-dependency.mod');
        const dependencyModRoot = path.join(registryRoot, 'priority-dependency-content');
        const relativePath = 'interface/focus-icons.gfx';
        const selectedFile = path.join(selectedModRoot, relativePath);
        const dependencyFile = path.join(dependencyModRoot, relativePath);

        mockConfigurationModFile = selectedModFile;
        for (const file of [selectedModFile, dependencyModFile, selectedFile, dependencyFile]) {
            mockFiles.add(normalizeMockPath(file));
        }
        for (const directory of [registryRoot, selectedModRoot, dependencyModRoot]) {
            mockDirectories.add(normalizeMockPath(directory));
        }
        mockDirectoryEntries.set(normalizeMockPath(registryRoot), [
            ['priority-selected.mod', 1],
            ['priority-dependency.mod', 1],
        ]);
        mockReadContents.set(normalizeMockPath(selectedModFile), [
            `path = "${selectedModRoot.replace(/\\/g, '/')}"`,
            'dependencies = { "External Icons" }',
        ].join('\n'));
        mockReadContents.set(normalizeMockPath(dependencyModFile), [
            'name = "External Icons"',
            `path = "${dependencyModRoot.replace(/\\/g, '/')}"`,
        ].join('\n'));
        mockReadContents.set(normalizeMockPath(selectedFile), 'selected');
        mockReadContents.set(normalizeMockPath(dependencyFile), 'dependency');

        const resolved = await readFileFromModOrHOI4(relativePath, { hoi4: false });

        assert.strictEqual(resolved[0].toString(), 'selected');
        assert.strictEqual(resolved[1].fsPath, selectedFile);
    });

    it('treats replace_path entries as covering their descendants', () => {
        assert.strictEqual(isPathCoveredByReplacePath('common', 'common'), true);
        assert.strictEqual(isPathCoveredByReplacePath('common/national_focus', 'common'), true);
        assert.strictEqual(isPathCoveredByReplacePath('common/national_focus/file.txt', 'common/national_focus'), true);
        assert.strictEqual(isPathCoveredByReplacePath('history/countries', 'common'), false);
    });

    it('separates in-flight reads when their configured content source changes', () => {
        const initial = createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: true, dlc: true });

        mockConfigurationInstallPath = 'C:\\hoi4-new';
        assert.notStrictEqual(createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: true, dlc: true }), initial);
        mockConfigurationInstallPath = '';

        mockConfigurationLoadDlcContents = true;
        assert.notStrictEqual(createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: true, dlc: true }), initial);
        mockConfigurationLoadDlcContents = false;

        mockConfigurationModFile = 'C:\\mods\\new.mod';
        assert.notStrictEqual(createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: true, dlc: true }), initial);
        mockConfigurationModFile = '';

        mockWorkspaceFolders.push({ uri: createMockUri('C:\\workspace-new') });
        assert.notStrictEqual(createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: true, dlc: true }), initial);
    });

    it('includes the selected-mod source generation in loader and root cache keys', () => {
        const initialLoaderKey = createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: false });
        const firstRootKey = createSelectedModSourceCacheKey('file:///C:/mods/source.mod');

        refreshSelectedModSource();

        assert.notStrictEqual(
            createFileLoaderCacheKey('events/test.txt', { mod: true, hoi4: false }),
            initialLoaderKey,
        );
        assert.notStrictEqual(
            createSelectedModSourceCacheKey('file:///C:/mods/source.mod'),
            firstRootKey,
        );
    });

    it('does not reuse an in-flight file read after the content source generation changes', async () => {
        const root = path.join('C:', 'workspace-content-read');
        const relativePath = 'common/changing.txt';
        const absolutePath = path.join(root, relativePath);
        const normalizedPath = normalizeMockPath(absolutePath);
        mockWorkspaceFolders.push({ uri: createMockUri(root) });
        mockConfigurationModFile = path.join('C:', 'missing.mod');
        mockFiles.add(normalizedPath);
        mockReadContents.set(normalizedPath, 'old');
        mockReadDelayMs = 20;

        const oldRead = readFileFromModOrHOI4(relativePath, { hoi4: false });
        await waitForCount(mockReadCounts, normalizedPath, 1);
        mockReadContents.set(normalizedPath, 'new');
        refreshFileContentSource();
        const newRead = readFileFromModOrHOI4(relativePath, { hoi4: false });

        const [oldResult, newResult] = await Promise.all([oldRead, newRead]);
        assert.strictEqual(oldResult[0].toString(), 'old');
        assert.strictEqual(newResult[0].toString(), 'new');
        assert.strictEqual(mockReadCounts.get(normalizedPath), 2);
    });

    it('does not reuse an in-flight file list after the content source generation changes', async () => {
        const root = path.join('C:', 'workspace-content-list');
        const relativePath = 'common';
        const absolutePath = path.join(root, relativePath);
        const normalizedPath = normalizeMockPath(absolutePath);
        mockWorkspaceFolders.push({ uri: createMockUri(root) });
        mockConfigurationModFile = path.join('C:', 'missing.mod');
        mockDirectories.add(normalizedPath);
        mockDirectoryEntries.set(normalizedPath, [['old.txt', 1]]);
        mockDirectoryReadDelayMs = 20;

        const oldList = listFilesFromModOrHOI4(relativePath, { hoi4: false });
        await waitForCount(mockDirectoryReadCounts, normalizedPath, 1);
        mockDirectoryEntries.set(normalizedPath, [['new.txt', 1]]);
        refreshFileContentSource();
        const newList = listFilesFromModOrHOI4(relativePath, { hoi4: false });

        const [oldResult, newResult] = await Promise.all([oldList, newList]);
        assert.deepStrictEqual(oldResult, ['old.txt']);
        assert.deepStrictEqual(newResult, ['new.txt']);
        assert.strictEqual(mockDirectoryReadCounts.get(normalizedPath), 2);
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

    it('refreshes selected roots immediately when the descriptor source generation changes', async () => {
        const modFile = path.join('C:', 'mods', 'generation-changing.mod');
        const firstModRoot = path.join('C:', 'mods', 'generation-first');
        const secondModRoot = path.join('C:', 'mods', 'generation-second');
        const normalizedModFile = normalizeMockPath(modFile);
        mockConfigurationModFile = modFile;
        mockFiles.add(normalizedModFile);
        mockDirectories.add(normalizeMockPath(firstModRoot));
        mockReadContents.set(normalizedModFile, `path = "${firstModRoot.replace(/\\/g, '/')}"`);
        mockFiles.add(normalizeMockPath(path.join(firstModRoot, 'first.txt')));

        await readFileFromModOrHOI4('first.txt', { hoi4: false });

        mockDirectories.add(normalizeMockPath(secondModRoot));
        mockReadContents.set(normalizedModFile, `path = "${secondModRoot.replace(/\\/g, '/')}"`);
        mockFiles.add(normalizeMockPath(path.join(secondModRoot, 'second.txt')));
        refreshSelectedModSource();

        const resolved = await readFileFromModOrHOI4('second.txt', { hoi4: false });
        assert.strictEqual(resolved[1].fsPath, path.join(secondModRoot, 'second.txt'));
        assert.strictEqual(mockReadCounts.get(normalizedModFile), 2);
    });

    it('does not reuse replace_path data after the descriptor generation changes', async () => {
        const modFile = path.join('C:', 'mods', 'replace-changing.mod');
        const modRoot = path.join('C:', 'mods', 'replace-content');
        const relativePath = 'common/base-only.txt';
        const baseFile = path.join('server.hoi4installpath:/', relativePath);
        const normalizedModFile = normalizeMockPath(modFile);
        mockConfigurationModFile = modFile;
        mockFiles.add(normalizedModFile);
        mockDirectories.add(normalizeMockPath(modRoot));
        mockFiles.add(normalizeMockPath(baseFile));
        mockReadContents.set(normalizedModFile, [
            `path = "${modRoot.replace(/\\/g, '/')}"`,
            'replace_path = "common"',
        ].join('\n'));

        await assert.rejects(
            readFileFromModOrHOI4(relativePath),
            /Can't find file/,
        );

        mockReadContents.set(normalizedModFile, `path = "${modRoot.replace(/\\/g, '/')}"`);
        refreshSelectedModSource();

        const resolved = await readFileFromModOrHOI4(relativePath);
        assert.strictEqual(resolved[1].fsPath, baseFile);
    });
});

async function waitForCount(
    counts: Map<string, number>,
    key: string,
    expected: number,
): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((counts.get(key) ?? 0) >= expected) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.fail(`Timed out waiting for ${key} read count ${expected}`);
}
