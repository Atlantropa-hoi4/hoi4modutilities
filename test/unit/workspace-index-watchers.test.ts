import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

interface MockUri {
    fsPath: string;
    path: string;
    toString(): string;
}

class MockDisposable {
    constructor(private readonly callback: () => void = () => undefined) {}

    public dispose(): void {
        this.callback();
    }

    public static from(...disposables: Array<{ dispose(): void }>): MockDisposable {
        return new MockDisposable(() => disposables.forEach(disposable => disposable.dispose()));
    }
}

class MockFileSystemWatcher {
    public readonly changeListeners: Array<(file: MockUri) => void> = [];
    public readonly createListeners: Array<(file: MockUri) => void> = [];
    public readonly deleteListeners: Array<(file: MockUri) => void> = [];
    public disposed = false;

    constructor(public readonly pattern: unknown) {}

    public onDidChange(listener: (file: MockUri) => void): MockDisposable {
        return this.addListener(this.changeListeners, listener);
    }

    public onDidCreate(listener: (file: MockUri) => void): MockDisposable {
        return this.addListener(this.createListeners, listener);
    }

    public onDidDelete(listener: (file: MockUri) => void): MockDisposable {
        return this.addListener(this.deleteListeners, listener);
    }

    public fireChange(file: MockUri): void {
        [...this.changeListeners].forEach(listener => listener(file));
    }

    public fireCreate(file: MockUri): void {
        [...this.createListeners].forEach(listener => listener(file));
    }

    public fireDelete(file: MockUri): void {
        [...this.deleteListeners].forEach(listener => listener(file));
    }

    public dispose(): void {
        this.disposed = true;
    }

    private addListener(
        listeners: Array<(file: MockUri) => void>,
        listener: (file: MockUri) => void,
    ): MockDisposable {
        listeners.push(listener);
        return new MockDisposable(() => {
            const index = listeners.indexOf(listener);
            if (index >= 0) {
                listeners.splice(index, 1);
            }
        });
    }
}

const workspaceRoot = createUri(path.join('C:', 'workspace'));
const createdWatchers: MockFileSystemWatcher[] = [];
let contentSourceRefreshCount = 0;
const nodeModule = Module as typeof Module & {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
};
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            Disposable: MockDisposable,
            RelativePattern: class MockRelativePattern {
                constructor(public readonly base: MockUri, public readonly pattern: string) {}
            },
            Uri: {
                file: (value: string) => createUri(value),
                parse: (value: string) => createUri(value),
                joinPath: (base: MockUri, ...segments: string[]) => createUri(path.join(base.fsPath, ...segments)),
            },
            env: {
                language: 'en',
            },
            window: {
                setStatusBarMessage: () => undefined,
                createOutputChannel: () => ({
                    appendLine: () => undefined,
                    show: () => undefined,
                }),
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(_key: string, defaultValue: T) => defaultValue,
                }),
                getWorkspaceFolder: (file: MockUri) => isWithinWorkspace(file) ? { uri: workspaceRoot } : undefined,
                onDidChangeWorkspaceFolders: () => new MockDisposable(),
                onDidChangeTextDocument: () => new MockDisposable(),
                onDidCloseTextDocument: () => new MockDisposable(),
                onDidCreateFiles: () => new MockDisposable(),
                onDidDeleteFiles: () => new MockDisposable(),
                onDidRenameFiles: () => new MockDisposable(),
                onDidChangeConfiguration: () => new MockDisposable(),
                createFileSystemWatcher: (pattern: unknown) => {
                    const watcher = new MockFileSystemWatcher(pattern);
                    createdWatchers.push(watcher);
                    return watcher;
                },
            },
        };
    }

    const parentFile = parent?.filename ?? '';
    const isIndexModule = parentFile.includes('localisationIndex') || parentFile.includes('sharedFocusIndex');
    if (isIndexModule && (request.endsWith('/fileloader') || request.endsWith('\\fileloader'))) {
        return {
            getFilePathFromMod: async () => undefined,
            getSelectedModRootFolders: async () => [],
            listFilesFromModOrHOI4: async () => [],
            readFileFromModOrHOI4: async () => {
                throw new Error('Unexpected file read');
            },
            refreshFileContentSource: () => ++contentSourceRefreshCount,
        };
    }

    if (isIndexModule && (request.endsWith('/modfile') || request.endsWith('\\modfile'))) {
        return {
            onDidChangeSelectedModSource: () => new MockDisposable(),
        };
    }

    if (isIndexModule && (request.endsWith('/featureflags') || request.endsWith('\\featureflags'))) {
        return {
            isLocalisationIndexEnabled: () => true,
            isSharedFocusIndexEnabled: () => true,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/localisationIndex')];
delete require.cache[require.resolve('../../src/util/sharedFocusIndex')];
const {
    registerLocalisationIndex,
} = require('../../src/util/localisationIndex') as typeof import('../../src/util/localisationIndex');
const {
    registerSharedFocusIndex,
} = require('../../src/util/sharedFocusIndex') as typeof import('../../src/util/sharedFocusIndex');
nodeModule._load = originalLoad;

describe('workspace index filesystem watchers', () => {
    beforeEach(() => {
        createdWatchers.length = 0;
        contentSourceRefreshCount = 0;
    });

    it('tracks raw workspace localisation changes and disposes the watcher', async () => {
        const registration = registerLocalisationIndex();
        await waitForMicrotasks();
        const watcher = createdWatchers.find(candidate => candidate.pattern === 'localisation/**/*.yml');
        assert.ok(watcher);
        const file = createUri(path.join(workspaceRoot.fsPath, 'localisation', 'test_l_english.yml'));

        watcher.fireChange(file);
        watcher.fireCreate(file);
        watcher.fireDelete(file);
        assert.strictEqual(contentSourceRefreshCount, 3);

        registration.dispose();
        assert.strictEqual(watcher.disposed, true);
        watcher.fireChange(file);
        assert.strictEqual(contentSourceRefreshCount, 3);
    });

    it('tracks raw workspace shared-focus changes and disposes the watcher', async () => {
        const registration = registerSharedFocusIndex();
        await waitForMicrotasks();
        const watcher = createdWatchers.find(candidate => candidate.pattern === 'common/national_focus/**/*.txt');
        assert.ok(watcher);
        const file = createUri(path.join(workspaceRoot.fsPath, 'common', 'national_focus', 'test.txt'));

        watcher.fireChange(file);
        watcher.fireCreate(file);
        watcher.fireDelete(file);
        assert.strictEqual(contentSourceRefreshCount, 3);

        registration.dispose();
        assert.strictEqual(watcher.disposed, true);
        watcher.fireDelete(file);
        assert.strictEqual(contentSourceRefreshCount, 3);
    });
});

function createUri(value: string): MockUri {
    return {
        fsPath: value,
        path: value,
        toString: () => value,
    };
}

function isWithinWorkspace(file: MockUri): boolean {
    const relative = path.relative(workspaceRoot.fsPath, file.fsPath);
    return relative !== ''
        && !path.isAbsolute(relative)
        && relative !== '..'
        && !relative.startsWith('..' + path.sep);
}

async function waitForMicrotasks(): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
    }
}
