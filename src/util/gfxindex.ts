import * as vscode from 'vscode';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getSpriteTypes } from '../hoiformat/spritetype';
import { debounceByInput, forceError, mapWithConcurrency, UserError } from './common';
import { error } from './debug';
import { isGfxIndexEnabled } from './featureflags';
import { getFilePathFromMod, getSelectedModRootFolders, listFilesFromModOrHOI4, readFileFromModOrHOI4, refreshFileContentSource } from './fileloader';
import { localize } from './i18n';
import { uniq } from 'lodash';
import { IndexService } from '../services/indexService';
import { ConfigurationKey } from '../constants';
import { LatestGeneration, LatestUpdateCoordinator } from './latestUpdate';
import { getRelativePathWithinRoot } from './nodecommon';
import { onDidChangeSelectedModSource } from './modfile';

interface GfxIndexItem {
    file: string;
}

interface GfxIndexSnapshot {
    index: Record<string, GfxIndexItem | undefined>;
    dlcIndex?: Record<string, GfxIndexItem | undefined>;
}

let globalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
let dlcGfxIndex: Record<string, GfxIndexItem | undefined> = {};
let workspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};
const workspaceGfxUpdates = new LatestUpdateCoordinator<string>();
const gfxIndexBuildConcurrency = 8;

const gfxIndexService = new IndexService<GfxIndexSnapshot>({
    global: {
        build: estimatedSize => buildGlobalGfxIndex(estimatedSize),
        commit: snapshot => {
            globalGfxIndex = snapshot.index;
            dlcGfxIndex = snapshot.dlcIndex ?? {};
        },
        reset: () => {
            globalGfxIndex = {};
            dlcGfxIndex = {};
        },
        statusMessage: 'Building GFX index...',
        telemetryEvent: 'gfxIndex',
    },
    workspace: {
        build: estimatedSize => buildWorkspaceGfxIndex(estimatedSize),
        commit: snapshot => {
            workspaceGfxUpdates.invalidateAll();
            workspaceGfxIndex = snapshot.index;
        },
        reset: () => {
            workspaceGfxUpdates.invalidateAll();
            workspaceGfxIndex = {};
        },
        statusMessage: 'Building workspace GFX index...',
        telemetryEvent: 'gfxIndex.workspace',
    },
});

export function registerGfxIndex(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    if (isGfxIndexEnabled()) {
        let modRootWatchers: vscode.Disposable[] = [];
        const modRootWatcherGeneration = new LatestGeneration();
        const disposeModRootWatchers = () => {
            modRootWatchers.forEach(watcher => watcher.dispose());
            modRootWatchers = [];
        };
        const rebuildModRootWatchers = async () => {
            const isCurrent = modRootWatcherGeneration.next();
            disposeModRootWatchers();
            const roots = await getSelectedModRootFolders();
            if (!isCurrent()) {
                return;
            }
            const nextWatchers = roots.map(root =>
                createGfxIndexFileWatcher(
                    new vscode.RelativePattern(root, '**/*.gfx'),
                    root,
                    isCurrent,
                ));
            disposeModRootWatchers();
            modRootWatchers = nextWatchers;
        };
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
        disposables.push(createGfxIndexFileWatcher('**/*.gfx'));
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void rebuildModRootWatchers(); }));
        disposables.push(onDidChangeSelectedModSource(() => {
            rebuildActiveGfxIndex('workspace');
            void rebuildModRootWatchers();
        }));
        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationKey}.installPath`)
                || e.affectsConfiguration(`${ConfigurationKey}.loadDlcContents`)) {
                rebuildActiveGfxIndex('global');
            }
        }));
        disposables.push(new vscode.Disposable(() => {
            modRootWatcherGeneration.invalidate();
            disposeModRootWatchers();
        }));
        void rebuildModRootWatchers();
    }

    return vscode.Disposable.from(...disposables);
}

export async function getGfxContainerFile(gfxName: string | undefined): Promise<string | undefined> {
    if (!isGfxIndexEnabled() || !gfxName) {
        return undefined;
    }

    await Promise.all([ensureGlobalGfxIndex(), ensureWorkspaceGfxIndex()]);
    return tryGetGfxContainerFile(gfxName);
}

export function tryGetGfxContainerFile(gfxName: string | undefined): string | undefined {
    if (!isGfxIndexEnabled() || !gfxName) {
        return undefined;
    }

    return workspaceGfxIndex[gfxName]?.file ?? dlcGfxIndex[gfxName]?.file ?? globalGfxIndex[gfxName]?.file;
}

export async function getGfxContainerFiles(gfxNames: (string | undefined)[]): Promise<string[]> {
    return uniq((await Promise.all(gfxNames.map(getGfxContainerFile))).filter((v): v is string => v !== undefined));
}

async function buildGlobalGfxIndex(estimatedSize: [number]): Promise<GfxIndexSnapshot> {
    const baseOptions = { mod: false, hoi4: true, dlc: false, recursively: true };
    const dlcOptions = { mod: false, hoi4: false, dlc: true, recursively: true };
    const rebuiltGlobalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
    const rebuiltDlcGfxIndex: Record<string, GfxIndexItem | undefined> = {};
    const [baseGfxFiles, dlcGfxFiles] = await Promise.all([
        listFilesFromModOrHOI4('interface', baseOptions),
        listFilesFromModOrHOI4('interface', dlcOptions),
    ]);
    await Promise.all([
        mapWithConcurrency(
            baseGfxFiles.filter(f => f.toLocaleLowerCase().endsWith('.gfx')),
            gfxIndexBuildConcurrency,
            f => fillGfxItems('interface/' + f, rebuiltGlobalGfxIndex, baseOptions, estimatedSize),
        ),
        mapWithConcurrency(
            dlcGfxFiles.filter(f => f.toLocaleLowerCase().endsWith('.gfx')),
            gfxIndexBuildConcurrency,
            f => fillGfxItems('interface/' + f, rebuiltDlcGfxIndex, dlcOptions, estimatedSize),
        ),
    ]);
    return { index: rebuiltGlobalGfxIndex, dlcIndex: rebuiltDlcGfxIndex };
}

async function buildWorkspaceGfxIndex(estimatedSize: [number]): Promise<GfxIndexSnapshot> {
    const options = { mod: true, hoi4: false, dlc: false, recursively: true };
    const rebuiltWorkspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};
    const gfxFiles = (await listFilesFromModOrHOI4('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx'));
    await mapWithConcurrency(gfxFiles, gfxIndexBuildConcurrency, f =>
        fillGfxItems('interface/' + f, rebuiltWorkspaceGfxIndex, options, estimatedSize));
    return { index: rebuiltWorkspaceGfxIndex };
}

function ensureGlobalGfxIndex(): Promise<void> {
    return ensureGlobalGfxIndexImpl(true);
}

function ensureGlobalGfxIndexImpl(showStatusBar: boolean): Promise<void> {
    return gfxIndexService.ensure('global', { showStatusBar });
}

function ensureWorkspaceGfxIndex(): Promise<void> {
    return ensureWorkspaceGfxIndexImpl(true);
}

function ensureWorkspaceGfxIndexImpl(showStatusBar: boolean): Promise<void> {
    return gfxIndexService.ensure('workspace', { showStatusBar });
}

export async function prewarmGfxIndex(): Promise<void> {
    if (!isGfxIndexEnabled()) {
        return;
    }

    await Promise.all([
        ensureGlobalGfxIndexImpl(false),
        ensureWorkspaceGfxIndexImpl(false),
    ]);
}

export function isGfxIndexReady(): boolean {
    return !isGfxIndexEnabled()
        || (gfxIndexService.isReady('global') && gfxIndexService.isReady('workspace'));
}

async function fillGfxItems(gfxFile: string, gfxIndex: Record<string, GfxIndexItem | undefined>, options: { mod?: boolean, hoi4?: boolean, dlc?: boolean }, estimatedSize?: [number]): Promise<void> {
    try {
        if (estimatedSize) {
            estimatedSize[0] += gfxFile.length;
        }
        const [fileBuffer, uri] = await readFileFromModOrHOI4(gfxFile, options);
        const spriteTypes = getSpriteTypes(parseHoi4File(fileBuffer.toString(), localize('infile', 'In file {0}:\n', uri.toString())));
        for (const spriteType of spriteTypes) {
            gfxIndex[spriteType.name] = { file: gfxFile };
            if (estimatedSize) {
                estimatedSize[0] += spriteType.name.length + 8;
            }
        }
    } catch(e) {
        error(new UserError(forceError(e).toString()));
    }
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
    if (!gfxIndexService.isActive('workspace')) {
        return;
    }
    rebuildActiveGfxIndex('workspace');
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    const file = e.document.uri;
    if (!file.path.endsWith('.gfx') || !getWorkspaceGfxRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }
    onChangeTextDocumentImpl(file);
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        if (prepareWorkspaceGfxIncrementalUpdate()) {
            replaceWorkspaceGfxIndex(file);
        }
    },
    file => file.toString(),
    50,
    { trailing: true }
);

function onCloseTextDocument(document: vscode.TextDocument) {
    const file = document.uri;
    if (!file.path.endsWith('.gfx') || !getWorkspaceGfxRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }
    replaceWorkspaceGfxIndex(file);
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    const files = e.files.filter(file =>
        file.path.endsWith('.gfx') && getWorkspaceGfxRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceGfxIndex(file);
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    const files = e.files.filter(file =>
        file.path.endsWith('.gfx') && getWorkspaceGfxRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceGfxIndex(file);
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    if (!e.files.some(file =>
        (file.oldUri.path.endsWith('.gfx') && getWorkspaceGfxRelativePath(file.oldUri) !== undefined)
        || (file.newUri.path.endsWith('.gfx') && getWorkspaceGfxRelativePath(file.newUri) !== undefined))) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}

function createGfxIndexFileWatcher(
    pattern: vscode.GlobPattern,
    root?: vscode.Uri,
    isCurrent: () => boolean = () => true,
): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(file => {
            if (isCurrent()) {
                onChangeGfxFile(file, root);
            }
        }),
        watcher.onDidCreate(file => {
            if (isCurrent()) {
                onCreateGfxFile(file, root);
            }
        }),
        watcher.onDidDelete(file => {
            if (isCurrent()) {
                onDeleteGfxFile(file, root);
            }
        }),
    );
}

function onChangeGfxFile(file: vscode.Uri, root?: vscode.Uri) {
    if (!file.path.toLowerCase().endsWith('.gfx') || !getWorkspaceGfxRelativePath(file, root)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }

    replaceWorkspaceGfxIndex(file, root);
}

function onCreateGfxFile(file: vscode.Uri, root?: vscode.Uri) {
    if (!file.path.toLowerCase().endsWith('.gfx') || !getWorkspaceGfxRelativePath(file, root)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }

    replaceWorkspaceGfxIndex(file, root);
}

function onDeleteGfxFile(file: vscode.Uri, root?: vscode.Uri) {
    if (!file.path.toLowerCase().endsWith('.gfx') || !getWorkspaceGfxRelativePath(file, root)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceGfxIncrementalUpdate()) {
        return;
    }

    replaceWorkspaceGfxIndex(file, root);
}

function replaceWorkspaceGfxIndex(file: vscode.Uri, root?: vscode.Uri): void {
    const relative = getWorkspaceGfxRelativePath(file, root);
    if (!relative) {
        return;
    }

    void workspaceGfxUpdates.update(relative, async () => {
        const fileIndex: Record<string, GfxIndexItem | undefined> = {};
        if (await getFilePathFromMod(relative)) {
            await fillGfxItems(relative, fileIndex, { mod: true, hoi4: false, dlc: false });
        }
        return fileIndex;
    }, fileIndex => {
        removeGfxFileFromIndex(workspaceGfxIndex, relative);
        Object.assign(workspaceGfxIndex, fileIndex);
    });
}

function getWorkspaceGfxRelativePath(file: vscode.Uri, root?: vscode.Uri): string | undefined {
    const baseUri = root ?? vscode.workspace.getWorkspaceFolder(file)?.uri;
    if (baseUri) {
        return getRelativePathWithinRoot(baseUri.path, file.path, 'interface');
    }
    return undefined;
}

function removeGfxFileFromIndex(index: Record<string, GfxIndexItem | undefined>, relative: string): void {
    for (const key in index) {
        if (index[key]?.file === relative) {
            delete index[key];
        }
    }
}

function rebuildActiveGfxIndex(targetId: 'global' | 'workspace'): void {
    gfxIndexService.rebuildIfActive(targetId, { showStatusBar: false });
}

function prepareWorkspaceGfxIncrementalUpdate(): boolean {
    if (gfxIndexService.isReady('workspace')) {
        return true;
    }
    rebuildActiveGfxIndex('workspace');
    return false;
}
