import * as assert from 'assert';
import Module = require('module');

type MockDocument = {
    version: number;
    getText: () => string;
    positionAt: (offset: number) => { offset: number };
};

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

const postedMessages: any[] = [];
const shownTextDocuments: any[] = [];
const errorMessages: string[] = [];
const reloadedDocuments: any[] = [];
const refreshedDocuments: any[] = [];
const appliedEdits: any[] = [];

let currentDocument: MockDocument | undefined;
let nextDocumentAfterApply: MockDocument | undefined;
let applyEditResult = true;
let applyEditBarrier: Promise<void> | undefined;

const editResults = {
    position: { edit: { kind: 'position' } },
    continuous: { edit: { kind: 'continuous' } },
    create: { edit: { kind: 'create' }, placeholderRange: { start: 0, end: 11 } },
    delete: { edit: { kind: 'delete' } },
    link: { edit: { kind: 'link' } },
    exclusive: { edit: { kind: 'exclusive' } },
};

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                applyEdit: async (edit: unknown) => {
                    appliedEdits.push(edit);
                    await applyEditBarrier;
                    if (applyEditResult && nextDocumentAfterApply) {
                        currentDocument = nextDocumentAfterApply;
                    }
                    return applyEditResult;
                },
            },
            window: {
                showErrorMessage: async (message: string) => {
                    errorMessages.push(message);
                },
                showTextDocument: async (document: unknown, options: unknown) => {
                    shownTextDocuments.push({ document, options });
                },
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
        };
    }

    if ((request.endsWith('/util/vsccommon') || request === '../../util/vsccommon')
        && parent?.filename?.includes('edithandler')) {
        return {
            getDocumentByUri: () => currentDocument,
        };
    }

    if ((request.endsWith('/positioneditservice') || request === './positioneditservice')
        && parent?.filename?.includes('edithandler')) {
        return {
            buildFocusPositionWorkspaceEdit: () => editResults.position,
            buildContinuousFocusPositionWorkspaceEdit: () => editResults.continuous,
            buildCreateFocusTemplateWorkspaceEdit: () => editResults.create,
            buildDeleteFocusWorkspaceEdit: () => editResults.delete,
            buildFocusLinkWorkspaceEdit: () => editResults.link,
            buildFocusExclusiveLinkWorkspaceEdit: () => editResults.exclusive,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { FocusTreeEditCommandHandler } = require('../../src/previewdef/focustree/edithandler') as typeof import('../../src/previewdef/focustree/edithandler');

function makeDocument(version: number, text: string): MockDocument {
    return {
        version,
        getText: () => text,
        positionAt: (offset: number) => ({ offset }),
    };
}

function resetHarness() {
    postedMessages.length = 0;
    shownTextDocuments.length = 0;
    errorMessages.length = 0;
    reloadedDocuments.length = 0;
    refreshedDocuments.length = 0;
    appliedEdits.length = 0;
    currentDocument = undefined;
    nextDocumentAfterApply = undefined;
    applyEditResult = true;
    applyEditBarrier = undefined;
}

function createHandler() {
    let reconciledDocument: unknown;
    return new FocusTreeEditCommandHandler({
        uri: { toString: () => 'file:///focus.txt' } as any,
        relativeFilePath: 'common/national_focus/focus.txt',
        webview: {
            postMessage: async (message: unknown) => {
                postedMessages.push(message);
                return true;
            },
        } as any,
        session: {
            refreshDocument: async (document: unknown) => {
                refreshedDocuments.push(document);
            },
            reconcileAfterLocalEdit: (document: unknown) => {
                reconciledDocument = document;
                return (document as MockDocument | undefined)?.version;
            },
            reloadAfterStructuralEdit: async (document: unknown) => {
                reloadedDocuments.push(document);
                return (document as MockDocument | undefined)?.version;
            },
        } as any,
    });
}

describe('focustree edit command handler', () => {
    beforeEach(() => {
        resetHarness();
    });

    it('posts a create ack with the generated focus id before reloading the structural preview', async () => {
        currentDocument = makeDocument(3, 'before');
        nextDocumentAfterApply = makeDocument(4, 'TAG_FOCUS_1 = { }');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'createFocusTemplateAtPosition',
            requestId: 'create-1',
            treeEditKey: 'focus-tree:test',
            targetAbsoluteX: 12,
            targetAbsoluteY: 18,
            documentVersion: 3,
        });

        assert.strictEqual(postedMessages[0].command, 'createFocusTemplateApplied');
        assert.strictEqual(postedMessages[0].requestId, 'create-1');
        assert.strictEqual(postedMessages[0].focusId, 'TAG_FOCUS_1');
        assert.strictEqual(postedMessages[0].documentVersion, 4);
        assert.strictEqual(reloadedDocuments.length, 1);
        assert.strictEqual(reloadedDocuments[0], nextDocumentAfterApply);
        assert.strictEqual(shownTextDocuments.length, 1);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('posts a position edit ack and reconciles the optimistic preview against the updated document', async () => {
        currentDocument = makeDocument(20, 'before');
        nextDocumentAfterApply = makeDocument(21, 'after');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyFocusPositionEdit',
            requestId: 'position-1',
            focusId: 'ROOT',
            targetLocalX: 5,
            targetLocalY: 7,
            documentVersion: 20,
        });

        assert.strictEqual(appliedEdits[0].kind, 'position');
        assert.strictEqual(postedMessages[0].command, 'focusPositionEditApplied');
        assert.strictEqual(postedMessages[0].requestId, 'position-1');
        assert.strictEqual(postedMessages[0].focusId, 'ROOT');
        assert.strictEqual(postedMessages[0].targetLocalX, 5);
        assert.strictEqual(postedMessages[0].targetLocalY, 7);
        assert.strictEqual(postedMessages[0].documentVersion, 21);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('rejects a stale position edit and refreshes the latest document', async () => {
        currentDocument = makeDocument(21, 'newer source');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyFocusPositionEdit',
            requestId: 'position-stale',
            focusId: 'ROOT',
            targetLocalX: 5,
            targetLocalY: 7,
            documentVersion: 20,
        });

        assert.deepStrictEqual(appliedEdits, []);
        assert.strictEqual(postedMessages[0].command, 'focusEditRejected');
        assert.strictEqual(postedMessages[0].requestId, 'position-stale');
        assert.deepStrictEqual(refreshedDocuments, [currentDocument]);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('posts a continuous focus position ack and reconciles the optimistic preview against the updated document', async () => {
        currentDocument = makeDocument(30, 'before');
        nextDocumentAfterApply = makeDocument(31, 'after');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyContinuousFocusPositionEdit',
            requestId: 'continuous-1',
            focusTreeEditKey: 'focus-tree:common/national_focus/focus.txt:focus:0',
            targetX: 140,
            targetY: 920,
            documentVersion: 30,
        });

        assert.strictEqual(appliedEdits[0].kind, 'continuous');
        assert.strictEqual(postedMessages[0].command, 'continuousFocusPositionEditApplied');
        assert.strictEqual(postedMessages[0].requestId, 'continuous-1');
        assert.strictEqual(postedMessages[0].focusTreeEditKey, 'focus-tree:common/national_focus/focus.txt:focus:0');
        assert.strictEqual(postedMessages[0].targetX, 140);
        assert.strictEqual(postedMessages[0].targetY, 920);
        assert.strictEqual(postedMessages[0].documentVersion, 31);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('posts a grouped delete ack before reloading the structural preview', async () => {
        currentDocument = makeDocument(7, 'before');
        nextDocumentAfterApply = makeDocument(8, 'after');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'deleteFocus',
            requestId: 'delete-1',
            focusId: 'ROOT',
            focusIds: ['ROOT', 'CHILD'],
            documentVersion: 7,
        });

        assert.strictEqual(postedMessages[0].command, 'deleteFocusApplied');
        assert.deepStrictEqual(postedMessages[0].focusIds, ['ROOT', 'CHILD']);
        assert.strictEqual(postedMessages[0].documentVersion, 8);
        assert.strictEqual(reloadedDocuments[0], nextDocumentAfterApply);
        assert.deepStrictEqual(errorMessages, []);
    });

    it('posts a prerequisite link ack before reloading the structural preview', async () => {
        currentDocument = makeDocument(10, 'before');
        nextDocumentAfterApply = makeDocument(11, 'after');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyFocusLinkEdit',
            requestId: 'link-1',
            parentFocusId: 'ROOT',
            parentFocusIds: ['ROOT', 'ALT'],
            childFocusId: 'CHILD',
            targetLocalX: 3,
            targetLocalY: 4,
            documentVersion: 10,
        });

        assert.strictEqual(postedMessages[0].command, 'focusLinkEditApplied');
        assert.deepStrictEqual(postedMessages[0].parentFocusIds, ['ROOT', 'ALT']);
        assert.strictEqual(postedMessages[0].childFocusId, 'CHILD');
        assert.strictEqual(postedMessages[0].documentVersion, 11);
        assert.strictEqual(reloadedDocuments[0], nextDocumentAfterApply);
    });

    it('posts a mutually exclusive link ack before reloading the structural preview', async () => {
        currentDocument = makeDocument(14, 'before');
        nextDocumentAfterApply = makeDocument(15, 'after');
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyFocusExclusiveLinkEdit',
            requestId: 'exclusive-1',
            sourceFocusId: 'ROOT',
            targetFocusId: 'OTHER',
            documentVersion: 14,
        });

        assert.strictEqual(postedMessages[0].command, 'focusExclusiveLinkEditApplied');
        assert.strictEqual(postedMessages[0].sourceFocusId, 'ROOT');
        assert.strictEqual(postedMessages[0].targetFocusId, 'OTHER');
        assert.strictEqual(postedMessages[0].documentVersion, 15);
        assert.strictEqual(reloadedDocuments[0], nextDocumentAfterApply);
    });

    it('serializes edits so a second stale request cannot enter applyEdit', async () => {
        currentDocument = makeDocument(20, 'before');
        nextDocumentAfterApply = makeDocument(21, 'after');
        let releaseApplyEdit: (() => void) | undefined;
        applyEditBarrier = new Promise<void>(resolve => {
            releaseApplyEdit = resolve;
        });
        const handler = createHandler();
        const first = handler.handleMessage({
            command: 'applyFocusPositionEdit',
            requestId: 'queued-1',
            focusId: 'ROOT',
            targetLocalX: 5,
            targetLocalY: 7,
            documentVersion: 20,
        });
        const second = handler.handleMessage({
            command: 'applyFocusPositionEdit',
            requestId: 'queued-2',
            focusId: 'CHILD',
            targetLocalX: 8,
            targetLocalY: 9,
            documentVersion: 20,
        });

        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(appliedEdits.length, 1);
        releaseApplyEdit?.();
        await Promise.all([first, second]);

        assert.strictEqual(appliedEdits.length, 1);
        assert.strictEqual(postedMessages[0].command, 'focusPositionEditApplied');
        assert.strictEqual(postedMessages[1].command, 'focusEditRejected');
        assert.strictEqual(postedMessages[1].requestId, 'queued-2');
    });

    it('posts a rejection when VS Code refuses an edit', async () => {
        currentDocument = makeDocument(30, 'before');
        applyEditResult = false;
        const handler = createHandler();

        await handler.handleMessage({
            command: 'applyContinuousFocusPositionEdit',
            requestId: 'refused-1',
            focusTreeEditKey: 'focus-tree:common/national_focus/focus.txt:focus:0',
            targetX: 140,
            targetY: 920,
            documentVersion: 30,
        });

        assert.strictEqual(postedMessages[0].command, 'focusEditRejected');
        assert.strictEqual(postedMessages[0].requestId, 'refused-1');
        assert.match(postedMessages[0].reason, /refused/i);
        assert.strictEqual(errorMessages.length, 1);
    });
});
