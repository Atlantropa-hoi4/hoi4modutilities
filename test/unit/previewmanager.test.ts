import * as assert from 'assert';
import Module = require('module');
import { FakeUpdateClock } from './fake-update-clock';
import type * as vscode from 'vscode';
import type { StandardPreviewDescriptor } from '../../src/previewdef/descriptor';

type FakeUri = { scheme?: string; path?: string; toString(): string };
type FakeDocument = { uri: FakeUri; version: number };
type FakePanel = {
    webview: { html: string };
    revealCount: number;
    disposeCount: number;
    reveal(): void;
    dispose(): void;
};

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

const documents = new Map<string, FakeDocument>();
const createdPanels: FakePanel[] = [];
const sentEvents: string[] = [];
const contextUpdates: Array<[string, unknown]> = [];
const errorMessages: string[] = [];
const infoMessages: string[] = [];
const watchedAssetChanges: Array<(uri: FakeUri) => void> = [];
const watchedAssetCreates: Array<(uri: FakeUri) => void> = [];
const watchedAssetDeletes: Array<(uri: FakeUri) => void> = [];
const watchedPatterns: unknown[] = [];
const activeWatcherPatterns: unknown[] = [];
const disposedWatcherPatterns: unknown[] = [];
const selectedModSourceListeners: Array<() => void> = [];
let selectedModRoots: FakeUri[] = [];
let getSelectedModRoots = async () => selectedModRoots;
const activeTabState: { activeTab: { input: unknown } | undefined } = {
    activeTab: undefined,
};
let mockedVscodeModule: unknown;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        if (mockedVscodeModule) {
            return mockedVscodeModule;
        }

        class Disposable {
            constructor(private readonly fn: () => void = () => undefined) {}
            dispose(): void {
                this.fn();
            }
            static from(...disposables: Array<{ dispose(): void }>): Disposable {
                return new Disposable(() => disposables.forEach(d => d.dispose()));
            }
        }

        class TabInputText {
            constructor(public readonly uri: FakeUri) {}
        }

        mockedVscodeModule = {
            Disposable,
            TabInputText,
            Uri: {
                parse: (value: string) => ({
                    scheme: value.slice(0, value.indexOf(':')),
                    toString: () => value,
                }),
                joinPath: () => undefined,
            },
            RelativePattern: class RelativePattern {
                constructor(public readonly base: FakeUri, public readonly pattern: string) {}
            },
            ViewColumn: {
                Beside: 2,
            },
            commands: {
                registerCommand: () => new Disposable(),
            },
            workspace: {
                onDidCloseTextDocument: () => new Disposable(),
                onDidChangeTextDocument: () => new Disposable(),
                onDidOpenTextDocument: () => new Disposable(),
                onDidChangeWorkspaceFolders: () => new Disposable(),
                onDidChangeConfiguration: () => new Disposable(),
                createFileSystemWatcher: (pattern: unknown) => {
                    watchedPatterns.push(pattern);
                    activeWatcherPatterns.push(pattern);
                    return {
                        onDidChange: (listener: (uri: FakeUri) => void, thisArg?: unknown) => {
                            watchedAssetChanges.push(thisArg ? listener.bind(thisArg) : listener);
                            return new Disposable();
                        },
                        onDidCreate: (listener: (uri: FakeUri) => void, thisArg?: unknown) => {
                            watchedAssetCreates.push(thisArg ? listener.bind(thisArg) : listener);
                            return new Disposable();
                        },
                        onDidDelete: (listener: (uri: FakeUri) => void, thisArg?: unknown) => {
                            watchedAssetDeletes.push(thisArg ? listener.bind(thisArg) : listener);
                            return new Disposable();
                        },
                        dispose: () => {
                            disposedWatcherPatterns.push(pattern);
                            const activeIndex = activeWatcherPatterns.indexOf(pattern);
                            if (activeIndex >= 0) {
                                activeWatcherPatterns.splice(activeIndex, 1);
                            }
                        },
                    };
                },
                openTextDocument: async (uri: FakeUri) => documents.get(uri.toString()),
                getWorkspaceFolder: (uri: FakeUri) => uri.toString().startsWith('file:///workspace/')
                    ? { uri: { toString: () => 'file:///workspace' } }
                    : undefined,
            },
            window: {
                activeTextEditor: undefined,
                visibleTextEditors: [],
                onDidChangeActiveTextEditor: () => new Disposable(),
                onDidChangeVisibleTextEditors: () => new Disposable(),
                tabGroups: {
                    activeTabGroup: activeTabState,
                    onDidChangeTabGroups: () => new Disposable(),
                    onDidChangeTabs: () => new Disposable(),
                },
                registerWebviewPanelSerializer: () => new Disposable(),
                createWebviewPanel: () => {
                    const panel = createPanel();
                    createdPanels.push(panel);
                    return panel;
                },
                showErrorMessage: async (message: string) => {
                    errorMessages.push(message);
                },
                showInformationMessage: async (message: string) => {
                    infoMessages.push(message);
                },
            },
        };

        return mockedVscodeModule;
    }

    if ((request.endsWith('/util/vsccommon') || request === '../util/vsccommon')
        && (parent?.filename?.includes('previewmanager') || parent?.filename?.includes('previewcontextservice'))) {
        return {
            basename: (uri: FakeUri) => uri.toString().split('/').pop() ?? 'unknown.txt',
            getDocumentByUri: (uri: FakeUri) => documents.get(uri.toString()),
        };
    }

    if ((request.endsWith('/util/telemetry') || request === '../util/telemetry')
        && parent?.filename?.includes('previewmanager')) {
        return {
            sendEvent: (name: string) => {
                sentEvents.push(name);
            },
        };
    }

    if ((request.endsWith('/context') || request === '../context')
        && (parent?.filename?.includes('previewmanager') || parent?.filename?.includes('previewcontextservice'))) {
        return {
            contextContainer: {
                current: undefined,
            },
            setVscodeContext: (name: string, value: unknown) => {
                contextUpdates.push([name, value]);
            },
        };
    }

    if ((request.endsWith('/util/debug') || request === '../util/debug')
        && (parent?.filename?.includes('previewmanager')
            || parent?.filename?.includes('previewproviderresolver')
            || parent?.filename?.includes('previewcontextservice'))) {
        return {
            debug: () => undefined,
            error: () => undefined,
        };
    }

    if ((request.endsWith('/util/webview') || request === '../util/webview')
        && parent?.filename?.includes('previewmanager')) {
        return {
            getWebviewPanelOptions: (options: unknown) => options,
        };
    }

    if ((request.endsWith('/util/fileloader') || request === '../util/fileloader')
        && parent?.filename?.includes('previewmanager')) {
        return {
            getSelectedModRootFolders: () => getSelectedModRoots(),
        };
    }

    if ((request.endsWith('/util/modfile') || request === '../util/modfile')
        && parent?.filename?.includes('previewmanager')) {
        return {
            onDidChangeSelectedModSource: (listener: () => void) => {
                selectedModSourceListeners.push(listener);
                return {
                    dispose: () => {
                        const index = selectedModSourceListeners.indexOf(listener);
                        if (index >= 0) {
                            selectedModSourceListeners.splice(index, 1);
                        }
                    },
                };
            },
        };
    }

    if ((request.endsWith('/util/i18n') || request === '../util/i18n')
        && parent?.filename?.includes('previewmanager')) {
        return {
            localize: (_key: string, message: string, ...args: unknown[]) =>
                message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { PreviewManager } = require('../../src/previewdef/previewmanager') as typeof import('../../src/previewdef/previewmanager');

describe('preview manager', () => {
    beforeEach(() => {
        documents.clear();
        createdPanels.length = 0;
        sentEvents.length = 0;
        contextUpdates.length = 0;
        errorMessages.length = 0;
        infoMessages.length = 0;
        watchedAssetChanges.length = 0;
        watchedAssetCreates.length = 0;
        watchedAssetDeletes.length = 0;
        watchedPatterns.length = 0;
        activeWatcherPatterns.length = 0;
        disposedWatcherPatterns.length = 0;
        selectedModSourceListeners.length = 0;
        selectedModRoots = [];
        getSelectedModRoots = async () => selectedModRoots;
        activeTabState.activeTab = undefined;
    });

    it('reveals the existing preview instead of opening a duplicate panel', async () => {
        const document = createDocument('file:///common/test.txt');
        const manager = createManager([createPanelProvider('focus', () => 0)]);

        await manager['showPreviewImpl'](document.uri as any);

        const duplicatePanel = createPanel();
        await manager['showPreviewImpl'](document.uri as any, duplicatePanel as any);

        assert.strictEqual(createdPanels.length, 1);
        assert.strictEqual(createdPanels[0].revealCount, 1);
        assert.strictEqual(duplicatePanel.disposeCount, 1);
        assert.deepStrictEqual(sentEvents, ['preview.show.focus']);
    });

    it('refreshes dependent previews when a subscribed document changes', async () => {
        const dependencyDocument = createDocument('file:///common/shared/dep.txt');
        const dependentDocument = createDocument('file:///common/preview.txt');
        const previews: FakePreview[] = [];
        const manager = createManager([
            createPanelProvider('focus', () => 0, (uri, panel) => {
                const preview = new FakePreview(uri, panel);
                previews.push(preview);
                return preview as any;
            }),
        ]);

        await manager['showPreviewImpl'](dependentDocument.uri as any);
        previews[0].emitDependencies(['common/shared/dep.txt']);

        const sourcePreview = new FakePreview(dependencyDocument.uri, createPanel());
        manager['previews'][dependencyDocument.uri.toString()] = sourcePreview as any;

        manager['onChangeTextDocument']({ document: dependencyDocument as any } as any);
        await Promise.resolve();

        assert.strictEqual(sourcePreview.changeCount, 1);
        assert.strictEqual(previews[0].changeCount, 1);
        assert.strictEqual(previews[0].lastChangedDocument, dependentDocument);
    });

    it('refreshes dependent previews when a watched image dependency changes', async () => {
        const dependentDocument = createDocument('file:///workspace/common/preview.txt');
        const previews: FakePreview[] = [];
        const manager = createManager([
            createPanelProvider('focus', () => 0, (uri, panel) => {
                const preview = new FakePreview(uri, panel);
                previews.push(preview);
                return preview as any;
            }),
        ]);
        const disposable = manager.register();

        try {
            await manager['showPreviewImpl'](dependentDocument.uri as any);
            previews[0].emitDependencies(['gfx\\interface\\goals\\icon.dds']);

            watchedAssetChanges.forEach(listener => listener(createUri('file:///workspace/gfx/interface/goals/icon.dds')));
            await Promise.resolve();

            assert.strictEqual(previews[0].changeCount, 1);
            assert.strictEqual(previews[0].lastChangedDocument, dependentDocument);
        } finally {
            disposable.dispose();
        }
    });

    it('refreshes focus tree previews for broad live dependency file changes', async () => {
        const dependentDocument = createDocument('file:///workspace/common/national_focus/preview.txt');
        const previews: FakePreview[] = [];
        const manager = createManager([
            createPanelProvider('focus', () => 0, (uri, panel) => {
                const preview = new FakePreview(uri, panel, 0, changedUri => !!(
                    changedUri.path?.includes('/common/national_focus/')
                    || changedUri.path?.includes('/interface/')
                    || changedUri.path?.includes('/localisation/')
                    || changedUri.path?.endsWith('.mod')
                ));
                previews.push(preview);
                return preview as any;
            }),
        ]);
        const disposable = manager.register();

        try {
            await manager['showPreviewImpl'](dependentDocument.uri as any);
            const liveUris = [
                'file:///workspace/common/national_focus/shared.txt',
                'file:///workspace/interface/custom_icons.gfx',
                'file:///workspace/interface/nationalfocusview.gui',
                'file:///workspace/localisation/example_l_english.yml',
                'file:///workspace/gfx/interface/goals/icon.png',
                'file:///workspace/descriptor.mod',
            ];

            for (const [index, uri] of liveUris.entries()) {
                watchedAssetChanges.forEach(listener => listener(createUri(uri)));
                await Promise.resolve();
                assert.strictEqual(previews[0].changeCount, index + 1);
            }
        } finally {
            disposable.dispose();
        }
    });

    it('coalesces external dependency refreshes by preview document uri', async () => {
        const dependentDocument = createDocument('file:///workspace/common/national_focus/preview.txt');
        const previews: FakePreview[] = [];
        const scheduled = new Map<string, () => void | Promise<void>>();
        const manager = new PreviewManager({
            previewProviders: [
                createPanelProvider('focus', () => 0, (uri, panel) => {
                    const preview = new FakePreview(uri, panel, 0, changedUri => !!changedUri.path?.includes('/interface/'));
                    previews.push(preview);
                    return preview as any;
                }),
            ] as any,
            documentUpdateScheduler: immediateScheduler(),
            dependencyUpdateScheduler: {
                schedule: (key: string, _delayMs: number, action: () => void | Promise<void>) => {
                    scheduled.set(key, action);
                },
                dispose: () => undefined,
            },
        });
        const disposable = manager.register();

        try {
            await manager['showPreviewImpl'](dependentDocument.uri as any);

            watchedAssetChanges.forEach(listener => listener(createUri('file:///workspace/interface/a.gfx')));
            watchedAssetChanges.forEach(listener => listener(createUri('file:///workspace/interface/b.gfx')));
            await Promise.resolve();

            assert.deepStrictEqual([...scheduled.keys()], [dependentDocument.uri.toString()]);
            await scheduled.get(dependentDocument.uri.toString())?.();

            assert.strictEqual(previews[0].changeCount, 1);
            assert.strictEqual(previews[0].lastChangeSource, 'dependency');
            assert.deepStrictEqual(
                previews[0].lastChangedDependencies.map(change => change.uri.toString()).sort(),
                [
                    'file:///workspace/interface/a.gfx',
                    'file:///workspace/interface/b.gfx',
                ],
            );
        } finally {
            disposable.dispose();
        }
    });

    it('registers dependency watchers for selected mod content roots', async () => {
        const document = createDocument('file:///workspace/common/preview.txt');
        selectedModRoots = [createUri('file:///external/mod-root')];
        const manager = createManager([createPanelProvider('focus', () => 0)]);
        const disposable = manager.register();

        try {
            selectedModSourceListeners.forEach(listener => listener());
            await waitForMicrotasks();
            assert.deepStrictEqual(activeWatcherPatterns, []);

            await manager['showPreviewImpl'](document.uri as any);
            await Promise.resolve();
            assert.ok(watchedPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///external/mod-root'
            ));
        } finally {
            disposable.dispose();
        }
    });

    it('rebinds active selected-root dependency watchers when descriptor contents change', async () => {
        const document = createDocument('file:///workspace/common/preview.txt');
        selectedModRoots = [createUri('file:///external/old-root')];
        const previews: FakePreview[] = [];
        const scheduled = new Map<string, () => void | Promise<void>>();
        const manager = new PreviewManager({
            previewProviders: [createPanelProvider('focus', () => 0, (uri, panel) => {
                const preview = new FakePreview(uri, panel);
                previews.push(preview);
                return preview as any;
            }) as any],
            documentUpdateScheduler: immediateScheduler(),
            dependencyUpdateScheduler: {
                schedule: (key: string, _delayMs: number, action: () => void | Promise<void>) => {
                    scheduled.set(key, action);
                },
                dispose: () => undefined,
            },
        });
        const disposable = manager.register();

        try {
            await manager['showPreviewImpl'](document.uri as any);
            await waitForMicrotasks();
            assert.ok(activeWatcherPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///external/old-root'
            ));

            selectedModRoots = [createUri('file:///external/new-root')];
            selectedModSourceListeners.forEach(listener => listener());
            selectedModSourceListeners.forEach(listener => listener());
            await waitForMicrotasks();

            assert.ok(!activeWatcherPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///external/old-root'
            ));
            assert.ok(activeWatcherPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///external/new-root'
            ));
            assert.ok(disposedWatcherPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///external/old-root'
            ));
            assert.strictEqual(scheduled.size, 1);
            assert.strictEqual(previews[0].changeCount, 0);
            await scheduled.get(document.uri.toString())?.();
            assert.strictEqual(previews[0].changeCount, 1);
            assert.strictEqual(previews[0].lastChangeSource, 'dependency');
        } finally {
            disposable.dispose();
        }
    });

    it('does not schedule a selected-source refresh after registration is disposed during root resolution', async () => {
        const document = createDocument('file:///workspace/common/preview.txt');
        let scheduledRefreshCount = 0;
        const manager = new PreviewManager({
            previewProviders: [createPanelProvider('focus', () => 0) as any],
            documentUpdateScheduler: immediateScheduler(),
            dependencyUpdateScheduler: {
                schedule: () => {
                    scheduledRefreshCount += 1;
                },
                dispose: () => undefined,
            },
        });
        const disposable = manager.register();
        await manager['showPreviewImpl'](document.uri as any);
        await waitForMicrotasks();

        const pendingRoots = createDeferred<FakeUri[]>();
        getSelectedModRoots = () => pendingRoots.promise;
        selectedModSourceListeners.forEach(listener => listener());
        disposable.dispose();
        pendingRoots.resolve([createUri('file:///external/late-root')]);
        await waitForMicrotasks();

        assert.strictEqual(scheduledRefreshCount, 0);
        assert.deepStrictEqual(activeWatcherPatterns, []);
    });

    it('skips selected mod-root watchers already covered by the workspace watcher', async () => {
        const document = createDocument('file:///workspace/common/preview.txt');
        selectedModRoots = [createUri('file:///workspace/mod-root')];
        const manager = createManager([createPanelProvider('focus', () => 0)]);
        const disposable = manager.register();

        try {
            await manager['showPreviewImpl'](document.uri as any);
            await Promise.resolve();
            assert.ok(!watchedPatterns.some(pattern =>
                typeof pattern === 'object'
                && pattern !== null
                && 'base' in pattern
                && (pattern as { base: FakeUri }).base.toString() === 'file:///workspace/mod-root'
            ));
        } finally {
            disposable.dispose();
        }
    });

    it('creates broad dependency watchers only while previews are open', async () => {
        const document = createDocument('file:///workspace/common/preview.txt');
        const previews: FakePreview[] = [];
        const manager = createManager([
            createPanelProvider('focus', () => 0, (uri, panel) => {
                const preview = new FakePreview(uri, panel);
                previews.push(preview);
                return preview as any;
            }),
        ]);
        const disposable = manager.register();

        try {
            await Promise.resolve();
            assert.deepStrictEqual(watchedPatterns, []);

            await manager['showPreviewImpl'](document.uri as any);
            await Promise.resolve();
            assert.ok(watchedPatterns.some(pattern => pattern === '**/*.{txt,gfx,gui,yml,dds,tga,png,mod}'));
            assert.strictEqual(activeWatcherPatterns.length, 1);

            previews[0].dispose();
            assert.strictEqual(activeWatcherPatterns.length, 0);
        } finally {
            disposable.dispose();
        }
    });

    it('keeps the newest mod-root watcher rebuild when overlapping async rebuilds finish out of order', async () => {
        const firstRoots = createDeferred<FakeUri[]>();
        const secondRoots = createDeferred<FakeUri[]>();
        let callCount = 0;
        getSelectedModRoots = () => {
            callCount += 1;
            return callCount === 1 ? firstRoots.promise : secondRoots.promise;
        };
        const manager = createManager([createPanelProvider('focus', () => 0)]);

        const firstRebuild = manager['rebuildModRootWatchers']();
        const secondRebuild = manager['rebuildModRootWatchers']();

        secondRoots.resolve([createUri('file:///external/new-root')]);
        await secondRebuild;
        firstRoots.resolve([createUri('file:///external/old-root')]);
        await firstRebuild;

        assert.strictEqual(activeWatcherPatterns.length, 1);
        assert.strictEqual((activeWatcherPatterns[0] as { base: FakeUri }).base.toString(), 'file:///external/new-root');
        assert.ok(disposedWatcherPatterns.some(pattern =>
            typeof pattern === 'object'
            && pattern !== null
            && 'base' in pattern
            && (pattern as { base: FakeUri }).base.toString() === 'file:///external/old-root'
        ));
        assert.ok(!disposedWatcherPatterns.some(pattern =>
            typeof pattern === 'object'
            && pattern !== null
            && 'base' in pattern
            && (pattern as { base: FakeUri }).base.toString() === 'file:///external/new-root'
        ));
    });

    it('uses the preview-provided document debounce when scheduling refreshes', async () => {
        const document = createDocument('file:///common/focus.txt');
        const scheduled: Array<{ key: string; delayMs: number }> = [];
        const manager = new PreviewManager({
            previewProviders: [createPanelProvider('focus', () => 0, (uri, panel) => new FakePreview(uri, panel, 0) as any) as any],
            documentUpdateScheduler: {
                schedule: (key: string, delayMs: number, action: () => void | Promise<void>) => {
                    scheduled.push({ key, delayMs });
                    void action();
                },
                dispose: () => undefined,
            },
            dependencyUpdateScheduler: immediateScheduler(),
        });

        await manager['showPreviewImpl'](document.uri as any);
        manager['onChangeTextDocument']({ document: document as any } as any);
        await Promise.resolve();

        assert.deepStrictEqual(scheduled, [{ key: document.uri.toString(), delayMs: 0 }]);
    });

    describe('responsive serialized refreshes', () => {
        let clock: FakeUpdateClock;
        let manager: InstanceType<typeof PreviewManager>;
        let preview: ResponsivePreview;
        let document: FakeDocument;
        let sharedDocument: FakeDocument;
        let secondSharedDocument: FakeDocument;
        let registration: { dispose(): void };

        beforeEach(async () => {
            clock = new FakeUpdateClock();
            clock.install();
            document = createDocument('file:///common/national_focus/root.txt');
            sharedDocument = createDocument('file:///common/national_focus/shared.txt');
            secondSharedDocument = createDocument('file:///common/national_focus/other-shared.txt');
            manager = new PreviewManager({
                previewProviders: [createPanelProvider('focus', () => 0, (uri, panel) => {
                    preview = new ResponsivePreview(uri, panel);
                    return preview;
                })],
            });
            registration = manager.register();
            // Unit documents intentionally implement only the manager's document surface.
            const uri = document.uri as unknown as vscode.Uri;
            await manager['showPreviewImpl'](uri);
            preview.emitDependencies(['common/national_focus/shared.txt', 'common/national_focus/other-shared.txt']);
        });
        afterEach(() => {
            preview.dispose();
            registration.dispose();
            clock.restore();
        });

        it('waits for a trailing typing burst and refreshes only its latest document state', async () => {
            document.version = 2;
            manager['onChangeTextDocument'](changeEvent(document));
            await clock.advance(20);
            document = createDocument(document.uri.toString(), 3);
            manager['onChangeTextDocument'](changeEvent(document));
            await clock.advance(34);
            assert.strictEqual(preview.changeCount, 0);
            await clock.advance(1);
            assert.deepStrictEqual(preview.changedVersions, [3]);
            assert.strictEqual(preview.lastChangeSource, 'document');
        });

        it('refreshes root Undo and Redo without the ordinary trailing wait', async () => {
            document.version = 2;
            manager['onChangeTextDocument'](changeEvent(document));
            document.version = 3;
            manager['onChangeTextDocument'](changeEvent(document, 1));
            await clock.advance();
            assert.deepStrictEqual(preview.changedVersions, [3]);
            document.version = 4;
            manager['onChangeTextDocument'](changeEvent(document, 2));
            await clock.advance();
            assert.deepStrictEqual(preview.changedVersions, [3, 4]);
            await clock.advance(150);
            assert.strictEqual(preview.changeCount, 2);
        });

        it('uses the short document deadline for unsaved imported focus edits and immediate Undo/Redo', async () => {
            sharedDocument.version = 2;
            manager['onChangeTextDocument'](changeEvent(sharedDocument));
            await clock.advance(34);
            assert.strictEqual(preview.changeCount, 0);
            await clock.advance(1);
            assert.strictEqual(preview.lastChangeSource, 'dependency');
            assert.deepStrictEqual(preview.lastChangedDependencies.map(change => change.uri.toString()),
                [sharedDocument.uri.toString()]);
            for (const reason of [1, 2]) {
                sharedDocument.version += 1;
                manager['onChangeTextDocument'](changeEvent(sharedDocument, reason));
                await clock.advance();
            }
            assert.strictEqual(preview.changeCount, 3);
        });

        it('retains the longer disk-watcher debounce and merges dependency changes with root edits', async () => {
            // These URIs need no VS Code implementation beyond their path/string identity.
            const sharedUri = sharedDocument.uri as unknown as vscode.Uri;
            manager['onDidChangeWatchedDependency'](sharedUri, 'change');
            await clock.advance(149);
            assert.strictEqual(preview.changeCount, 0);
            await clock.advance(1);
            assert.strictEqual(preview.changeCount, 1);
            manager['onDidChangeWatchedDependency'](sharedUri, 'change');
            manager['onChangeTextDocument'](changeEvent(secondSharedDocument));
            document.version = 2;
            manager['onChangeTextDocument'](changeEvent(document));
            await clock.advance(35);
            assert.deepStrictEqual(preview.changedVersions, [1, 2]);
            assert.strictEqual(preview.lastChangeSource, 'dependency');
            assert.deepStrictEqual(preview.lastChangedDependencies.map(change => change.uri.toString()),
                [sharedDocument.uri.toString(), secondSharedDocument.uri.toString()]);
            await clock.advance(150);
            assert.strictEqual(preview.changeCount, 2);
        });

        it('serializes root and imported dependency refreshes through one running action', async () => {
            const gate = createDeferred<void>();
            preview.refreshGate = gate.promise;
            manager['onChangeTextDocument'](changeEvent(document));
            await clock.advance(35);
            assert.strictEqual(preview.changeCount, 1);
            manager['onChangeTextDocument'](changeEvent(sharedDocument));
            await clock.advance(35);
            document.version = 2;
            manager['onChangeTextDocument'](changeEvent(document, 1));
            await clock.advance();
            manager['onChangeTextDocument'](changeEvent(secondSharedDocument, 2));
            await clock.advance();
            assert.strictEqual(preview.changeCount, 1);
            gate.resolve();
            await clock.advance();
            assert.deepStrictEqual(preview.changedVersions, [1, 2]);
            assert.deepStrictEqual(preview.appliedVersions, [2]);
            assert.deepStrictEqual(preview.lastChangedDependencies.map(change => change.uri.toString()),
                [sharedDocument.uri.toString(), secondSharedDocument.uri.toString()]);
        });

        it('invalidates an active result on an imported edit without changing the root document version', async () => {
            const gate = createDeferred<void>();
            preview.refreshGate = gate.promise;
            manager['onChangeTextDocument'](changeEvent(document));
            await clock.advance(35);
            manager['onChangeTextDocument'](changeEvent(sharedDocument));
            await clock.advance(35);
            assert.deepStrictEqual(preview.appliedVersions, []);
            gate.resolve();
            await clock.advance();
            assert.deepStrictEqual(preview.changedVersions, [1, 1]);
            assert.deepStrictEqual(preview.appliedVersions, [1]);
            assert.strictEqual(preview.lastChangeSource, 'dependency');
        });

        it('preserves a full source-selection invalidation when a dependency change joins the same batch', async () => {
            await manager['onDidChangeSelectedModSource'](manager['registrationGeneration']);
            manager['onChangeTextDocument'](changeEvent(sharedDocument));
            await clock.advance(35);
            assert.strictEqual(preview.changeCount, 1);
            assert.strictEqual(preview.lastChangeSource, 'dependency');
            assert.deepStrictEqual(preview.lastChangedDependencies, []);
        });

        it('cannot refresh a disposed preview from an already-fired timer callback', async () => {
            manager['onChangeTextDocument'](changeEvent(document, 1));
            clock.fireTimers(0);
            preview.dispose();
            await clock.advance();
            assert.strictEqual(preview.changeCount, 0);
        });

        it('cannot refresh after registration is disposed even if a timer already fired', async () => {
            manager['onChangeTextDocument'](changeEvent(sharedDocument, 1));
            clock.fireTimers(0);
            registration.dispose();
            await clock.advance();
            assert.strictEqual(preview.changeCount, 0);
        });
    });

    it('rejects superseded callbacks even when an injected scheduler delivers stale work', async () => {
        const document = createDocument('file:///common/focus.txt');
        const actions: Array<() => void | Promise<void>> = [];
        let preview!: FakePreview;
        const manager = new PreviewManager({
            previewProviders: [createPanelProvider('focus', () => 0, (uri, panel) => {
                preview = new FakePreview(uri, panel);
                return preview;
            })],
            documentUpdateScheduler: {
                schedule: (_key, _delay, action) => { actions.push(action); },
                dispose: () => undefined,
            },
        });
        const registration = manager.register();
        try {
            // Test documents expose just URI identity and document version.
            const uri = document.uri as unknown as vscode.Uri;
            await manager['showPreviewImpl'](uri);
            manager['onChangeTextDocument'](changeEvent(document));
            const latest = createDocument(document.uri.toString(), 2);
            manager['onChangeTextDocument'](changeEvent(latest));
            await actions[0]();
            assert.strictEqual(preview.changeCount, 0);
            await actions[1]();
            assert.strictEqual(preview.changeCount, 1);
            assert.strictEqual(preview.lastChangedDocument, latest);
        } finally {
            preview.dispose();
            registration.dispose();
        }
    });

    it('silently ignores an unsupported preview command and clears stale preview context', async () => {
        const document = createDocument('file:///notes/readme.md');
        const manager = createManager([
            createPanelProvider('focus', () => undefined),
        ]);

        await manager['showPreviewImpl'](document.uri as any);

        assert.deepStrictEqual(infoMessages, []);
        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', false],
            ['server.shouldHideHoi4Preview', true],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', ''],
        ]);
    });

    it('updates the preview context using the best matching provider priority', () => {
        const document = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('fallback', () => 10),
            createPanelProvider('focus', () => 1),
        ]);
        activeTabState.activeTab = {
            input: createTabInputText(document.uri),
        };

        manager['safeUpdateHoi4PreviewContextValue']({ document: document as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', true],
            ['server.shouldHideHoi4Preview', false],
            ['server.shouldShowHoi4PreviewTitle', true],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', 'focus'],
        ]);
    });

    it('shows the shine context only for workspace goals-like gfx tabs', () => {
        const document = createDocument('file:///workspace/interface/country_goals.gfx', 3);
        const manager = createManager([
            createPanelProvider('gfx', () => 0),
        ]);
        activeTabState.activeTab = {
            input: createTabInputText(document.uri),
        };

        manager['safeUpdateHoi4PreviewContextValue']({ document: document as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', true],
            ['server.shouldHideHoi4Preview', false],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', true],
            ['server.hoi4PreviewType', 'gfx'],
        ]);
    });

    it('clears the preview context when the active tab is unrelated even if the last text editor was previewable', () => {
        const document = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('focus', () => 1),
        ]);
        activeTabState.activeTab = {
            input: { kind: 'non-text-tab' },
        };

        manager['safeUpdateHoi4PreviewContextValue']({ document: document as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', false],
            ['server.shouldHideHoi4Preview', true],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', ''],
        ]);
    });

    it('clears the preview context when no active tab is resolved instead of reusing a stale editor', () => {
        const stalePreviewableDocument = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('focus', () => 1),
        ]);
        activeTabState.activeTab = undefined;

        manager['safeUpdateHoi4PreviewContextValue']({ document: stalePreviewableDocument as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', false],
            ['server.shouldHideHoi4Preview', true],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', ''],
        ]);
    });

    it('clears the preview context when the active editor is not a text editor even if the tab uri is stale', () => {
        const stalePreviewableDocument = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('focus', () => 1),
        ]);
        activeTabState.activeTab = {
            input: createTabInputText(stalePreviewableDocument.uri),
        };

        manager['safeUpdateHoi4PreviewContextValue'](undefined);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', false],
            ['server.shouldHideHoi4Preview', true],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', ''],
        ]);
    });

    it('does not fall back to a stale previewable editor when the active tab uri does not match it', () => {
        const stalePreviewableDocument = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('focus', () => 1),
        ]);
        activeTabState.activeTab = {
            input: createTabInputText({
                toString: () => 'file:///notes/readme.md',
            }),
        };

        manager['safeUpdateHoi4PreviewContextValue']({ document: stalePreviewableDocument as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', false],
            ['server.shouldHideHoi4Preview', true],
            ['server.shouldShowHoi4PreviewTitle', false],
            ['server.shouldShowFocusGfxShine', false],
            ['server.hoi4PreviewType', ''],
        ]);
    });

    it('ignores unsupported walkthrough documents without raising a missing-document error', async () => {
        const manager = createManager([createPanelProvider('focus', () => 0)]);
        const panel = createPanel();

        await manager['showPreviewImpl']({
            scheme: 'walkThrough',
            toString: () => 'walkThrough://vscode_getting_started_page',
        } as any, panel as any);

        assert.strictEqual(panel.disposeCount, 1);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('silently disposes deserialized webview-panel previews that do not point to real text documents', async () => {
        const manager = createManager([createPanelProvider('focus', () => 0)]);
        const panel = createPanel();

        await manager.deserializeWebviewPanel(panel as any, {
            uri: 'webview-panel:webview-panel/webview-server.hoi4ftpreview-bad-state',
        });

        assert.strictEqual(panel.disposeCount, 1);
        assert.deepStrictEqual(errorMessages, []);
    });
});

function createManager(previewProviders: Array<any>) {
    return new PreviewManager({
        previewProviders,
        documentUpdateScheduler: immediateScheduler(),
        dependencyUpdateScheduler: immediateScheduler(),
    });
}

function immediateScheduler() {
    return {
        schedule: (_key: string, _delayMs: number, action: () => void | Promise<void>) => {
            void action();
        },
        dispose: () => undefined,
    };
}

function createDocument(uriValue: string, version = 1): FakeDocument {
    const document = {
        uri: createUri(uriValue),
        version,
    };
    documents.set(uriValue, document);
    return document;
}

function createUri(uriValue: string): FakeUri {
    const schemeEnd = uriValue.indexOf(':');
    const scheme = schemeEnd >= 0 ? uriValue.slice(0, schemeEnd) : undefined;
    const parsed = (() => {
        try {
            return new URL(uriValue);
        } catch {
            return undefined;
        }
    })();

    return {
        scheme,
        path: parsed?.pathname ?? uriValue,
        toString: () => uriValue,
    };
}

function createTabInputText(uri: FakeUri): unknown {
    const vscode = require('vscode') as { TabInputText?: new (uri: FakeUri) => unknown };
    return vscode.TabInputText ? new vscode.TabInputText(uri) : { uri };
}

function createPanel(): FakePanel {
    return {
        webview: { html: '' },
        revealCount: 0,
        disposeCount: 0,
        reveal() {
            this.revealCount += 1;
        },
        dispose() {
            this.disposeCount += 1;
        },
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

async function waitForMicrotasks(): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
    }
}

function createPanelProvider(
    type: string,
    canPreview: (document: FakeDocument) => number | undefined,
    createPreview: (uri: FakeUri, panel: FakePanel) => any = (uri, panel) => new FakePreview(uri, panel),
): StandardPreviewDescriptor {
    return {
        type,
        kind: 'panel' as const,
        canPreview,
        createPreview,
    } as unknown as StandardPreviewDescriptor;
}

class FakePreview {
    public readonly dependencyListeners: Array<(dependencies: string[]) => void> = [];
    public readonly disposeListeners: Array<() => void> = [];
    public changeCount = 0;
    public lastChangedDocument: FakeDocument | undefined;
    public lastChangeSource: string | undefined;
    public lastChangedDependencies: Array<{ uri: FakeUri; changeKind: string }> = [];
    public isDisposed = false;
    public pendingRefreshGeneration = 0;

    constructor(
        public readonly uri: FakeUri,
        public readonly panel: FakePanel,
        private readonly documentChangeDebounceMs = 0,
        private readonly externalFileRefreshPredicate: (uri: FakeUri) => boolean = () => false,
    ) {}

    public onDispose(listener: () => void) {
        this.disposeListeners.push(listener);
        return { dispose: () => undefined };
    }

    public onDependencyChanged(listener: (dependencies: string[]) => void) {
        this.dependencyListeners.push(listener);
        return { dispose: () => undefined };
    }

    public async initializePanelContent(_document: FakeDocument): Promise<void> {
        return;
    }

    public getDocumentChangeDebounceMs(_reason?: number): number {
        return this.documentChangeDebounceMs;
    }

    public shouldSerializeRefreshes(): boolean {
        return false;
    }

    public cancelPendingRefresh(): void {
        this.pendingRefreshGeneration += 1;
    }

    public getDependencyDocumentChangeDebounceMs(_uri: FakeUri, _reason?: number): number {
        return this.getDependencyChangeDebounceMs();
    }

    public getDependencyChangeDebounceMs(): number {
        return 0;
    }

    public async onDocumentChange(
        document: FakeDocument,
        options?: { source?: string; changedDependencies?: Array<{ uri: FakeUri; changeKind: string }> },
    ): Promise<void> {
        this.changeCount += 1;
        this.lastChangedDocument = document;
        this.lastChangeSource = options?.source;
        this.lastChangedDependencies = options?.changedDependencies ?? [];
    }

    public getDebugState(): unknown {
        return undefined;
    }

    public shouldRefreshOnExternalFileChange(uri: FakeUri): boolean {
        return this.externalFileRefreshPredicate(uri);
    }

    public emitDependencies(dependencies: string[]): void {
        for (const listener of this.dependencyListeners) {
            listener(dependencies);
        }
    }

    public dispose(): void {
        this.isDisposed = true;
        for (const listener of this.disposeListeners) {
            listener();
        }
    }
}

function changeEvent(document: FakeDocument, reason?: number): vscode.TextDocumentChangeEvent {
    // The manager only reads the open document and VS Code's explicit Undo/Redo reason.
    return { document, reason } as unknown as vscode.TextDocumentChangeEvent;
}

class ResponsivePreview extends FakePreview {
    public readonly changedVersions: number[] = [];
    public readonly appliedVersions: number[] = [];
    public refreshGate: Promise<void> | undefined;

    public override getDocumentChangeDebounceMs(reason?: number): number {
        return reason === 1 || reason === 2 ? 0 : 35;
    }

    public override shouldSerializeRefreshes(): boolean {
        return true;
    }

    public override getDependencyDocumentChangeDebounceMs(_uri: FakeUri, reason?: number): number {
        return this.getDocumentChangeDebounceMs(reason);
    }

    public override getDependencyChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(
        document: FakeDocument,
        options?: { source?: string; changedDependencies?: Array<{ uri: FakeUri; changeKind: string }> },
    ): Promise<void> {
        const generation = this.pendingRefreshGeneration;
        const documentVersion = document.version;
        this.changedVersions.push(document.version);
        const gate = this.refreshGate;
        this.refreshGate = undefined;
        await super.onDocumentChange(document, options);
        await gate;
        if (!this.isDisposed && generation === this.pendingRefreshGeneration) {
            this.appliedVersions.push(documentVersion);
        }
    }
}
