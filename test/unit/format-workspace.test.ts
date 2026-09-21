import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let files: Array<{ path: string; scheme?: string; fsPath?: string; toString(): string }>;
let texts: Record<string, string>;
let edits: Array<{ uri: { path: string }; text: string }>;
let messages: string[];
let logs: string[];
let outputShown: boolean;
let showDetails: boolean;
let cancelled: boolean;
let cancelAfterEdit: boolean;
let acceptEdit: boolean;
let folders: unknown[];
let formatterIgnorePatterns: string[];
let installPath: string;
let skipVanillaFiles: boolean | undefined;
let openedPaths: string[];
const vscodeMock = {
    workspace: {
        get workspaceFolders() { return folders; },
        getConfiguration: () => ({
            get: (key: string, fallback: unknown) => key === 'installPath'
                ? installPath
                : key === 'skipVanillaFiles' ? skipVanillaFiles ?? fallback : formatterIgnorePatterns ?? fallback,
        }),
        getWorkspaceFolder: () => ({ uri: { path: '/mod' } }),
        findFiles: async (_include: string, exclude: unknown) => {
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
            if (cancelAfterEdit) { cancelled = true; }
            return acceptEdit;
        },
    },
    languages: {
        match: (selector: { pattern: string | { pattern: string } }, document: { uri: { path: string } }) => {
            const pattern = typeof selector.pattern === 'string' ? selector.pattern : selector.pattern.pattern;
            return pattern === '**/generated.txt' && document.uri.path.endsWith('/generated.txt') ? 1 : 0;
        },
    },
    RelativePattern: class {
        constructor(_base: unknown, public pattern: string) {}
    },
    window: {
        withProgress: async (_options: unknown, action: (progress: unknown, token: unknown) => Promise<void>) =>
            action({ report() {} }, { get isCancellationRequested() { return cancelled; } }),
        showInformationMessage: (message: string) => messages.push(message),
        showWarningMessage: (message: string, action?: string) => {
            messages.push(message);
            return showDetails ? action : undefined;
        },
        showErrorMessage: (message: string) => messages.push(message),
        createOutputChannel: () => ({
            appendLine: (message: string) => logs.push(message),
            show: () => { outputShown = true; },
        }),
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
        delete require.cache[require.resolve('../../src/util/formatterIgnore')];
        delete require.cache[require.resolve('../../src/util/hoi4InstallFile')];
        delete require.cache[require.resolve('../../src/util/vanillaFiles')];
        delete require.cache[require.resolve('../../src/util/logger')];
        delete require.cache[require.resolve('../../src/util/formatWorkspace')];
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
        logs = [];
        outputShown = false;
        showDetails = false;
        cancelled = false;
        cancelAfterEdit = false;
        acceptEdit = true;
        folders = [{}];
        formatterIgnorePatterns = [];
        installPath = '';
        skipVanillaFiles = undefined;
        openedPaths = [];
    });

    function addFile(path: string, text: string) {
        files.push({ path, toString: () => path });
        texts[path] = text;
    }

    function addDiskFile(fsPath: string, text: string) {
        const uriPath = fsPath.replace(/\\/g, '/');
        files.push({ scheme: 'file', fsPath, path: uriPath, toString: () => uriPath });
        texts[uriPath] = text;
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
        assert.ok(messages[0].includes('2 changed, 1 unchanged, 0 skipped, 0 failed'));
    });

    it('skips invalid scripts and continues with other files', async () => {
        addFile('/mod/events/broken.txt', '= }');
        addFile('/mod/events/good.txt', 'x=1');
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].includes('1 changed, 0 unchanged, 0 skipped, 1 failed'));
        assert.ok(logs.some(message => message.includes('/mod/events/broken.txt')));
    });

    it('skips files matching formatter ignore patterns', async () => {
        formatterIgnorePatterns = ['**/generated.txt'];
        addFile('/mod/events/generated.txt', 'x=1');
        addFile('/mod/events/regular.txt', 'x=2');
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].uri.path, '/mod/events/regular.txt');
        assert.ok(messages[0].includes('1 changed, 0 unchanged, 1 skipped, 0 failed'));
    });

    it('skips vanilla files under the HOI4 install path without opening them', async () => {
        installPath = path.resolve('Hearts of Iron IV');
        const modPath = path.resolve('mod');
        addDiskFile(path.join(installPath, 'common', 'ideas', 'vanilla.txt'), 'x=1');
        addDiskFile(path.join(installPath, 'dlc', 'dlc001', 'interface', 'vanilla.gui'), 'size={ x=1 }');
        addDiskFile(path.join(modPath, 'common', 'ideas', 'mod.txt'), 'x=2');
        await formatWorkspace();
        assert.deepStrictEqual(openedPaths, [path.join(modPath, 'common', 'ideas', 'mod.txt').replace(/\\/g, '/')]);
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].includes('1 changed, 0 unchanged, 2 skipped, 0 failed'));
    });

    it('formats vanilla files under the HOI4 install path when vanilla file skipping is disabled', async () => {
        installPath = path.resolve('Hearts of Iron IV');
        skipVanillaFiles = false;
        addDiskFile(path.join(installPath, 'common', 'ideas', 'vanilla.txt'), 'x=1');
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].includes('1 changed, 0 unchanged, 0 skipped, 0 failed'));
    });

    it('stops after cancellation and reports partial changes', async () => {
        addFile('/mod/events/a.txt', 'x=1');
        addFile('/mod/events/b.txt', 'x=2');
        cancelAfterEdit = true;
        await formatWorkspace();
        assert.strictEqual(edits.length, 1);
        assert.ok(messages[0].startsWith('Formatting cancelled.'));
    });

    it('does not open files when cancellation was already requested', async () => {
        addFile('/mod/events/a.txt', 'x=1');
        cancelled = true;

        await formatWorkspace();

        assert.deepStrictEqual(openedPaths, []);
        assert.deepStrictEqual(edits, []);
        assert.ok(messages[0].startsWith('Formatting cancelled.'));
    });

    it('counts rejected edits as failures', async () => {
        addFile('/mod/events/a.txt', 'x=1');
        acceptEdit = false;
        await formatWorkspace();
        assert.ok(messages[0].includes('0 changed, 0 unchanged, 0 skipped, 1 failed'));
        assert.ok(logs.some(message => message.includes('edit was rejected')));
    });

    it('handles an empty workspace and no supported files', async () => {
        await formatWorkspace();
        assert.ok(messages[0].includes('0 changed, 0 unchanged, 0 skipped, 0 failed'));
        folders = [];
        await formatWorkspace();
        assert.ok(messages[1].startsWith('Open a workspace folder'));
    });

    it('formats files in deterministic path order', async () => {
        addFile('/mod/events/Z.txt', 'z=1');
        addFile('/mod/events/a.txt', 'a=1');

        await formatWorkspace();

        assert.deepStrictEqual(edits.map(edit => edit.uri.path), ['/mod/events/a.txt', '/mod/events/Z.txt']);
    });

    it('opens formatter details when a failed run requests them', async () => {
        showDetails = true;
        addFile('/mod/events/broken.txt', '= }');

        await formatWorkspace();

        assert.strictEqual(outputShown, true);
    });
});
