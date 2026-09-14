import * as assert from 'assert';
import Module = require('module');

type MockDocument = { version: number; getText: () => string };

const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = modules._load;
const posted: any[] = [];
const sequence: string[] = [];
const refreshed: MockDocument[] = [];
let currentDocument: MockDocument | undefined;
let nextDocument: MockDocument | undefined;
let applyResult = true;

modules._load = function(request, parent, isMain) {
    const fromHandler = parent?.filename?.includes('mio\\edithandler');
    if (request === 'vscode') {
        return {
            workspace: {
                applyEdit: async () => {
                    sequence.push('apply');
                    if (applyResult) {
                        currentDocument = nextDocument ?? currentDocument;
                    }
                    return applyResult;
                },
            },
            window: {
                showErrorMessage: async () => undefined,
                showTextDocument: async () => undefined,
            },
        };
    }
    if (fromHandler && (request.endsWith('/util/vsccommon') || request === '../../util/vsccommon')) {
        return { getDocumentByUri: () => currentDocument };
    }
    if (fromHandler && (request.endsWith('/util/i18n') || request === '../../util/i18n')) {
        return { localize: (_key: string, message: string) => message };
    }
    if (fromHandler && (request === './editworkspace' || request.endsWith('/mio/editworkspace'))) {
        return { buildMioWorkspaceEdit: () => ({ edit: { kind: 'mio-edit' } }) };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const { MioEditCommandHandler } = require('../../src/previewdef/mio/edithandler') as typeof import('../../src/previewdef/mio/edithandler');
modules._load = originalLoad;

describe('MIO edit command handler', () => {
    beforeEach(() => {
        posted.length = 0;
        sequence.length = 0;
        refreshed.length = 0;
        applyResult = true;
        currentDocument = { version: 3, getText: () => 'before' };
        nextDocument = { version: 4, getText: () => 'after' };
    });

    it('serializes an edit, acknowledges the new version and refreshes', async () => {
        const handler = createHandler();
        await handler.handleMessage(positionMessage(3));
        assert.deepStrictEqual(sequence, ['record:4', 'apply']);
        assert.strictEqual(posted[0].command, 'mioEditApplied');
        assert.strictEqual(posted[0].documentVersion, 4);
        assert.deepStrictEqual(refreshed, [nextDocument]);
    });

    it('rejects stale requests and refreshes the current document', async () => {
        const handler = createHandler();
        await handler.handleMessage(positionMessage(2));
        assert.strictEqual(posted[0].command, 'mioEditRejected');
        assert.deepStrictEqual(sequence, []);
        assert.deepStrictEqual(refreshed, [currentDocument]);
    });

    it('discards a recorded version when VS Code refuses an edit', async () => {
        applyResult = false;
        const handler = createHandler();
        await handler.handleMessage(positionMessage(3));
        assert.deepStrictEqual(sequence, ['record:4', 'apply', 'discard:4']);
        assert.strictEqual(posted[0].command, 'mioEditRejected');
    });
});

function positionMessage(documentVersion: number) {
    return {
        command: 'applyMioPositionEdits' as const,
        requestId: 'request',
        documentVersion,
        mioId: 'child',
        edits: [{ traitId: 'trait', x: 1, y: 2, absoluteX: 1, absoluteY: 2 }],
    };
}

function createHandler(): InstanceType<typeof MioEditCommandHandler> {
    return new MioEditCommandHandler({
        uri: { toString: () => 'file:///mio.txt' } as any,
        webview: { postMessage: async (message: unknown) => { posted.push(message); return true; } } as any,
        getMios: () => [{ id: 'child' } as any],
        recordLocallyAppliedVersion: version => {
            sequence.push(`record:${version}`);
            return () => sequence.push(`discard:${version}`);
        },
        refreshAfterEdit: async (_message, document) => { refreshed.push(document as MockDocument); },
    });
}
