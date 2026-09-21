import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let files: Array<{ path: string; scheme?: string; fsPath?: string; toString(): string }>;
let texts: Record<string, string>;
let edits: Array<{ uri: { path: string }; text: string }>;
let messages: string[];
let openedPaths: string[];
let cancelled: boolean;
let cancelAfterEdit: boolean;
let acceptEdit: boolean;
let folders: unknown[];

const vscodeMock = {
    workspace: {
        get workspaceFolders() { return folders; },
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        getWorkspaceFolder: () => ({ uri: { path: '/mod' } }),
        findFiles: async (include: string, exclude: unknown) => {
            assert.strictEqual(include, '**/*.{txt,TXT}');
            assert.strictEqual(exclude, undefined);
            return files;
        },
        asRelativePath: (uri: { path: string }) => uri.path,
        openTextDocument: async (uri: { path: string }) => (openedPaths.push(uri.path), {
            uri,
            getText: () => texts[uri.path],
            positionAt: (offset: number) => offset,
        }),
        applyEdit: async (edit: { replacements: typeof edits }) => {
            edits.push(...edit.replacements);
            if (cancelAfterEdit) {
                cancelled = true;
            }
            return acceptEdit;
        },
    },
    languages: { match: () => 0 },
    RelativePattern: class {
        constructor(_base: unknown, public pattern: string) {}
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
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { updateWorkspaceLoggingInWorkspace } = (() => {
    try {
        delete require.cache[require.resolve('../../src/services/localizer')];
        delete require.cache[require.resolve('../../src/util/hoi4InstallFile')];
        delete require.cache[require.resolve('../../src/util/vanillaFiles')];
        delete require.cache[require.resolve('../../src/util/updateWorkspaceLogging')];
        return require('../../src/util/updateWorkspaceLogging') as typeof import('../../src/util/updateWorkspaceLogging');
    } finally {
        nodeModule._load = originalLoad;
    }
})();

describe('workspace logging command', () => {
    beforeEach(() => {
        files = [];
        texts = {};
        edits = [];
        messages = [];
        openedPaths = [];
        cancelled = false;
        cancelAfterEdit = false;
        acceptEdit = true;
        folders = [{}];
    });

    function addFile(path: string, text: string): void {
        files.push({ path, toString: () => path });
        texts[path] = text;
    }

    it('edits supported workspace files from document contents and reports statement counts', async () => {
        addFile('/mod/events/new.txt', 'country_event = { id = sample.1 option = { name = sample.1.a } }');
        addFile('/mod/common/ideas/current.txt', 'ideas = { country = { current = { on_add = { log = "[GetLogRoot]: add idea current" } } } }');
        addFile('/mod/events/broken.txt', '= }');
        addFile('/mod/common/decisions/categories/category.txt', 'sample = { visible = { always = yes } }');
        addFile('/mod/readme.txt', 'x = 1');

        await updateWorkspaceLoggingInWorkspace();

        assert.deepStrictEqual(openedPaths, [
            '/mod/events/new.txt',
            '/mod/common/ideas/current.txt',
            '/mod/events/broken.txt',
        ]);
        assert.strictEqual(edits.length, 1);
        assert.ok(edits[0].text.includes('[GetLogInfo]: event sample.1 option sample.1.a'));
        assert.ok(messages[0].includes('1 files changed (1 logs inserted, 0 updated), 1 unchanged, 1 failed'));
    });

    it('stops after cancellation and leaves applied edits unsaved', async () => {
        addFile('/mod/events/a.txt', 'country_event = { id = a.1 option = { name = a.1.a } }');
        addFile('/mod/events/b.txt', 'country_event = { id = b.1 option = { name = b.1.a } }');
        cancelAfterEdit = true;

        await updateWorkspaceLoggingInWorkspace();

        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].startsWith('Logging update cancelled.'));
    });

    it('counts rejected edits and handles a missing workspace', async () => {
        addFile('/mod/common/national_focus/a.txt', 'focus = { id = A completion_reward = { add_stability = 0.1 } }');
        acceptEdit = false;
        await updateWorkspaceLoggingInWorkspace();
        assert.ok(messages[0].includes('0 files changed (0 logs inserted, 0 updated), 0 unchanged, 1 failed'));

        folders = [];
        await updateWorkspaceLoggingInWorkspace();
        assert.ok(messages[1].startsWith('Open a workspace folder'));
    });
});
