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
            },
            workspace: {
                workspaceFolders: [],
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
            writeFile: async () => undefined,
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

function makeDocument(version: number, text: string): MockDocument {
    return {
        version,
        getText: () => text,
        positionAt: (offset: number) => ({ offset }),
    };
}

function createPreview(): TestPreview {
    const panel = {
        webview: {
            html: '',
            onDidReceiveMessage: () => ({ dispose: () => undefined }),
        },
        onDidDispose: () => ({ dispose: () => undefined }),
    };
    return new TestPreview({ toString: () => 'file:///focus.txt' } as any, panel as any);
}

describe('PreviewBase navigation', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    beforeEach(() => {
        currentDocument = undefined;
        shownTextDocuments.length = 0;
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
});
