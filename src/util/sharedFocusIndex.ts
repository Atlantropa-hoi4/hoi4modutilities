import * as vscode from 'vscode';
import * as path from 'path';
import { debounceByInput } from './common';
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from './fileloader';
import { localize } from './i18n';
import { sendEvent } from './telemetry';
import { Logger } from "./logger";
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { sharedFocusIndex } from "./featureflags";
import {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    FocusIndexState,
    removeFocusFileFromIndex,
} from "./sharedFocusIndexState";

export {
    applyFocusFileToIndex,
    createEmptyFocusIndexState,
    findFileByFocusKeyInIndex,
    FocusIndexState,
    removeFocusFileFromIndex,
};

const globalFocusIndex: FocusIndexState = createEmptyFocusIndexState();
let workspaceFocusIndex: FocusIndexState = createEmptyFocusIndexState();
let globalFocusIndexTask: Promise<void> | undefined;
let workspaceFocusIndexTask: Promise<void> | undefined;
let globalFocusIndexReady = false;
let workspaceFocusIndexReady = false;

export function registerSharedFocusIndex(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    if (sharedFocusIndex) {
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
    }

    return vscode.Disposable.from(...disposables);
}

async function buildGlobalFocusIndex(estimatedSize: [number]): Promise<void> {
    const options = { mod: false, hoi4: true, recursively: true };
    const focusFiles = await listFilesFromModOrHOI4('common/national_focus', options);
    await Promise.all(focusFiles.map(f => fillFocusItems('common/national_focus/' + f, globalFocusIndex, options, estimatedSize)));
}

async function buildWorkspaceFocusIndex(estimatedSize: [number]): Promise<void> {
    const options = { mod: true, hoi4: false, recursively: true };
    const focusFiles = await listFilesFromModOrHOI4('common/national_focus', options);
    await Promise.all(focusFiles.map(f => fillFocusItems('common/national_focus/' + f, workspaceFocusIndex, options, estimatedSize)));
}

function ensureGlobalFocusIndex(): Promise<void> {
    return ensureGlobalFocusIndexImpl(true);
}

function ensureGlobalFocusIndexImpl(showStatusBar: boolean): Promise<void> {
    if (globalFocusIndexReady) {
        return Promise.resolve();
    }
    if (globalFocusIndexTask) {
        return globalFocusIndexTask;
    }

    const estimatedSize: [number] = [0];
    const buildTask = buildGlobalFocusIndex(estimatedSize);
    if (showStatusBar) {
        vscode.window.setStatusBarMessage('$(loading~spin) ' + localize('sharedFocusIndex.building', 'Building Shared Focus index...'), buildTask);
    }
    globalFocusIndexTask = buildTask.then(() => {
        globalFocusIndexReady = true;
        sendEvent('sharedFocusIndex', { size: estimatedSize[0].toString() });
    }).finally(() => {
        globalFocusIndexTask = undefined;
    });
    return globalFocusIndexTask;
}

function ensureWorkspaceFocusIndex(): Promise<void> {
    return ensureWorkspaceFocusIndexImpl(true);
}

function ensureWorkspaceFocusIndexImpl(showStatusBar: boolean): Promise<void> {
    if (workspaceFocusIndexReady) {
        return Promise.resolve();
    }
    if (workspaceFocusIndexTask) {
        return workspaceFocusIndexTask;
    }

    const estimatedSize: [number] = [0];
    const buildTask = buildWorkspaceFocusIndex(estimatedSize);
    if (showStatusBar) {
        vscode.window.setStatusBarMessage('$(loading~spin) ' + localize('sharedFocusIndex.workspace.building', 'Building workspace Focus index...'), buildTask);
    }
    workspaceFocusIndexTask = buildTask.then(() => {
        workspaceFocusIndexReady = true;
        sendEvent('sharedFocusIndex.workspace', { size: estimatedSize[0].toString() });
    }).finally(() => {
        workspaceFocusIndexTask = undefined;
    });
    return workspaceFocusIndexTask;
}

export async function prewarmSharedFocusIndex(): Promise<void> {
    if (!sharedFocusIndex) {
        return;
    }

    await Promise.all([
        ensureGlobalFocusIndexImpl(false),
        ensureWorkspaceFocusIndexImpl(false),
    ]);
}

async function fillFocusItems(
    focusFile: string,
    focusIndex: FocusIndexState,
    options: { mod?: boolean; hoi4?: boolean },
    estimatedSize?: [number],
): Promise<void> {
    const [fileBuffer, uri] = await readFileFromModOrHOI4(focusFile, options);
    const fileContent = fileBuffer.toString();

    if (!fileContent.includes('focus_tree')
        && !fileContent.includes('shared_focus')
        && !fileContent.includes('joint_focus')) {
        removeFocusFileFromIndex(focusIndex, focusFile);
        return;
    }

    try {
        applyFocusFileToIndex(
            focusIndex,
            focusFile,
            extractFocusIds(parseHoi4File(fileContent, localize('infile', 'In file {0}:\n', focusFile))),
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
    return findFileByFocusKeyInIndex(workspaceFocusIndex, key) ?? findFileByFocusKeyInIndex(globalFocusIndex, key);
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    workspaceFocusIndex = createEmptyFocusIndexState();
    workspaceFocusIndexReady = false;
    void ensureWorkspaceFocusIndex();
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    const file = e.document.uri;
    if (file.path.endsWith('.txt')) {
        onChangeTextDocumentImpl(file);
    }
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        removeWorkspaceFocusIndex(file);
        addWorkspaceFocusIndex(file);
    },
    file => file.toString(),
    1000,
    { trailing: true }
);

function onCloseTextDocument(document: vscode.TextDocument) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    const file = document.uri;
    if (file.path.endsWith('.txt')) {
        removeWorkspaceFocusIndex(file);
        addWorkspaceFocusIndex(file);
    }
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    for (const file of e.files) {
        if (file.path.endsWith('.txt')) {
            addWorkspaceFocusIndex(file);
        }
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    for (const file of e.files) {
        if (file.path.endsWith('.txt')) {
            removeWorkspaceFocusIndex(file);
        }
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    if (!workspaceFocusIndexReady) {
        return;
    }
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}

function removeWorkspaceFocusIndex(file: vscode.Uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('common/national_focus/')) {
            removeFocusFileFromIndex(workspaceFocusIndex, relative);
        }
    }
}

function addWorkspaceFocusIndex(file: vscode.Uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('common/national_focus/')) {
            fillFocusItems(relative, workspaceFocusIndex, { hoi4: false });
        }
    }
}
