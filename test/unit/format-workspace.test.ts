import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let files: Array<{ path: string; toString(): string }>;
let texts: Record<string, string>;
let edits: Array<{ uri: { path: string }; text: string }>;
let messages: string[];
let cancelled: boolean;
let cancelAfterEdit: boolean;
let acceptEdit: boolean;
let folders: unknown[];
const vscodeMock = {
    workspace: {
        get workspaceFolders() { return folders; },
        findFiles: async (_include: string, exclude: unknown) => {
            assert.strictEqual(exclude, undefined);
            return files;
        },
        asRelativePath: (uri: { path: string }) => uri.path,
        openTextDocument: async (uri: { path: string }) => ({
            getText: () => texts[uri.path],
            positionAt: (offset: number) => offset,
        }),
        applyEdit: async (edit: { replacements: typeof edits }) => {
            edits.push(...edit.replacements);
            if (cancelAfterEdit) { cancelled = true; }
            return acceptEdit;
        },
    },
    window: {
        withProgress: async (_options: unknown, action: (progress: unknown, token: unknown) => Promise<void>) =>
            action({ report() {} }, { get isCancellationRequested() { return cancelled; } }),
        showInformationMessage: (message: string) => messages.push(message),
        showWarningMessage: (message: string) => messages.push(message),
        showErrorMessage: (message: string) => messages.push(message),
    },
    ProgressLocation: { Notification: 15 },
    Range: class { constructor(public start: number, public end: number) {} },
    WorkspaceEdit: class {
        public replacements: typeof edits = [];
        public replace(uri: { path: string }, _range: unknown, text: string) {
            this.replacements.push({ uri, text });
        }
    },
};
nodeModule._load = function(request, parent, isMain) {
    if (request === 'vscode') { return vscodeMock; }
    return originalLoad.call(this, request, parent, isMain);
};
const { formatWorkspace } = (() => {
    try {
        return require('../../src/util/formatWorkspace') as typeof import('../../src/util/formatWorkspace');
    } finally {
        nodeModule._load = originalLoad;
    }
})();

describe('workspace formatting', () => {
    beforeEach(() => {
        files = [];
        texts = {};
        edits = [];
        messages = [];
        cancelled = false;
        cancelAfterEdit = false;
        acceptEdit = true;
        folders = [{}];
    });

    function addFile(path: string, text: string) {
        files.push({ path, toString: () => path });
        texts[path] = text;
    }

    it('formats supported files across roots using document contents and preserves BOM and CRLF', async () => {
        addFile('/mod/common/test.txt', '\uFEFFtag=GER\r\n');
        addFile('/other/interface/test.gui', 'size={ x=1 y=2 }\n');
        addFile('/mod/map/test.txt', 'x=1');
        addFile('/mod/localisation/test.txt', 'x=1');
        addFile('/mod/readme.txt', 'x=1');
        addFile('/mod/events/unchanged.txt', 'x = 1\n');
        await formatWorkspace();
        assert.strictEqual(edits.length, 2);
        assert.strictEqual(edits[0].text, '\uFEFFtag = GER\r\n');
        assert.strictEqual(edits[1].text, 'size = { x = 1 y = 2 }\n');
        assert.ok(messages[0].includes('2 changed, 1 unchanged, 0 failed'));
    });

    it('skips invalid scripts and continues with other files', async () => {
        addFile('/mod/events/broken.txt', '= }');
        addFile('/mod/events/good.txt', 'x=1');
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].includes('1 changed, 0 unchanged, 1 failed'));
    });

    it('stops after cancellation and reports partial changes', async () => {
        addFile('/mod/events/a.txt', 'x=1');
        addFile('/mod/events/b.txt', 'x=2');
        cancelAfterEdit = true;
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].startsWith('Formatting cancelled.'));
    });

    it('counts rejected edits as failures', async () => {
        addFile('/mod/events/a.txt', 'x=1');
        acceptEdit = false;
        await formatWorkspace();
        assert.ok(messages[0].includes('0 changed, 0 unchanged, 1 failed'));
    });

    it('handles an empty workspace and no supported files', async () => {
        await formatWorkspace();
        assert.ok(messages[0].includes('0 changed, 0 unchanged, 0 failed'));
        folders = [];
        await formatWorkspace();
        assert.ok(messages[1].startsWith('Open a workspace folder'));
    });
});
