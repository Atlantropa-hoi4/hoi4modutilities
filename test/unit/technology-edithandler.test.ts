import * as assert from 'assert';
import Module = require('module');

type MockDocument = {
    version: number;
    getText: () => string;
};

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const postedMessages: any[] = [];
const appliedEdits: any[] = [];
const refreshedDocuments: any[] = [];
const errorMessages: string[] = [];
const locallyAppliedVersions: Array<{ command: string; version: number }> = [];
let currentDocument: MockDocument | undefined;
let nextDocumentAfterApply: MockDocument | undefined;
let inputValue: string | undefined;
let warningResult: string | undefined;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                applyEdit: async (edit: unknown) => {
                    appliedEdits.push(edit);
                    currentDocument = nextDocumentAfterApply ?? currentDocument;
                    return true;
                },
            },
            window: {
                showInputBox: async () => inputValue,
                showWarningMessage: async () => warningResult,
                showErrorMessage: async (message: string) => errorMessages.push(message),
            },
        };
    }
    if ((request.endsWith('/util/vsccommon') || request === '../../util/vsccommon')
        && parent?.filename?.includes('technology\\edithandler')) {
        return { getDocumentByUri: () => currentDocument };
    }
    if ((request.endsWith('/editservice') || request === './editservice')
        && parent?.filename?.includes('technology\\edithandler')) {
        return {
            buildTechnologyPositionTextChanges: () => ({ kind: 'position' }),
            buildTechnologyPathTextChanges: () => ({ kind: 'path' }),
            buildTechnologyXorTextChanges: () => ({ kind: 'xor' }),
            buildCreateChildTechnologyTextChanges: () => ({ kind: 'create' }),
            buildDeleteTechnologiesTextChanges: () => ({ kind: 'delete', referenceCount: 2 }),
            isValidTechnologyId: () => true,
        };
    }
    if ((request.endsWith('/editworkspace') || request === './editworkspace')
        && parent?.filename?.includes('technology\\edithandler')) {
        return { buildTechnologyWorkspaceEdit: (_document: unknown, result: unknown) => ({ edit: result }) };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const { TechnologyEditCommandHandler } = require('../../src/previewdef/technology/edithandler') as typeof import('../../src/previewdef/technology/edithandler');

describe('technology edit command handler', () => {
    beforeEach(() => {
        postedMessages.length = 0;
        appliedEdits.length = 0;
        refreshedDocuments.length = 0;
        errorMessages.length = 0;
        locallyAppliedVersions.length = 0;
        currentDocument = { version: 3, getText: () => 'before' };
        nextDocumentAfterApply = { version: 4, getText: () => 'after' };
        inputValue = 'new_child';
        warningResult = 'Delete';
    });

    it('applies a position edit and posts a versioned acknowledgement', async () => {
        const handler = createHandler();
        await handler.handleMessage({
            command: 'applyTechnologyPositionEdits',
            requestId: 'request-1',
            documentVersion: 3,
            folder: 'infantry',
            edits: [{ technologyId: 'root', editKey: 'key', x: 2, y: 3 }],
        });
        assert.strictEqual(appliedEdits[0].kind, 'position');
        assert.deepStrictEqual(postedMessages[0], {
            command: 'technologyEditApplied',
            requestId: 'request-1',
            documentVersion: 4,
        });
        assert.deepStrictEqual(locallyAppliedVersions, [{ command: 'applyTechnologyPositionEdits', version: 4 }]);
    });

    it('rejects stale requests and refreshes the latest document', async () => {
        const handler = createHandler();
        await handler.handleMessage({
            command: 'toggleTechnologyPath',
            requestId: 'request-2',
            documentVersion: 2,
            folder: 'infantry',
            sourceTechnologyId: 'root',
            targetTechnologyId: 'child',
        });
        assert.deepStrictEqual(appliedEdits, []);
        assert.strictEqual(postedMessages[0].command, 'technologyEditRejected');
        assert.deepStrictEqual(refreshedDocuments, [currentDocument]);
    });

    it('prompts for a child ID and confirms deletion before applying', async () => {
        const handler = createHandler();
        await handler.handleMessage({
            command: 'createChildTechnologyAtPosition',
            requestId: 'request-3',
            documentVersion: 3,
            folder: 'infantry',
            parentTechnologyId: 'root',
            x: 2,
            y: 4,
        });
        assert.strictEqual(appliedEdits[0].kind, 'create');

        currentDocument = { version: 5, getText: () => 'before delete' };
        nextDocumentAfterApply = { version: 6, getText: () => 'after delete' };
        await handler.handleMessage({
            command: 'deleteTechnologies',
            requestId: 'request-4',
            documentVersion: 5,
            folder: 'infantry',
            technologyIds: ['root'],
        });
        assert.strictEqual(appliedEdits[1].kind, 'delete');
        assert.strictEqual(postedMessages[1].command, 'technologyEditApplied');
    });
});

function createHandler(): InstanceType<typeof TechnologyEditCommandHandler> {
    return new TechnologyEditCommandHandler({
        uri: { toString: () => 'file:///technology.txt' } as any,
        relativeFilePath: 'common/technologies/technology.txt',
        webview: {
            postMessage: async (message: unknown) => {
                postedMessages.push(message);
                return true;
            },
        } as any,
        getEditContext: () => ({
            availableTreeRootsByFolder: { infantry: ['root'] },
            gridLayoutsByFolder: {},
        }),
        refreshDocument: async document => {
            refreshedDocuments.push(document);
        },
        recordLocallyAppliedVersion: (command, version) => {
            locallyAppliedVersions.push({ command, version });
        },
    });
}
