import * as assert from 'assert';
import Module = require('module');

type FakeUri = { toString(): string };
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

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class Disposable {
            constructor(private readonly fn: () => void = () => undefined) {}
            dispose(): void {
                this.fn();
            }
            static from(...disposables: Array<{ dispose(): void }>): Disposable {
                return new Disposable(() => disposables.forEach(d => d.dispose()));
            }
        }

        return {
            Disposable,
            Uri: {
                parse: (value: string) => ({ toString: () => value }),
                joinPath: () => undefined,
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
                openTextDocument: async (uri: FakeUri) => documents.get(uri.toString()),
            },
            window: {
                activeTextEditor: undefined,
                visibleTextEditors: [],
                onDidChangeActiveTextEditor: () => new Disposable(),
                onDidChangeVisibleTextEditors: () => new Disposable(),
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
    }

    if ((request.endsWith('/util/vsccommon') || request === '../util/vsccommon')
        && parent?.filename?.includes('previewmanager')) {
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
        && parent?.filename?.includes('previewmanager')) {
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
        && (parent?.filename?.includes('previewmanager') || parent?.filename?.includes('previewproviderresolver'))) {
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

    it('updates the preview context using the best matching provider priority', () => {
        const document = createDocument('file:///common/context.txt', 3);
        const manager = createManager([
            createPanelProvider('fallback', () => 10),
            createPanelProvider('focus', () => 1),
        ]);

        manager['safeUpdateHoi4PreviewContextValue']({ document: document as any } as any);

        assert.deepStrictEqual(contextUpdates, [
            ['server.shouldShowHoi4Preview', true],
            ['server.shouldHideHoi4Preview', false],
            ['server.hoi4PreviewType', 'focus'],
        ]);
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
        uri: { toString: () => uriValue },
        version,
    };
    documents.set(uriValue, document);
    return document;
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

function createPanelProvider(
    type: string,
    canPreview: (document: FakeDocument) => number | undefined,
    createPreview: (uri: FakeUri, panel: FakePanel) => any = (uri, panel) => new FakePreview(uri, panel),
) {
    return {
        type,
        kind: 'panel',
        canPreview,
        createPreview,
    };
}

class FakePreview {
    public readonly dependencyListeners: Array<(dependencies: string[]) => void> = [];
    public readonly disposeListeners: Array<() => void> = [];
    public changeCount = 0;
    public lastChangedDocument: FakeDocument | undefined;
    public isDisposed = false;

    constructor(
        public readonly uri: FakeUri,
        public readonly panel: FakePanel,
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

    public getDocumentChangeDebounceMs(): number {
        return 0;
    }

    public async onDocumentChange(document: FakeDocument): Promise<void> {
        this.changeCount += 1;
        this.lastChangedDocument = document;
    }

    public getDebugState(): unknown {
        return undefined;
    }

    public emitDependencies(dependencies: string[]): void {
        for (const listener of this.dependencyListeners) {
            listener(dependencies);
        }
    }
}
