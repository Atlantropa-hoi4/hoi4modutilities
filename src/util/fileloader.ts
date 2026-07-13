import * as vscode from 'vscode';
import * as path from 'path';
import { PromiseCache } from './cache';
import { isSamePath } from './nodecommon';
import { getLastModifiedAsync, readDirFiles, isFile, isDirectory, readFile, readDir, isSameUri, fileOrUriStringToUri, ensureFileScheme, readDirFilesRecursively } from './vsccommon';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { localize } from './i18n';
import { convertNodeToJson, SchemaDef, HOIPartial } from '../hoiformat/schema';
import { error } from './debug';
import { updateSelectedModFileStatus, workspaceModFilesCache } from './modfile';
import { getConfiguration, getDocumentByUri } from './vsccommon';
import { UserError } from './common';
import type * as AdmZip from 'adm-zip';
import { Hoi4FsSchema } from '../constants';
import { trimStart } from 'lodash';
import { incrementPerfCounter, measureAsync, recordPerf } from './perf';

const dlcZipPathsCache = new PromiseCache({
    factory: getDlcZipPaths,
    life: 10 * 60 * 1000,
});

const dlcPathsCache = new PromiseCache({
    factory: getDlcPaths,
    life: 10 * 60 * 1000,
});

let dlcZipCache: PromiseCache<AdmZip> | null = null;
const readFileFromModOrHOI4InFlight = new Map<string, Promise<[Buffer, vscode.Uri]>>();
const listFilesFromModOrHOI4InFlight = new Map<string, Promise<string[]>>();
const fileReadConcurrencyLimit = 12;
let activeFileReadCount = 0;
const queuedFileReads: Array<() => void> = [];
const selectedModRootCacheFreshnessMs = 5 * 1000;

interface SelectedModRootCacheEntry {
    candidates: vscode.Uri[];
    roots: vscode.Uri[];
}

const selectedModRootFoldersCache = new PromiseCache<SelectedModRootCacheEntry>({
    name: 'selectedModRoots',
    factory: getSelectedModRootFoldersFromModFile,
    expireWhenChange: getSelectedModRootFoldersExpiryToken,
    life: 60 * 1000,
    nonExpireLife: selectedModRootCacheFreshnessMs,
});
const selectedModRootFoldersInFlight = new Map<string, Promise<SelectedModRootCacheEntry>>();

interface FileLoaderOptions {
    mod?: boolean;
    hoi4?: boolean;
    dlc?: boolean;
}

interface ListFilesOptions extends FileLoaderOptions {
    recursively?: boolean;
}

type DlcZipEntry = Pick<AdmZip.IZipEntry, 'entryName' | 'isDirectory'>;

export function listFilesInDlcZipEntries(
    entries: readonly DlcZipEntry[],
    relativePath: string,
    recursively: boolean = false,
): string[] {
    const normalizedFolder = relativePath.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
    const folderPrefix = normalizedFolder ? normalizedFolder + '/' : '';
    const result: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory) {
            continue;
        }

        const entryName = entry.entryName.replace(/\\+/g, '/').replace(/^\/+/, '');
        if (!entryName.startsWith(folderPrefix)) {
            continue;
        }

        const relativeEntryName = entryName.slice(folderPrefix.length);
        if (!relativeEntryName || (!recursively && relativeEntryName.includes('/'))) {
            continue;
        }

        result.push(recursively ? relativeEntryName : relativeEntryName.split('/').pop()!);
    }

    return result;
}

function getDlcZip(dlcZipPath: string): Promise<AdmZip> {
    const uri = vscode.Uri.parse(dlcZipPath);
    if (uri.scheme === Hoi4FsSchema) {
        dlcZipPath = path.join(getConfiguration().installPath, trimStart(uri.path, '/'));
    } else {
        ensureFileScheme(uri);
        dlcZipPath = uri.fsPath;
    }

    const AdmZip = require('adm-zip');
    return Promise.resolve(new AdmZip(dlcZipPath));
}

dlcZipCache = new PromiseCache({
    factory: getDlcZip,
    expireWhenChange: key => getLastModifiedAsync(vscode.Uri.parse(key)),
    life: 15 * 1000,
    maxSize: 8,
});

export function clearDlcZipCache(): void {
    dlcPathsCache.clear();
    dlcZipPathsCache.clear();
    dlcZipCache?.clear();
}

export function getFilePathFromMod(relativePath: string): Promise<vscode.Uri | undefined> {
    return getFilePathFromModOrHOI4(relativePath, { hoi4: false, dlc: false });
}

export async function getFilePathFromModOrHOI4(
    relativePath: string,
    options?: FileLoaderOptions,
): Promise<vscode.Uri | undefined> {
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    let absolutePath: vscode.Uri | undefined = undefined;

    if (options?.mod !== false) {
        // Find in opened workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                if (await isFile(findPath)) {
                    absolutePath = findPath;
                    break;
                }
            }
            
            if (absolutePath !== undefined) {
                // Opened document
                const document = vscode.workspace.textDocuments.find(d => isSameUri(d.uri, absolutePath!));
                if (document) {
                    return document.uri.with({ fragment: ':opened' });
                }
            }
        }

        if (absolutePath !== undefined) {
            return absolutePath;
        }

        for (const modRoot of await getSelectedModRootFolders()) {
            const findPath = vscode.Uri.joinPath(modRoot, relativePath);
            if (await isFile(findPath)) {
                absolutePath = findPath;
                break;
            }
        }

        if (absolutePath !== undefined) {
            return absolutePath;
        }

        const replacePaths = await getReplacePaths();
        if (replacePaths) {
            const relativePathDir = path.dirname(relativePath);
            for (const replacePath of replacePaths) {
                if (isPathCoveredByReplacePath(relativePathDir, replacePath)) {
                    return absolutePath;
                }
            }
        }
    }

    const installPath = vscode.Uri.parse(Hoi4FsSchema + ':/');
    const conf = getConfiguration();
    if (options?.dlc !== false && conf.loadDlcContents) {
        // Find in HOI4 DLCs
        const dlcs = await dlcZipPathsCache.get(installPath.toString());
        if (dlcs !== null && dlcZipCache !== null) {
            for (const dlc of dlcs) {
                const dlcZip = await dlcZipCache.get(dlc.toString());
                const entry = dlcZip.getEntry(relativePath);
                if (entry !== null) {
                    return dlc.with({ fragment: relativePath });
                }
            }
        }

        const dlcFolders = await dlcPathsCache.get(installPath.toString());
        if (dlcFolders !== null) {
            for (const dlc of dlcFolders) {
                const findPath = vscode.Uri.joinPath(dlc, relativePath);
                if (await isFile(findPath)) {
                    return findPath;
                }
            }
        }
    }

    if (options?.hoi4 !== false) {
        // Find in HOI4 install path
        const findPath = vscode.Uri.joinPath(installPath, relativePath);
        if (await isFile(findPath)) {
            absolutePath = findPath;
        }
    }

    return absolutePath;
}

export function isHoiFileOpened(path: vscode.Uri): boolean {
    return path.fragment === ':opened';
}

export function getHoiOpenedFileOriginalUri(path: vscode.Uri): vscode.Uri {
    return path.with({ fragment: '' });
}

export function isHoiFileFromDlc(path: vscode.Uri): boolean {
    return path.fragment !== '' && path.path.endsWith('.zip');
}

export function getHoiDlcFileOriginalUri(path: vscode.Uri): { uri: vscode.Uri, entryPath: string } {
    return { uri: path.with({ fragment: '' }), entryPath: path.fragment };
}

export async function hoiFileExpiryToken(relativePath: string): Promise<string> {
    return await expiryToken(await getFilePathFromModOrHOI4(relativePath));;
}

export async function expiryToken(realPath: vscode.Uri | undefined): Promise<string> {
    if (!realPath) {
        return '';
    }

    if (isHoiFileOpened(realPath)) {
        return realPath.toString() + '@' + Date.now();
    } else if (isHoiFileFromDlc(realPath)) {
        return realPath.with({ fragment: '' }).toString() + '@' + await getLastModifiedAsync(realPath);
    }

    return realPath.toString() + '@' + await getLastModifiedAsync(realPath);
}

export async function readFileFromPath(realPath: vscode.Uri, relativePath?: string): Promise<[Buffer, vscode.Uri]> {
    if (isHoiFileOpened(realPath)) {
        const realPathWithoutOpenMark = getHoiOpenedFileOriginalUri(realPath);
        const document = getDocumentByUri(realPathWithoutOpenMark);
        if (document) {
            return [Buffer.from(document.getText()), realPath];
        }

        realPath = realPathWithoutOpenMark;

    } else if (realPath.fragment !== '' && realPath.path.endsWith('.zip')) {
        if (dlcZipCache !== null) {
            const { uri: dlc, entryPath: filePath } = getHoiDlcFileOriginalUri(realPath);

            const dlcZip = await dlcZipCache.get(dlc.toString());
            const entry = dlcZip.getEntry(filePath);
            if (entry !== null) {
                return [await new Promise<Buffer>(resolve => entry.getDataAsync(resolve)), realPath];
            }
        }

        throw new UserError("Can't find file " + relativePath);
    }

    return [ await readFile(realPath), realPath ];
}

export async function readFileFromModOrHOI4(
    relativePath: string,
    options?: FileLoaderOptions,
): Promise<[Buffer, vscode.Uri]> {
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    const inFlightKey = createFileLoaderCacheKey(relativePath, options);
    const inFlight = readFileFromModOrHOI4InFlight.get(inFlightKey);
    if (inFlight) {
        incrementPerfCounter('fileloader.read.inflightHit', {
            path: relativePath,
            mod: options?.mod,
            hoi4: options?.hoi4,
            dlc: options?.dlc,
        });
        return inFlight;
    }

    const tags = { path: relativePath, mod: options?.mod, hoi4: options?.hoi4, dlc: options?.dlc };
    const promise = measureAsync('fileloader.read', tags, () => runFileReadWithConcurrency(tags, async () => {
        const realPath = await getFilePathFromModOrHOI4(relativePath, options);

        if (!realPath) {
            throw new UserError("Can't find file " + relativePath);
        }

        return await readFileFromPath(realPath, relativePath);
    })).finally(() => {
        readFileFromModOrHOI4InFlight.delete(inFlightKey);
    });
    readFileFromModOrHOI4InFlight.set(inFlightKey, promise);
    return promise;
}

export async function readFileFromModOrHOI4AsJson<T>(relativePath: string, schema: SchemaDef<T>): Promise<HOIPartial<T>> {
    const [buffer, realPath] = await readFileFromModOrHOI4(relativePath);
    const nodes = parseHoi4File(buffer.toString(), localize('infile', 'In file {0}:\n', realPath));
    return convertNodeToJson<T>(nodes, schema);
}

export async function listFilesFromModOrHOI4(
    relativePath: string,
    options?: ListFilesOptions,
): Promise<string[]> {
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    const inFlightKey = createFileLoaderCacheKey(relativePath, options);
    const inFlight = listFilesFromModOrHOI4InFlight.get(inFlightKey);
    if (inFlight) {
        incrementPerfCounter('fileloader.list.inflightHit', {
            path: relativePath,
            mod: options?.mod,
            hoi4: options?.hoi4,
            dlc: options?.dlc,
            recursively: options?.recursively,
        });
        return inFlight;
    }

    const promise = measureAsync('fileloader.list', {
        path: relativePath,
        mod: options?.mod,
        hoi4: options?.hoi4,
        dlc: options?.dlc,
        recursively: options?.recursively,
    }, async () => {
        const readFunction = options?.recursively ? readDirFilesRecursively : readDirFiles;
        const result: string[] = [];

        if (options?.mod !== false) {
            // Find in opened workspace folders
            if (vscode.workspace.workspaceFolders) {
                for (const folder of vscode.workspace.workspaceFolders) {
                    const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                    if (await isDirectory(findPath)) {
                        try {
                            result.push(...await readFunction(findPath));
                        } catch(e) {}
                    }
                }
            }

            for (const modRoot of await getSelectedModRootFolders()) {
                const findPath = vscode.Uri.joinPath(modRoot, relativePath);
                if (await isDirectory(findPath)) {
                    try {
                        result.push(...await readFunction(findPath));
                    } catch(e) {}
                }
            }

            const replacePaths = await getReplacePaths();
            if (replacePaths) {
                for (const replacePath of replacePaths) {
                    if (isPathCoveredByReplacePath(relativePath, replacePath)) {
                        return result.filter((v, i, a) => i === a.indexOf(v));
                    }
                }
            }
        }

        const installPath = vscode.Uri.parse(Hoi4FsSchema + ':/');
        const conf = getConfiguration();
        if (options?.dlc !== false && conf.loadDlcContents) {
            // Find in HOI4 DLCs
            const dlcs = await dlcZipPathsCache.get(installPath.toString());
            if (dlcs !== null && dlcZipCache !== null) {
                for (const dlc of dlcs) {
                    const dlcZip = await dlcZipCache.get(dlc.toString());
                    result.push(...listFilesInDlcZipEntries(dlcZip.getEntries(), relativePath, options?.recursively));
                }
            }

            const dlcFolders = await dlcPathsCache.get(installPath.toString());
            if (dlcFolders !== null) {
                for (const dlc of dlcFolders) {
                    const findPath = vscode.Uri.joinPath(dlc, relativePath);
                    if (await isDirectory(findPath)) {
                        try {
                            result.push(...await readFunction(findPath));
                        } catch(e) {}
                    }
                }
            }
        }

        if (options?.hoi4 !== false) {
            // Find in HOI4 install path
            const findPath = vscode.Uri.joinPath(installPath, relativePath);
            if (await isDirectory(findPath)) {
                try {
                    result.push(...await readFunction(findPath));
                } catch(e) {}
            }
        }

        return result.filter((v, i, a) => i === a.indexOf(v));
    }).finally(() => {
        listFilesFromModOrHOI4InFlight.delete(inFlightKey);
    });
    listFilesFromModOrHOI4InFlight.set(inFlightKey, promise);
    return promise;
}

function createFileLoaderCacheKey(relativePath: string, options?: ListFilesOptions): string {
    return JSON.stringify({
        relativePath,
        mod: options?.mod,
        hoi4: options?.hoi4,
        dlc: options?.dlc,
        recursively: options?.recursively,
    });
}

async function runFileReadWithConcurrency<T>(
    tags: { path: string; mod?: boolean; hoi4?: boolean; dlc?: boolean },
    task: () => Promise<T>,
): Promise<T> {
    const waitStart = Date.now();
    if (activeFileReadCount >= fileReadConcurrencyLimit) {
        incrementPerfCounter('fileloader.read.queued', tags);
        await new Promise<void>(resolve => queuedFileReads.push(resolve));
    } else {
        activeFileReadCount += 1;
    }

    const waitDurationMs = Date.now() - waitStart;
    if (waitDurationMs > 0) {
        recordPerf('fileloader.read.wait', waitDurationMs, tags);
    }

    try {
        return await task();
    } finally {
        const nextQueuedRead = queuedFileReads.shift();
        if (nextQueuedRead) {
            nextQueuedRead();
        } else {
            activeFileReadCount -= 1;
        }
    }
}

async function getDlcZipPaths(installPath: string): Promise<vscode.Uri[] | null> {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await isDirectory(dlcPath)) {
        return null;
    }

    const dlcFolders = await readDir(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await isDirectory(dlcZipFolder)) {
            const files =  await readDir(dlcZipFolder);
            const zipFile = files.find(file => file.endsWith('.zip'));
            if (zipFile) {
                return vscode.Uri.joinPath(dlcZipFolder, zipFile);
            }
        }

        return null;
    }));

    return paths.filter((path): path is vscode.Uri => path !== null);
}

async function getDlcPaths(installPath: string): Promise<vscode.Uri[] | null> {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await isDirectory(dlcPath)) {
        return null;
    }

    const dlcFolders = await readDir(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await isDirectory(dlcZipFolder) && dlcFolder.startsWith("dlc")) {
            return dlcZipFolder;
        }

        return null;
    }));

    return paths.filter((path): path is vscode.Uri => path !== null);
}

const replacePathsCache = new PromiseCache({
    factory: getReplacePathsFromModFile,
    expireWhenChange: key => getLastModifiedAsync(vscode.Uri.parse(key)),
    life: 60 * 1000,
});

interface ModFile {
    path?: string;
    replace_path: string[];
}

const modFileSchema: SchemaDef<ModFile> = {
    path: "string",
    replace_path: {
        _innerType: "string",
        _type: "array",
    },
};

async function getSelectedModFile(): Promise<vscode.Uri | undefined> {
    const conf = getConfiguration();
    let modFile = fileOrUriStringToUri(conf.modFile);

    if (conf.modFile === "") {
        if (vscode.workspace.workspaceFolders) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const workspaceFolderPath = workspaceFolder.uri;
                const mods = await workspaceModFilesCache.get(workspaceFolderPath.toString());
                if (mods.length > 0) {
                    modFile = mods[0];
                    break;
                }
            }
        }
    }

    return modFile;
}

async function getReplacePaths(): Promise<string[] | undefined> {
    const modFile = await getSelectedModFile();

    try {
        if (modFile && await isFile(modFile)) {
            const result = await replacePathsCache.get(modFile.toString());
            updateSelectedModFileStatus(modFile);
            return result;
        }
    } catch (e) {
        error(e);
    }

    updateSelectedModFileStatus(modFile, true);
    return undefined;
}

export async function getSelectedModRootFolders(): Promise<vscode.Uri[]> {
    const modFile = await getSelectedModFile();
    if (!modFile || !await isFile(modFile)) {
        return [];
    }

    const entry = await getCachedSelectedModRootFolders(modFile.toString());
    return [...entry.roots];
}

function getCachedSelectedModRootFolders(absolutePath: string): Promise<SelectedModRootCacheEntry> {
    const inFlight = selectedModRootFoldersInFlight.get(absolutePath);
    if (inFlight) {
        incrementPerfCounter('fileloader.modRoots.inflightHit');
        return inFlight;
    }

    const request = selectedModRootFoldersCache.get(absolutePath).finally(() => {
        if (selectedModRootFoldersInFlight.get(absolutePath) === request) {
            selectedModRootFoldersInFlight.delete(absolutePath);
        }
    });
    selectedModRootFoldersInFlight.set(absolutePath, request);
    return request;
}

async function getSelectedModRootFoldersFromModFile(absolutePath: string): Promise<SelectedModRootCacheEntry> {
    const modFile = vscode.Uri.parse(absolutePath);

    let descriptorPath: string | undefined;
    try {
        const content = (await readFile(modFile)).toString();
        const node = parseHoi4File(content, localize('infile', 'In file {0}:\n', modFile));
        descriptorPath = convertNodeToJson<ModFile>(node, modFileSchema).path;
    } catch (e) {
        error(e);
    }

    const candidates = getModRootCandidatePaths(modFile.fsPath, descriptorPath).map(candidate => vscode.Uri.file(candidate));
    const roots: vscode.Uri[] = [];
    for (const uri of candidates) {
        if (await isDirectory(uri) && roots.every(root => !isSameUri(root, uri))) {
            roots.push(uri);
        }
    }

    return { candidates, roots };
}

async function getSelectedModRootFoldersExpiryToken(
    absolutePath: string,
    cachedEntry: Promise<SelectedModRootCacheEntry>,
): Promise<string> {
    const entry = await cachedEntry;
    const [descriptorModifiedAt, ...candidateDirectoryStates] = await Promise.all([
        getLastModifiedOrMissing(vscode.Uri.parse(absolutePath)),
        ...entry.candidates.map(candidate => isDirectory(candidate)),
    ]);

    return JSON.stringify([descriptorModifiedAt, ...candidateDirectoryStates]);
}

async function getLastModifiedOrMissing(uri: vscode.Uri): Promise<number | undefined> {
    try {
        return await getLastModifiedAsync(uri);
    } catch {
        return undefined;
    }
}

export function getModRootCandidatePaths(modFilePath: string, descriptorPath?: string): string[] {
    const normalizedModFilePath = path.normalize(modFilePath);
    const modFileDirectory = path.dirname(normalizedModFilePath);
    const candidates: string[] = [];
    const addCandidate = (candidate: string | undefined) => {
        if (candidate && !candidates.some(existing => isSamePath(existing, candidate))) {
            candidates.push(candidate);
        }
    };

    if (path.basename(normalizedModFilePath).toLowerCase() === 'descriptor.mod') {
        addCandidate(modFileDirectory);
    }

    if (descriptorPath) {
        const normalizedDescriptorPath = descriptorPath.split(/[\\/]+/).join(path.sep);
        if (path.isAbsolute(normalizedDescriptorPath)) {
            addCandidate(normalizedDescriptorPath);
        } else {
            addCandidate(path.resolve(modFileDirectory, normalizedDescriptorPath));
            addCandidate(path.resolve(path.dirname(modFileDirectory), normalizedDescriptorPath));
        }
    }

    addCandidate(modFileDirectory);
    return candidates;
}

export function isPathCoveredByReplacePath(relativePath: string, replacePath: string): boolean {
    const normalizedRelativePath = path.resolve(path.normalize(relativePath));
    const normalizedReplacePath = path.resolve(path.normalize(replacePath));
    const relativeToReplacePath = path.relative(normalizedReplacePath, normalizedRelativePath);
    return relativeToReplacePath === ''
        || (!!relativeToReplacePath
            && !relativeToReplacePath.startsWith('..')
            && !path.isAbsolute(relativeToReplacePath));
}

async function getReplacePathsFromModFile(absolutePath: string): Promise<string[]> {
    const content = (await readFile(vscode.Uri.parse(absolutePath))).toString();
    const node = parseHoi4File(content, localize('infile', 'In file {0}:\n', absolutePath));
    const modFile = convertNodeToJson<ModFile>(node, modFileSchema);
    return modFile.replace_path.filter((v): v is string => typeof v === 'string');
}
