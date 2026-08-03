import * as vscode from 'vscode';
import * as path from 'path';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getSpriteTypes } from '../hoiformat/spritetype';
import { debounceByInput, forceError, mapWithConcurrency, UserError } from './common';
import { error } from './debug';
import { isGfxIndexEnabled } from './featureflags';
import { getSelectedModRootFolders, listFilesFromModOrHOI4, readFileFromModOrHOI4 } from './fileloader';
import { localize } from './i18n';
import { uniq } from 'lodash';
import { IndexService } from '../services/indexService';
import { ConfigurationKey } from '../constants';

interface GfxIndexItem {
    file: string;
}

const globalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
const dlcGfxIndex: Record<string, GfxIndexItem | undefined> = {};
let workspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};
const gfxIndexBuildConcurrency = 8;

const gfxIndexService = new IndexService<GfxIndexItem>({
    global: {
        build: estimatedSize => buildGlobalGfxIndex(estimatedSize),
        reset: () => {
            for (const key of Object.keys(globalGfxIndex)) {
                delete globalGfxIndex[key];
            }
            for (const key of Object.keys(dlcGfxIndex)) {
                delete dlcGfxIndex[key];
            }
        },
        statusMessage: 'Building GFX index...',
        telemetryEvent: 'gfxIndex',
    },
    workspace: {
        build: estimatedSize => buildWorkspaceGfxIndex(estimatedSize),
        reset: () => {
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
        const disposeModRootWatchers = () => {
            modRootWatchers.forEach(watcher => watcher.dispose());
            modRootWatchers = [];
        };
        const rebuildModRootWatchers = async () => {
            disposeModRootWatchers();
            const roots = await getSelectedModRootFolders();
            modRootWatchers = roots.map(root => createGfxIndexFileWatcher(new vscode.RelativePattern(root, '**/*.gfx')));
        };
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
        disposables.push(createGfxIndexFileWatcher('**/*.gfx'));
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void rebuildModRootWatchers(); }));
        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationKey}.modFile`)) {
                void rebuildModRootWatchers();
            }
        }));
        disposables.push(new vscode.Disposable(disposeModRootWatchers));
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

async function buildGlobalGfxIndex(estimatedSize: [number]): Promise<void> {
    const baseOptions = { mod: false, hoi4: true, dlc: false, recursively: true };
    const dlcOptions = { mod: false, hoi4: false, dlc: true, recursively: true };
    const [baseGfxFiles, dlcGfxFiles] = await Promise.all([
        listFilesFromModOrHOI4('interface', baseOptions),
        listFilesFromModOrHOI4('interface', dlcOptions),
    ]);
    await Promise.all([
        mapWithConcurrency(
            baseGfxFiles.filter(f => f.toLocaleLowerCase().endsWith('.gfx')),
            gfxIndexBuildConcurrency,
            f => fillGfxItems('interface/' + f, globalGfxIndex, baseOptions, estimatedSize),
        ),
        mapWithConcurrency(
            dlcGfxFiles.filter(f => f.toLocaleLowerCase().endsWith('.gfx')),
            gfxIndexBuildConcurrency,
            f => fillGfxItems('interface/' + f, dlcGfxIndex, dlcOptions, estimatedSize),
        ),
    ]);
}

async function buildWorkspaceGfxIndex(estimatedSize: [number]): Promise<void> {
    const options = { mod: true, hoi4: false, dlc: false, recursively: true };
    const gfxFiles = (await listFilesFromModOrHOI4('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx'));
    await mapWithConcurrency(gfxFiles, gfxIndexBuildConcurrency, f =>
        fillGfxItems('interface/' + f, workspaceGfxIndex, options, estimatedSize));
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
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    gfxIndexService.invalidate('workspace');
    void ensureWorkspaceGfxIndexImpl(false);
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    const file = e.document.uri;
    if (file.path.endsWith('.gfx')) {
        onChangeTextDocumentImpl(file);
    }
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        removeWorkspaceGfxIndex(file);
        addWorkspaceGfxIndex(file);
    },
    file => file.toString(),
    50,
    { trailing: true }
);

function onCloseTextDocument(document: vscode.TextDocument) {
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    const file = document.uri;
    if (file.path.endsWith('.gfx')) {
        removeWorkspaceGfxIndex(file);
        addWorkspaceGfxIndex(file);
    }
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    for (const file of e.files) {
        if (file.path.endsWith('.gfx')) {
            addWorkspaceGfxIndex(file);
        }
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    for (const file of e.files) {
        if (file.path.endsWith('.gfx')) {
            removeWorkspaceGfxIndex(file);
        }
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    if (!gfxIndexService.isReady('workspace')) {
        return;
    }
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}

function createGfxIndexFileWatcher(pattern: vscode.GlobPattern): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(onChangeGfxFile),
        watcher.onDidCreate(onCreateGfxFile),
        watcher.onDidDelete(onDeleteGfxFile),
    );
}

function onChangeGfxFile(file: vscode.Uri) {
    if (!gfxIndexService.isReady('workspace') || !file.path.toLowerCase().endsWith('.gfx')) {
        return;
    }

    removeWorkspaceGfxIndex(file);
    addWorkspaceGfxIndex(file);
}

function onCreateGfxFile(file: vscode.Uri) {
    if (!gfxIndexService.isReady('workspace') || !file.path.toLowerCase().endsWith('.gfx')) {
        return;
    }

    addWorkspaceGfxIndex(file);
}

function onDeleteGfxFile(file: vscode.Uri) {
    if (!gfxIndexService.isReady('workspace') || !file.path.toLowerCase().endsWith('.gfx')) {
        return;
    }

    removeWorkspaceGfxIndex(file);
}

function removeWorkspaceGfxIndex(file: vscode.Uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            for (const key in workspaceGfxIndex) {
                if (workspaceGfxIndex[key]?.file === relative) {
                    delete workspaceGfxIndex[key];
                }
            }
        }
    }
}

function addWorkspaceGfxIndex(file: vscode.Uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            void fillGfxItems(relative, workspaceGfxIndex, { mod: true, hoi4: false, dlc: false });
        }
    }
}
