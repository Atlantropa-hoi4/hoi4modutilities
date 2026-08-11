import * as vscode from 'vscode';
import { debounceByInput, mapWithConcurrency } from './common';
import {
    getFilePathFromMod,
    getSelectedModRootFolders,
    listFilesFromModOrHOI4,
    readFileFromModOrHOI4,
    refreshFileContentSource,
} from './fileloader';
import { localize } from './i18n';
import { Logger } from "./logger";
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { isSharedFocusIndexEnabled } from "./featureflags";
import {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    findFileByFocusKeyInLayeredIndexes,
    FocusIndexState,
    removeFocusFileFromIndex,
} from "./sharedFocusIndexState";
import { IndexService } from '../services/indexService';
import { LatestGeneration, LatestUpdateCoordinator } from './latestUpdate';
import { ConfigurationKey } from '../constants';
import { getRelativePathWithinRoot } from './nodecommon';
import { onDidChangeSelectedModSource } from './modfile';

export {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    findFileByFocusKeyInLayeredIndexes,
    FocusIndexState,
    removeFocusFileFromIndex,
};

interface FocusIndexSnapshot {
    index: FocusIndexState;
    dlcIndex?: FocusIndexState;
}

let globalFocusIndex: FocusIndexState = createEmptyFocusIndexState();
let dlcFocusIndex: FocusIndexState = createEmptyFocusIndexState();
let workspaceFocusIndex: FocusIndexState = createEmptyFocusIndexState();
const workspaceFocusUpdates = new LatestUpdateCoordinator<string>();
const sharedFocusIndexBuildConcurrency = 8;
const sharedFocusIndexService = new IndexService<FocusIndexSnapshot>({
    global: {
        build: estimatedSize => buildGlobalFocusIndex(estimatedSize),
        commit: snapshot => {
            globalFocusIndex = snapshot.index;
            dlcFocusIndex = snapshot.dlcIndex ?? createEmptyFocusIndexState();
        },
        reset: () => {
            globalFocusIndex = createEmptyFocusIndexState();
            dlcFocusIndex = createEmptyFocusIndexState();
        },
        statusMessage: 'Building Shared Focus index...',
        telemetryEvent: 'sharedFocusIndex',
    },
    workspace: {
        build: estimatedSize => buildWorkspaceFocusIndex(estimatedSize),
        commit: snapshot => {
            workspaceFocusUpdates.invalidateAll();
            workspaceFocusIndex = snapshot.index;
        },
        reset: () => {
            workspaceFocusUpdates.invalidateAll();
            workspaceFocusIndex = createEmptyFocusIndexState();
        },
        statusMessage: 'Building workspace Focus index...',
        telemetryEvent: 'sharedFocusIndex.workspace',
    },
});

export function registerSharedFocusIndex(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    if (isSharedFocusIndexEnabled()) {
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
            modRootWatchers = roots.map(root => createFocusIndexFileWatcher(
                new vscode.RelativePattern(root, 'common/national_focus/**/*.txt'),
                root,
                isCurrent,
            ));
        };
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
        disposables.push(createFocusIndexFileWatcher('common/national_focus/**/*.txt'));
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void rebuildModRootWatchers(); }));
        disposables.push(onDidChangeSelectedModSource(() => {
            rebuildActiveFocusIndex('workspace');
            void rebuildModRootWatchers();
        }));
        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            onChangeIndexConfiguration(e);
        }));
        disposables.push(new vscode.Disposable(() => {
            modRootWatcherGeneration.invalidate();
            disposeModRootWatchers();
        }));
        void rebuildModRootWatchers();
    }

    return vscode.Disposable.from(...disposables);
}

async function buildGlobalFocusIndex(estimatedSize: [number]): Promise<FocusIndexSnapshot> {
    const baseOptions = { mod: false, hoi4: true, dlc: false, recursively: true };
    const dlcOptions = { mod: false, hoi4: false, dlc: true, recursively: true };
    const rebuiltGlobalFocusIndex = createEmptyFocusIndexState();
    const rebuiltDlcFocusIndex = createEmptyFocusIndexState();
    const [baseFocusFiles, dlcFocusFiles] = await Promise.all([
        listFilesFromModOrHOI4('common/national_focus', baseOptions),
        listFilesFromModOrHOI4('common/national_focus', dlcOptions),
    ]);
    await Promise.all([
        mapWithConcurrency(baseFocusFiles, sharedFocusIndexBuildConcurrency, f =>
            fillFocusItems('common/national_focus/' + f, rebuiltGlobalFocusIndex, baseOptions, estimatedSize)),
        mapWithConcurrency(dlcFocusFiles, sharedFocusIndexBuildConcurrency, f =>
            fillFocusItems('common/national_focus/' + f, rebuiltDlcFocusIndex, dlcOptions, estimatedSize)),
    ]);
    return { index: rebuiltGlobalFocusIndex, dlcIndex: rebuiltDlcFocusIndex };
}

async function buildWorkspaceFocusIndex(estimatedSize: [number]): Promise<FocusIndexSnapshot> {
    const options = { mod: true, hoi4: false, dlc: false, recursively: true };
    const rebuiltWorkspaceFocusIndex = createEmptyFocusIndexState();
    const focusFiles = await listFilesFromModOrHOI4('common/national_focus', options);
    await mapWithConcurrency(focusFiles, sharedFocusIndexBuildConcurrency, f =>
        fillFocusItems('common/national_focus/' + f, rebuiltWorkspaceFocusIndex, options, estimatedSize));
    return { index: rebuiltWorkspaceFocusIndex };
}

function ensureGlobalFocusIndex(): Promise<void> {
    return ensureGlobalFocusIndexImpl(true);
}

function ensureGlobalFocusIndexImpl(showStatusBar: boolean): Promise<void> {
    return sharedFocusIndexService.ensure('global', { showStatusBar });
}

function ensureWorkspaceFocusIndex(): Promise<void> {
    return ensureWorkspaceFocusIndexImpl(true);
}

function ensureWorkspaceFocusIndexImpl(showStatusBar: boolean): Promise<void> {
    return sharedFocusIndexService.ensure('workspace', { showStatusBar });
}

export async function prewarmSharedFocusIndex(): Promise<void> {
    if (!isSharedFocusIndexEnabled()) {
        return;
    }

    await Promise.all([
        ensureGlobalFocusIndexImpl(false),
        ensureWorkspaceFocusIndexImpl(false),
    ]);
}

export function isSharedFocusIndexReady(): boolean {
    return !isSharedFocusIndexEnabled()
        || (sharedFocusIndexService.isReady('global') && sharedFocusIndexService.isReady('workspace'));
}

export function tryFindFileByFocusKey(key: string): string | undefined {
    if (!isSharedFocusIndexReady()) {
        return undefined;
    }

    return findFileByFocusKeyInLayeredIndexes([workspaceFocusIndex, dlcFocusIndex, globalFocusIndex], key);
}

async function fillFocusItems(
    focusFile: string,
    focusIndex: FocusIndexState,
    options: { mod?: boolean; hoi4?: boolean; dlc?: boolean },
    estimatedSize?: [number],
): Promise<void> {
    try {
        const [fileBuffer] = await readFileFromModOrHOI4(focusFile, options);
        const fileContent = fileBuffer.toString();

        if (!fileContent.includes('focus_tree')
            && !fileContent.includes('shared_focus')
            && !fileContent.includes('joint_focus')) {
            removeFocusFileFromIndex(focusIndex, focusFile);
            return;
        }

        applyFocusFileToIndex(
            focusIndex,
            focusFile,
            extractFocusIds(parseHoi4File(fileContent, localize('infile', 'In file {0}:\n', focusFile), { keepTokens: false })),
        );

        if (estimatedSize) {
            estimatedSize[0] += fileBuffer.length;
        }
    } catch (e) {
        const baseMessage = options.hoi4
            ? localize('sharedFocusIndex.vanilla', '[Vanilla]')
            : localize('sharedFocusIndex.mod', '[Mod]');

        const failureMessage = localize('sharedFocusIndex.parseFailure', 'Parsing failed! Please check if the file has issues!');
        if (e instanceof Error) {
            Logger.error(`${baseMessage} ${focusFile} ${failureMessage}\n${e.stack}`);
        }
    }
}

// Function to find the file name containing the specified focus key
export async function findFileByFocusKey(key: string): Promise<string | undefined> {
    await Promise.all([ensureGlobalFocusIndex(), ensureWorkspaceFocusIndex()]);
    return tryFindFileByFocusKey(key);
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
    if (!sharedFocusIndexService.isActive('workspace')) {
        return;
    }
    rebuildActiveFocusIndex('workspace');
}

function onChangeIndexConfiguration(e: vscode.ConfigurationChangeEvent): void {
    if (e.affectsConfiguration(`${ConfigurationKey}.installPath`)
        || e.affectsConfiguration(`${ConfigurationKey}.loadDlcContents`)) {
        rebuildActiveFocusIndex('global');
    }
}

function rebuildActiveFocusIndex(targetId: 'global' | 'workspace'): void {
    sharedFocusIndexService.rebuildIfActive(targetId, { showStatusBar: false });
}

function prepareWorkspaceFocusIncrementalUpdate(): boolean {
    if (sharedFocusIndexService.isReady('workspace')) {
        return true;
    }
    rebuildActiveFocusIndex('workspace');
    return false;
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    const file = e.document.uri;
    if (!getWorkspaceFocusRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceFocusIncrementalUpdate()) {
        return;
    }
    onChangeTextDocumentImpl(file);
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        if (prepareWorkspaceFocusIncrementalUpdate()) {
            replaceWorkspaceFocusIndex(file);
        }
    },
    file => file.toString(),
    1000,
    { trailing: true }
);

function onCloseTextDocument(document: vscode.TextDocument) {
    const file = document.uri;
    if (!getWorkspaceFocusRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceFocusIncrementalUpdate()) {
        return;
    }
    replaceWorkspaceFocusIndex(file);
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    const files = e.files.filter(file => getWorkspaceFocusRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceFocusIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceFocusIndex(file);
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    const files = e.files.filter(file => getWorkspaceFocusRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceFocusIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceFocusIndex(file);
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}

function createFocusIndexFileWatcher(
    pattern: vscode.GlobPattern,
    root?: vscode.Uri,
    isCurrent: () => boolean = () => true,
): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = (file: vscode.Uri) => {
        if (!isCurrent() || !getWorkspaceFocusRelativePath(file, root)) {
            return;
        }
        refreshFileContentSource();
        if (prepareWorkspaceFocusIncrementalUpdate()) {
            replaceWorkspaceFocusIndex(file, root);
        }
    };
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(onChange),
        watcher.onDidCreate(onChange),
        watcher.onDidDelete(onChange),
    );
}

function replaceWorkspaceFocusIndex(file: vscode.Uri, root?: vscode.Uri): void {
    const relative = getWorkspaceFocusRelativePath(file, root);
    if (!relative) {
        return;
    }

    void workspaceFocusUpdates.update(relative, async () => {
        const fileIndex = createEmptyFocusIndexState();
        if (await getFilePathFromMod(relative)) {
            await fillFocusItems(relative, fileIndex, { mod: true, hoi4: false, dlc: false });
        }
        return fileIndex;
    }, fileIndex => {
        applyFocusFileToIndex(workspaceFocusIndex, relative, fileIndex.byFile[relative] ?? []);
    });
}

function getWorkspaceFocusRelativePath(file: vscode.Uri, root?: vscode.Uri): string | undefined {
    const baseUri = root ?? vscode.workspace.getWorkspaceFolder(file)?.uri;
    if (baseUri) {
        return getRelativePathWithinRoot(baseUri.path, file.path, 'common/national_focus');
    }
    return undefined;
}
