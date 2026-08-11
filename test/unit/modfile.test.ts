import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let configurationModFile = '';
let globalModFile: string | undefined;
let configurationListener: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;
let workspaceFoldersListener: (() => void) | undefined;
let selectModFileCommand: (() => Promise<void>) | undefined;
let shownQuickPickItems: Array<{ label: string; description?: string; detail?: string; picked?: boolean }> = [];
let workspaceFolders: Array<{ uri: MockUri }> = [];
let workspaceFiles: string[] = [];
let pendingFileChecks = new Map<string, Deferred<boolean>>();
const errorMessages: string[] = [];
const createdWatchers: MockFileSystemWatcher[] = [];
const registrations: Array<{ dispose(): void }> = [];
const statusItem = {
    command: undefined as string | undefined,
    text: '',
    tooltip: '',
    show: () => undefined,
    dispose: () => undefined,
};

class MockDisposable {
    constructor(private readonly callback: () => void = () => undefined) {}

    public dispose(): void {
        this.callback();
    }

    public static from(...disposables: Array<{ dispose(): void }>): MockDisposable {
        return new MockDisposable(() => disposables.forEach(disposable => disposable.dispose()));
    }
}

class MockRelativePattern {
    constructor(
        public readonly base: MockUri,
        public readonly pattern: string,
    ) {}
}

class MockFileSystemWatcher extends MockDisposable {
    public readonly changeListeners: Array<(file: MockUri) => void> = [];
    public readonly createListeners: Array<(file: MockUri) => void> = [];
    public readonly deleteListeners: Array<(file: MockUri) => void> = [];
    public disposed = false;

    public onDidChange(listener: (file: MockUri) => void): MockDisposable {
        this.changeListeners.push(listener);
        return new MockDisposable();
    }

    public onDidCreate(listener: (file: MockUri) => void): MockDisposable {
        this.createListeners.push(listener);
        return new MockDisposable();
    }

    public onDidDelete(listener: (file: MockUri) => void): MockDisposable {
        this.deleteListeners.push(listener);
        return new MockDisposable();
    }

    public override dispose(): void {
        this.disposed = true;
    }

    public fireChange(file: MockUri): void {
        this.changeListeners.forEach(listener => listener(file));
    }

    public fireCreate(file: MockUri): void {
        this.createListeners.forEach(listener => listener(file));
    }

    public fireDelete(file: MockUri): void {
        this.deleteListeners.forEach(listener => listener(file));
    }
}

interface MockUri {
    fsPath: string;
    path: string;
    toString(): string;
}

function createUri(value: string): MockUri {
    return {
        fsPath: value,
        path: value,
        toString: () => value,
    };
}

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            commands: {
                registerCommand: (_command: string, callback: () => Promise<void>) => {
                    selectModFileCommand = callback;
                    return new MockDisposable();
                },
            },
            ConfigurationTarget: {
                Workspace: 2,
            },
            Disposable: MockDisposable,
            RelativePattern: MockRelativePattern,
            StatusBarAlignment: {
                Left: 1,
            },
            Uri: {
                parse: (value: string) => createUri(value),
                joinPath: (base: MockUri, ...segments: string[]) => createUri(path.join(base.fsPath, ...segments)),
            },
            window: {
                createStatusBarItem: () => statusItem,
                showErrorMessage: (message: string) => {
                    errorMessages.push(message);
                },
                showOpenDialog: async () => undefined,
                showQuickPick: async (items: typeof shownQuickPickItems) => {
                    shownQuickPickItems = items;
                    return undefined;
                },
            },
            workspace: {
                get workspaceFolders() {
                    return workspaceFolders;
                },
                onDidChangeConfiguration: (callback: typeof configurationListener) => {
                    configurationListener = callback;
                    return new MockDisposable();
                },
                onDidChangeWorkspaceFolders: (callback: typeof workspaceFoldersListener) => {
                    workspaceFoldersListener = callback;
                    return new MockDisposable();
                },
                createFileSystemWatcher: (pattern: MockRelativePattern) => {
                    const watcher = new MockFileSystemWatcher();
                    (watcher as MockFileSystemWatcher & { pattern: MockRelativePattern }).pattern = pattern;
                    createdWatchers.push(watcher);
                    return watcher;
                },
            },
        };
    }

    if (request.endsWith('/vsccommon') || request.endsWith('\\vsccommon')) {
        return {
            basename: (value: MockUri | string, extension?: string) => path.basename(typeof value === 'string' ? value : value.fsPath, extension),
            fileOrUriStringToUri: (value: string) => value ? createUri(value) : undefined,
            getConfiguration: () => ({
                modFile: configurationModFile,
                inspect: () => ({ globalValue: globalModFile }),
                update: async () => undefined,
            }),
            isFile: async (uri: MockUri) => pendingFileChecks.get(uri.fsPath)?.promise ?? true,
            readDir: async () => workspaceFiles,
            uriToFilePathWhenPossible: (uri: MockUri) => uri.fsPath,
        };
    }

    if (request.endsWith('/i18n') || request.endsWith('\\i18n')) {
        return {
            localize: (_key: string, message: string) => message,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/modfile')];
const {
    getSelectedModSourceGeneration,
    isDirectModFileInWorkspaceRoot,
    modFileStatusContainer,
    onDidChangeSelectedModSource,
    registerModFile,
    workspaceModFilesCache,
} = require('../../src/util/modfile') as typeof import('../../src/util/modfile');
nodeModule._load = originalLoad;

describe('mod file selection', () => {
    beforeEach(() => {
        registrations.splice(0).forEach(registration => registration.dispose());
        configurationModFile = '';
        globalModFile = undefined;
        configurationListener = undefined;
        workspaceFoldersListener = undefined;
        selectModFileCommand = undefined;
        shownQuickPickItems = [];
        workspaceFolders = [];
        workspaceFiles = [];
        pendingFileChecks = new Map();
        errorMessages.length = 0;
        createdWatchers.length = 0;
        statusItem.command = undefined;
        statusItem.text = '';
        statusItem.tooltip = '';
        modFileStatusContainer.current = null;
        workspaceModFilesCache.clear();
    });

    after(() => {
        registrations.splice(0).forEach(registration => registration.dispose());
    });

    it('does not let a stale file check overwrite the latest selected-mod status', async () => {
        const oldCheck = createDeferred<boolean>();
        const newCheck = createDeferred<boolean>();
        pendingFileChecks.set('old.mod', oldCheck);
        pendingFileChecks.set('new.mod', newCheck);
        configurationModFile = 'old.mod';
        registrations.push(registerModFile());

        configurationModFile = 'new.mod';
        configurationListener?.({ affectsConfiguration: () => true });
        newCheck.resolve(true);
        await waitForMicrotasks();
        assert.strictEqual(statusItem.text, '$(file-code) new');

        oldCheck.resolve(false);
        await waitForMicrotasks();
        assert.strictEqual(statusItem.text, '$(file-code) new');
        assert.deepStrictEqual(errorMessages, []);
    });

    it('keeps equally picked duplicate entries stable while moving all picked entries first', async () => {
        const modFolder = path.join('C:', 'mods');
        const selectedPath = path.join(modFolder, 'same.mod');
        configurationModFile = selectedPath;
        globalModFile = selectedPath;
        workspaceFolders = [{ uri: createUri(modFolder) }];
        workspaceFiles = ['same.mod', 'other.mod'];
        registrations.push(registerModFile());

        await selectModFileCommand?.();

        assert.strictEqual(shownQuickPickItems[0].description, 'Global setting');
        assert.strictEqual(shownQuickPickItems[1].description, 'In folder {0}');
        assert.strictEqual(shownQuickPickItems[0].picked, true);
        assert.strictEqual(shownQuickPickItems[1].picked, true);
        assert.strictEqual(shownQuickPickItems[2].picked, undefined);
    });

    it('rebinds an explicit descriptor watcher and ignores stale or disposed callbacks', async () => {
        const firstModFile = createUri(path.join('C:', 'mods', '[DEV]?{first}.mod'));
        const secondModFile = createUri(path.join('C:', 'mods', 'second.mod'));
        configurationModFile = firstModFile.fsPath;
        const generations: number[] = [];
        const eventDisposable = onDidChangeSelectedModSource(generation => generations.push(generation));
        registrations.push(eventDisposable);
        const registration = registerModFile();
        registrations.push(registration);

        assert.strictEqual(createdWatchers.length, 1);
        const firstWatcher = createdWatchers[0] as MockFileSystemWatcher & { pattern: MockRelativePattern };
        assert.strictEqual(firstWatcher.pattern.base.fsPath, path.dirname(firstModFile.fsPath));
        assert.strictEqual(firstWatcher.pattern.pattern, '*.mod');

        firstWatcher.fireChange(createUri(path.join('C:', 'mods', 'unrelated.mod')));
        await waitForMicrotasks();
        assert.deepStrictEqual(generations, []);

        firstWatcher.fireChange(firstModFile);
        firstWatcher.fireCreate(firstModFile);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 1);
        assert.strictEqual(generations[0], getSelectedModSourceGeneration());

        configurationModFile = secondModFile.fsPath;
        configurationListener?.({ affectsConfiguration: () => true });
        assert.strictEqual(firstWatcher.disposed, true);
        const secondWatcher = createdWatchers[1];
        firstWatcher.fireDelete(firstModFile);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 2);

        secondWatcher.fireChange(secondModFile);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 3);

        registration.dispose();
        secondWatcher.fireDelete(secondModFile);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 3);
    });

    it('watches only direct root-level mod files during automatic selection', async () => {
        const firstRoot = createUri(path.join('C:', 'workspace-a'));
        const secondRoot = createUri(path.join('C:', 'workspace-b'));
        workspaceFolders = [{ uri: firstRoot }, { uri: secondRoot }];
        const generations: number[] = [];
        let modFilesObservedByListener: Promise<MockUri[]> | undefined;
        registrations.push(onDidChangeSelectedModSource(generation => {
            generations.push(generation);
            modFilesObservedByListener = workspaceModFilesCache.get(firstRoot.toString()) as Promise<MockUri[]>;
        }));
        registrations.push(registerModFile());

        assert.strictEqual(createdWatchers.length, 2);
        for (const watcher of createdWatchers as Array<MockFileSystemWatcher & { pattern: MockRelativePattern }>) {
            assert.strictEqual(watcher.pattern.pattern, '*.mod');
        }

        const direct = createUri(path.join(firstRoot.fsPath, 'selected.mod'));
        const nested = createUri(path.join(firstRoot.fsPath, 'nested', 'ignored.mod'));
        assert.strictEqual(isDirectModFileInWorkspaceRoot(firstRoot as any, direct as any), true);
        assert.strictEqual(isDirectModFileInWorkspaceRoot(firstRoot as any, nested as any), false);

        createdWatchers[0].fireCreate(nested);
        await waitForMicrotasks();
        assert.deepStrictEqual(generations, []);

        workspaceFiles = ['old.mod'];
        await workspaceModFilesCache.get(firstRoot.toString());
        workspaceFiles = ['new.mod'];
        createdWatchers[0].fireCreate(direct);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 1);
        assert.strictEqual((await modFilesObservedByListener)?.[0].fsPath, path.join(firstRoot.fsPath, 'new.mod'));

        workspaceFolders = [{ uri: secondRoot }];
        workspaceFoldersListener?.();
        createdWatchers[0].fireChange(direct);
        await waitForMicrotasks();
        assert.strictEqual(generations.length, 2);
        assert.strictEqual(createdWatchers[0].disposed, true);
    });
});

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function waitForMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
