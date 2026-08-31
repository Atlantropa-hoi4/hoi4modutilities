import * as assert from 'assert';
import Module = require('module');

type MockDocument = {
    version: number;
    getText: () => string;
    positionAt: (offset: number) => { offset: number };
};

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

let currentDocument: MockDocument | undefined;
const shownTextDocuments: any[] = [];
const workspaceFolders: Array<{ uri: unknown }> = [];
const writtenFiles: Array<{ uri: unknown; buffer: unknown }> = [];
let workspaceFolderPickCount = 0;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            EventEmitter: class EventEmitter<T> {
                public event = (_listener: (value: T) => void) => ({ dispose: () => undefined });
                public fire(_value: T): void { }
                public dispose(): void { }
            },
            Range: class Range {
                public start: unknown;
                public end: unknown;
                constructor(start: unknown, end: unknown) {
                    this.start = start;
                    this.end = end;
                }
            },
            ViewColumn: {
                One: 1,
            },
            window: {
                showTextDocument: async (document: unknown, options: unknown) => {
                    shownTextDocuments.push({ document, options });
                },
                showErrorMessage: async () => undefined,
                showWorkspaceFolderPick: async () => {
                    workspaceFolderPickCount++;
                    return workspaceFolders[0];
                },
            },
            workspace: {
                workspaceFolders,
                openTextDocument: async () => currentDocument,
            },
            Uri: {
                joinPath: (...parts: unknown[]) => parts[parts.length - 1],
            },
        };
    }

    if ((request.endsWith('/util/vsccommon') || request === '../util/vsccommon')
        && parent?.filename?.includes('previewbase')) {
        return {
            dirUri: (uri: unknown) => uri,
            getDocumentByUri: () => currentDocument,
            mkdirs: async () => undefined,
            writeFile: async (uri: unknown, buffer: unknown) => {
                writtenFiles.push({ uri, buffer });
            },
        };
    }

    if ((request.endsWith('/util/fileloader') || request === '../util/fileloader')
        && parent?.filename?.includes('previewbase')) {
        return {
            getFilePathFromMod: async () => undefined,
            getHoiOpenedFileOriginalUri: (uri: unknown) => uri,
            readFileFromModOrHOI4: async () => [new Uint8Array()],
        };
    }

    return originalLoad.apply(this, [request, parent, isMain]);
};

const { PreviewBase } = require('../../src/previewdef/previewbase') as typeof import('../../src/previewdef/previewbase');

class TestPreview extends PreviewBase {
    protected async getContent(): Promise<string> {
        return '';
    }
}

class DeferredPreview extends PreviewBase {
    private readonly pendingContent = new Map<number, (content: string) => void>();
    public readonly startedVersions: number[] = [];

    public resolve(version: number, content: string): void {
        this.pendingContent.get(version)?.(content);
    }

    protected getContent(document: any): Promise<string> {
        this.startedVersions.push(document.version);
        return new Promise(resolve => this.pendingContent.set(document.version, resolve));
    }
}

function makeDocument(version: number, text: string): MockDocument {
    return {
        version,
        getText: () => text,
        positionAt: (offset: number) => ({ offset }),
    };
}

function createPreview(): TestPreview {
    return new TestPreview({ toString: () => 'file:///focus.txt' } as any, createPanel() as any);
}

function createPanel() {
    const postedMessages: unknown[] = [];
    return {
        webview: {
            html: '',
            onDidReceiveMessage: () => ({ dispose: () => undefined }),
            postMessage: async (message: unknown) => {
                postedMessages.push(message);
                return true;
            },
        },
        onDidDispose: () => ({ dispose: () => undefined }),
        postedMessages,
    };
}

describe('PreviewBase navigation', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    beforeEach(() => {
        currentDocument = undefined;
        shownTextDocuments.length = 0;
        workspaceFolders.length = 0;
        writtenFiles.length = 0;
        workspaceFolderPickCount = 0;
    });

    it('navigates by focus id even when the webview has no token start offset', async () => {
        const text = 'focus_tree = {\n    focus = {\n        id = TAG_FOCUS_1\n    }\n}';
        currentDocument = makeDocument(7, text);
        const preview = createPreview();

        await (preview as any).handleMessage({
            command: 'navigate',
            focusId: 'TAG_FOCUS_1',
            documentVersion: 7,
        });

        assert.strictEqual(shownTextDocuments.length, 1);
        assert.strictEqual(shownTextDocuments[0].document.toString(), 'file:///focus.txt');
        const selection = shownTextDocuments[0].options.selection;
        const start = text.indexOf('id = TAG_FOCUS_1');
        assert.deepStrictEqual(selection.start, { offset: start });
        assert.deepStrictEqual(selection.end, { offset: start + 'id = TAG_FOCUS_1'.length });
    });

    it('does not let an older render overwrite newer document content', async () => {
        const panel = createPanel();
        const preview = new DeferredPreview({ toString: () => 'file:///preview.txt' } as any, panel as any);
        const olderRender = preview.onDocumentChange(makeDocument(1, 'older') as any);
        await new Promise(resolve => setImmediate(resolve));
        const newerRender = preview.onDocumentChange(makeDocument(2, 'newer') as any);
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(preview.startedVersions, [1]);

        preview.resolve(1, 'older content');
        await olderRender;
        assert.strictEqual(panel.webview.html, '');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual(preview.startedVersions, [1, 2]);

        preview.resolve(2, 'newer content');
        await newerRender;
        assert.strictEqual(panel.webview.html, 'newer content');
    });

    it('acknowledges a manual reload after the current document is rendered', async () => {
        currentDocument = makeDocument(3, 'current');
        const panel = createPanel();
        const preview = new TestPreview({ toString: () => 'file:///preview.txt' } as any, panel as any);

        await (preview as any).handleMessage({ command: 'reload' });

        assert.strictEqual(panel.webview.html, '');
        assert.deepStrictEqual(panel.postedMessages, [{ command: 'reloadComplete' }]);
    });

    it('copies a missing dependency directly into the only workspace folder', async () => {
        workspaceFolders.push({ uri: { toString: () => 'file:///workspace' } });
        currentDocument = makeDocument(1, 'copied');
        const preview = createPreview();

        await (preview as any).openOrCopyFile('interface/dependency.gfx', undefined, undefined);

        assert.strictEqual(workspaceFolderPickCount, 0);
        assert.strictEqual(writtenFiles.length, 1);
        assert.strictEqual(shownTextDocuments.length, 1);
    });
});
