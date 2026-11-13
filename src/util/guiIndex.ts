import * as vscode from 'vscode';
import { IndexService } from '../services/indexService';
import { isIndexSnapshot } from '../services/indexSerializationProtocol';
import { GuiFile, guiFileSchema, ContainerWindowType } from '../hoiformat/gui';
import { parseHoi4File, resolveScriptVariables } from '../hoiformat/hoiparser';
import { convertNodeToJson, HOIPartial } from '../hoiformat/schema';
import { mapWithConcurrency } from './common';
import { getSelectedModRootFolders, hoiFileExpiryToken, listFilesFromModOrHOI4, readFileFromModOrHOI4, refreshFileContentSource } from './fileloader';
import { LatestGeneration } from './latestUpdate';
import { getSelectedModSourceGeneration, onDidChangeSelectedModSource } from './modfile';
import { error } from './debug';

export type GuiIndexItemType = 'containerwindow' | 'window' | 'scrollbar' | 'extendedscrollbar' | 'position';

export interface GuiIndexItem {
    name: string;
    type: GuiIndexItemType;
}

interface GuiIndexFile {
    file: string;
    token: string;
    items: GuiIndexItem[];
}

export interface GuiIndexSnapshot {
    version: 2;
    files: GuiIndexFile[];
}

let indexedFiles = new Map<string, Array<{ type: GuiIndexItemType; file: string; order: number }>>();
let reusableFiles = new Map<string, GuiIndexFile>();
let sourceGeneration = -1;
const service = new IndexService<GuiIndexSnapshot>({
    gui: {
        cache: { folder: 'interface', extension: '.gui', layer: 'all' },
        validateCacheSnapshot: isGuiIndexSnapshot,
        statusMessage: 'Building GUI index...',
        telemetryEvent: 'guiIndex',
        reset: () => { indexedFiles.clear(); },
        commit: snapshot => {
            const index: typeof indexedFiles = new Map();
            snapshot.files.forEach((row, order) => {
                for (const item of row.items) {
                    const entries = index.get(item.name) ?? [];
                    if (!entries.some(entry => entry.type === item.type)) {
                        entries.push({ type: item.type, file: row.file, order });
                        index.set(item.name, entries);
                    }
                }
            });
            indexedFiles = index;
            reusableFiles = new Map(snapshot.files.map(file => [file.file, file]));
        },
        build: async (size, signal) => {
            // Keep fileloader order: workspace and selected/dependency mods precede DLC and game.
            const paths = (await listFilesFromModOrHOI4('interface', { recursively: true }))
                .filter(file => file.toLowerCase().endsWith('.gui'));
            signal.throwIfAborted();
            const rows = await mapWithConcurrency(paths, 8, async relative => {
                signal.throwIfAborted();
                const file = `interface/${relative}`;
                const token = await hoiFileExpiryToken(file);
                signal.throwIfAborted();
                const cached = reusableFiles.get(file);
                if (cached?.token === token) { return cached; }
                let items: GuiIndexItem[] = [];
                try {
                    const [content] = await readFileFromModOrHOI4(file, { priority: 'background' });
                    signal.throwIfAborted();
                    size[0] += content.length;
                    items = collectGuiIndexItems(convertNodeToJson<GuiFile>(
                        resolveScriptVariables(parseHoi4File(content.toString().replace(/^\uFEFF/, ''))), guiFileSchema));
                } catch {
                    signal.throwIfAborted();
                }
                return { file, token, items };
            });
            signal.throwIfAborted();
            return { version: 2, files: rows };
        },
    },
});

export function isGuiIndexSnapshot(value: unknown): value is GuiIndexSnapshot {
    return isIndexSnapshot(value) && value.version === 2 && Array.isArray(value.files) && value.files.every(file =>
        isIndexSnapshot(file) && typeof file.file === 'string' && file.file.startsWith('interface/')
        && file.file.toLowerCase().endsWith('.gui') && typeof file.token === 'string'
        && Array.isArray(file.items) && file.items.every(item => isIndexSnapshot(item)
            && typeof item.name === 'string' && ['containerwindow', 'window', 'scrollbar', 'extendedscrollbar', 'position'].includes(item.type as string)));
}

export function collectGuiIndexItems(gui: HOIPartial<GuiFile>): GuiIndexItem[] {
    const items: GuiIndexItem[] = [];
    const collectWindows = (window: HOIPartial<ContainerWindowType>, type: 'containerwindow' | 'window') => {
        if (window.name) { items.push({ name: window.name, type }); }
        for (const child of window.containerwindowtype) { collectWindows(child, 'containerwindow'); }
        for (const child of window.windowtype) { collectWindows(child, 'window'); }
    };
    for (const group of gui.guitypes) {
        for (const window of group.containerwindowtype) { collectWindows(window, 'containerwindow'); }
        for (const window of group.windowtype) { collectWindows(window, 'window'); }
        for (const scrollbar of group.scrollbartype) {
            if (scrollbar.name) { items.push({ name: scrollbar.name, type: 'scrollbar' }); }
        }
        for (const scrollbar of group.extendedscrollbartype) {
            if (scrollbar.name) { items.push({ name: scrollbar.name, type: 'extendedscrollbar' }); }
        }
        for (const position of group.positiontype ?? []) {
            if (position.name) { items.push({ name: position.name, type: 'position' }); }
        }
    }
    return items;
}

export async function findGuiFiles(
    names: Iterable<string>,
    types: readonly GuiIndexItemType[] = ['containerwindow', 'window'],
): Promise<string[]> {
    const remaining = new Set(names);
    if (remaining.size === 0) { return []; }
    const generation = getSelectedModSourceGeneration();
    if (sourceGeneration !== generation) {
        invalidateGuiIndex();
        sourceGeneration = generation;
    }
    await service.ensure('gui');
    const result = new Map<string, number>();
    for (const name of remaining) {
        const match = indexedFiles.get(name)?.find(item => types.includes(item.type));
        if (match) { result.set(match.file, match.order); }
    }
    return [...result].sort((a, b) => a[1] - b[1]).map(([file]) => file);
}

export function invalidateGuiIndex(): void {
    service.invalidate('gui');
}

export function registerGuiIndex(): vscode.Disposable {
    const watcherGeneration = new LatestGeneration();
    let rootWatchers: vscode.Disposable[] = [];
    const disposeRootWatchers = () => {
        rootWatchers.forEach(watcher => watcher.dispose());
        rootWatchers = [];
    };
    const changed = (uri: vscode.Uri) => {
        if (/\/interface\/.*\.gui$/i.test(uri.path)) {
            refreshFileContentSource();
            invalidateGuiIndex();
        }
    };
    const watch = (pattern: vscode.GlobPattern) => {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        return vscode.Disposable.from(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    };
    const rebuildRootWatchers = async () => {
        const isCurrent = watcherGeneration.next();
        disposeRootWatchers();
        const roots = await getSelectedModRootFolders();
        if (!isCurrent()) { return; }
        rootWatchers = roots.map(root => watch(new vscode.RelativePattern(root, 'interface/**/*.gui')));
    };
    const rebuildRoots = () => { void rebuildRootWatchers().catch(error); };
    rebuildRoots();
    return vscode.Disposable.from(
        watch('interface/**/*.gui'),
        vscode.workspace.onDidOpenTextDocument(document => changed(document.uri)),
        vscode.workspace.onDidChangeTextDocument(event => changed(event.document.uri)),
        vscode.workspace.onDidCloseTextDocument(document => changed(document.uri)),
        vscode.workspace.onDidCreateFiles(event => event.files.forEach(changed)),
        vscode.workspace.onDidDeleteFiles(event => event.files.forEach(changed)),
        vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => { changed(file.oldUri); changed(file.newUri); })),
        vscode.workspace.onDidChangeWorkspaceFolders(() => { invalidateGuiIndex(); rebuildRoots(); }),
        onDidChangeSelectedModSource(() => { invalidateGuiIndex(); rebuildRoots(); }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('hoi4ModUtilities')) { invalidateGuiIndex(); }
        }),
        new vscode.Disposable(() => {
            watcherGeneration.invalidate();
            disposeRootWatchers();
            service.dispose();
            reusableFiles.clear();
        }),
    );
}
