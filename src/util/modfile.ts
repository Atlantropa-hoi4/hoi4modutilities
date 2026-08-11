import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationKey, Commands } from '../constants';
import { PromiseCache } from './cache';
import { localize } from './i18n';
import { basename, fileOrUriStringToUri, getConfiguration, uriToFilePathWhenPossible } from './vsccommon';
import { isFile, readDir } from './vsccommon';
import { getRelativePathWithinRoot, isSamePath } from './nodecommon';

export const modFileStatusContainer: { current: vscode.StatusBarItem | null } = {
    current: null,
};

export const workspaceModFilesCache = new PromiseCache({
    factory: getWorkspaceModFiles,
    life: 10 * 1000,
});
let modFileStatusCheckGeneration = 0;
let selectedModSourceGeneration = 0;
const selectedModSourceChangeListeners = new Set<(generation: number) => void>();

export const onDidChangeSelectedModSource: vscode.Event<number> = (listener, thisArgs, disposables) => {
    const wrappedListener = thisArgs === undefined
        ? listener
        : (generation: number) => listener.call(thisArgs, generation);
    selectedModSourceChangeListeners.add(wrappedListener);
    const disposable: vscode.Disposable = {
        dispose: () => selectedModSourceChangeListeners.delete(wrappedListener),
    };
    disposables?.push(disposable);
    return disposable;
};

export function getSelectedModSourceGeneration(): number {
    return selectedModSourceGeneration;
}

export function refreshSelectedModSource(): number {
    workspaceModFilesCache.clear();
    const generation = ++selectedModSourceGeneration;
    for (const listener of [...selectedModSourceChangeListeners]) {
        listener(generation);
    }
    return generation;
}

export function registerModFile(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    let sourceWatchers: vscode.Disposable[] = [];
    let sourceWatcherGeneration = 0;
    let sourceChangeScheduled = false;
    let scheduledSourceWatcherGeneration = 0;
    let disposed = false;
    const disposeSourceWatchers = () => {
        sourceWatchers.forEach(watcher => watcher.dispose());
        sourceWatchers = [];
    };
    const scheduleSelectedModSourceChange = () => {
        if (disposed) {
            return;
        }
        scheduledSourceWatcherGeneration = sourceWatcherGeneration;
        if (sourceChangeScheduled) {
            return;
        }
        sourceChangeScheduled = true;
        queueMicrotask(() => {
            sourceChangeScheduled = false;
            if (!disposed && scheduledSourceWatcherGeneration === sourceWatcherGeneration) {
                refreshSelectedModSource();
            }
        });
    };
    const rebuildSourceWatchers = () => {
        const generation = ++sourceWatcherGeneration;
        disposeSourceWatchers();
        const isCurrent = () => !disposed && generation === sourceWatcherGeneration;
        const configuredModFile = getConfiguration().modFile.trim();
        if (configuredModFile) {
            const modFile = fileOrUriStringToUri(configuredModFile);
            if (modFile) {
                const parent = vscode.Uri.joinPath(modFile, '..');
                sourceWatchers.push(createSelectedModSourceWatcher(
                    new vscode.RelativePattern(parent, '*.mod'),
                    file => isSamePath(file.fsPath, modFile.fsPath),
                    isCurrent,
                    scheduleSelectedModSourceChange,
                ));
            }
        } else {
            sourceWatchers.push(...(vscode.workspace.workspaceFolders ?? []).map(folder =>
                createSelectedModSourceWatcher(
                    new vscode.RelativePattern(folder.uri, '*.mod'),
                    file => isDirectModFileInWorkspaceRoot(folder.uri, file),
                    isCurrent,
                    scheduleSelectedModSourceChange,
                )));
        }
    };
    disposables.push(vscode.commands.registerCommand(Commands.SelectModFile, selectModFile));
    disposables.push(modFileStatusContainer.current = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50));
    disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`${ConfigurationKey}.modFile`)) {
            void checkAndUpdateModFileStatus(fileOrUriStringToUri(getConfiguration().modFile));
            rebuildSourceWatchers();
            scheduleSelectedModSourceChange();
        }
    }));
    disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        rebuildSourceWatchers();
        scheduleSelectedModSourceChange();
    }));
    disposables.push(new vscode.Disposable(() => {
        disposed = true;
        sourceWatcherGeneration += 1;
        disposeSourceWatchers();
        modFileStatusContainer.current = null;
    }));

    // Initial status bar
    void checkAndUpdateModFileStatus(fileOrUriStringToUri(getConfiguration().modFile));
    rebuildSourceWatchers();
    return vscode.Disposable.from(...disposables);
}

export function updateSelectedModFileStatus(modFile: vscode.Uri | undefined, error: boolean = false): void {
    if (modFileStatusContainer.current) {
        const modName = modFileStatusContainer.current;
        if (modFile) {
            const modFileName = basename(modFile, ".mod");
            modName.command = Commands.SelectModFile;
            modName.text = (error ? "$(error) " : "$(file-code) ") + modFileName;
            modName.tooltip = (error ? localize('modfile.errorreading', "Error reading this file: ") : '') + uriToFilePathWhenPossible(modFile);
            modName.show();
        } else {
            modName.command = Commands.SelectModFile;
            modName.text = "$(file-code) " + localize('modfile.nomodfile', '(No mod descriptor)');
            modName.tooltip = localize('modfile.clicktoselect', 'Click to select a mod file...');
            modName.show();
        }
    }
}

async function checkAndUpdateModFileStatus(modFile: vscode.Uri | undefined): Promise<void> {
    const generation = ++modFileStatusCheckGeneration;
    if (modFile === undefined) {
        updateSelectedModFileStatus(undefined);
        return;
    }

    const error = !(await isFile(modFile));
    if (generation !== modFileStatusCheckGeneration) {
        return;
    }

    updateSelectedModFileStatus(modFile, error);
    if (error) {
        vscode.window.showErrorMessage(localize('modfile.filenotexist', 'Mod file not exist: {0}', modFile));
    }
}

async function selectModFile(): Promise<void> {
    const conf = getConfiguration();
    const modFileInspect = conf.inspect<string>('modFile');
    const modsList: (vscode.QuickPickItem & { selectModFile?: true })[] = !modFileInspect?.globalValue ? [] : [{
        label: path.basename(modFileInspect.globalValue, '.mod'),
        description: localize('modfile.globalsetting', 'Global setting'),
        detail: modFileInspect.globalValue
    }];

    let selected = conf.modFile.trim();

    workspaceModFilesCache.clear();
    if (vscode.workspace.workspaceFolders) {
        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            const workspaceFolderPath = workspaceFolder.uri;
            const mods = await workspaceModFilesCache.get(workspaceFolderPath.toString());
            if (selected === '' && mods.length > 0) {
                selected = uriToFilePathWhenPossible(mods[0]);
            }
            modsList.push(...mods.map(mod => ({
                label: basename(mod, '.mod'),
                description: localize('modfile.infolder', 'In folder {0}', basename(workspaceFolderPath)),
                detail: uriToFilePathWhenPossible(mod),
            })));
        }
    }

    modsList.forEach(r => r.detail === selected ? r.picked = true : undefined);
    if (modsList.every(r => !r.picked) && selected !== '') {
        modsList.push({
            label: path.basename(selected, '.mod'),
            description: localize('modfile.workspacesetting', 'Workspace setting'),
            detail: selected,
            picked: true,
        });
    }

    modsList.sort((a, b) => Number(Boolean(b.picked)) - Number(Boolean(a.picked)));

    modsList.push({
        label: localize('modfile.select', 'Browse a .mod file...'),
        selectModFile: true,
    });

    const selectResult = await vscode.window.showQuickPick(modsList, { placeHolder: localize('modfile.selectworkingmod', 'Select working mod') });

    if (selectResult) {
        let modPath = selectResult.detail;
        if (selectResult.selectModFile) {
            const result = await vscode.window.showOpenDialog({ filters: { [localize('modfile.type', 'Mod file')]: ['mod'] } });
            if (result) {
                modPath = uriToFilePathWhenPossible(result[0]);
            } else {
                return;
            }
        }

        if (modPath === modFileInspect?.globalValue) {
            await conf.update('modFile', undefined, vscode.ConfigurationTarget.Workspace);
        } else {
            await conf.update('modFile', modPath, vscode.ConfigurationTarget.Workspace);
        }

        void checkAndUpdateModFileStatus(modPath ? fileOrUriStringToUri(modPath): undefined);
    }
}

async function getWorkspaceModFiles(uriString: string): Promise<vscode.Uri[]> {
    const uri = vscode.Uri.parse(uriString);
    const items = await readDir(uri);
    return items.filter(i => i.endsWith('.mod')).map(i => vscode.Uri.joinPath(uri, i));
}

function createSelectedModSourceWatcher(
    pattern: vscode.GlobPattern,
    isRelevant: (file: vscode.Uri) => boolean,
    isCurrent: () => boolean,
    onChange: () => void,
): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const handleChange = (file: vscode.Uri) => {
        if (isCurrent() && isRelevant(file)) {
            onChange();
        }
    };
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(handleChange),
        watcher.onDidCreate(handleChange),
        watcher.onDidDelete(handleChange),
    );
}

export function isDirectModFileInWorkspaceRoot(root: vscode.Uri, file: vscode.Uri): boolean {
    const relative = getRelativePathWithinRoot(root.fsPath, file.fsPath, '');
    return relative !== undefined
        && !relative.includes('/')
        && relative.toLowerCase().endsWith('.mod');
}
