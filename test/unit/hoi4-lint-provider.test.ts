import * as assert from 'assert';
import * as path from 'path';
import Module = require('module');
import type * as vscode from 'vscode';
import { collectHoi4LintFindings } from '../../src/hoiformat/lint';

class MockDisposable {
    private disposed = false;
    constructor(private readonly action: () => void) {}
    public dispose(): void {
        if (!this.disposed) {
            this.disposed = true;
            this.action();
        }
    }
}

class MockEvent<T> {
    private readonly listeners = new Set<(event: T) => void>();
    public subscribe(listener: (event: T) => void): MockDisposable {
        this.listeners.add(listener);
        return new MockDisposable(() => this.listeners.delete(listener));
    }
    public fire(event: T): void {
        for (const listener of [...this.listeners]) {
            listener(event);
        }
    }
}

class MockCodeActionKind {
    public static readonly QuickFix = new MockCodeActionKind('quickfix');
    public static readonly SourceFixAll = new MockCodeActionKind('source.fixAll');
    constructor(public readonly value: string) {}
    public append(part: string): MockCodeActionKind {
        return new MockCodeActionKind(`${this.value}.${part}`);
    }
    public contains(other: MockCodeActionKind): boolean {
        return other.value === this.value || other.value.startsWith(`${this.value}.`);
    }
}

interface MockPosition { line: number; character: number; offset: number }
class MockRange {
    constructor(public readonly start: MockPosition, public readonly end: MockPosition) {}
    public intersection(other: MockRange): MockRange | undefined {
        return this.start.offset <= other.end.offset && other.start.offset <= this.end.offset ? this : undefined;
    }
}

class MockDocument {
    public readonly uri;
    public version = 1;
    public isClosed = false;
    public languageId = 'plaintext';
    public textReads = 0;
    public onRead?: () => void;
    public onPosition?: () => void;
    constructor(public readonly filePath: string, public text: string) {
        this.uri = { scheme: 'file', fsPath: filePath, path: filePath, toString: () => filePath };
    }
    public getText(): string {
        this.textReads++;
        const text = this.text;
        this.onRead?.();
        return text;
    }
    public change(text: string): void {
        this.text = text;
        this.version++;
    }
    public positionAt(offset: number): MockPosition {
        this.onPosition?.();
        const before = this.text.slice(0, offset);
        return { line: before.split('\n').length - 1, character: offset - before.lastIndexOf('\n') - 1, offset };
    }
    public offsetAt(position: MockPosition): number { return position.offset; }
}

class MockDiagnostic {
    public code?: string;
    public source?: string;
    constructor(public readonly range: MockRange, public readonly message: string, public readonly severity: number) {}
}

class MockDiagnosticCollection {
    public readonly values = new Map<string, MockDiagnostic[]>();
    public readonly publications: Array<{ uri: string; diagnostics: MockDiagnostic[] }> = [];
    public disposed = false;
    public set(uri: MockDocument['uri'], diagnostics: MockDiagnostic[]): void {
        assert.strictEqual(this.disposed, false, 'diagnostics must not publish after disposal');
        this.values.set(uri.toString(), diagnostics);
        this.publications.push({ uri: uri.toString(), diagnostics });
    }
    public delete(uri: MockDocument['uri']): void {
        assert.strictEqual(this.disposed, false);
        this.values.delete(uri.toString());
    }
    public dispose(): void {
        this.disposed = true;
        this.values.clear();
    }
}

class MockWorkspaceEdit {
    public readonly replacements: Array<{ uri: MockDocument['uri']; range: MockRange; replacement: string }> = [];
    public replace(uri: MockDocument['uri'], range: MockRange, replacement: string): void {
        this.replacements.push({ uri, range, replacement });
    }
}

const opened = new MockEvent<MockDocument>();
const changed = new MockEvent<{ document: MockDocument }>();
const closed = new MockEvent<MockDocument>();
const documents: MockDocument[] = [];
let collection: MockDiagnosticCollection;
let provider: import('../../src/util/hoi4LintProvider').Hoi4LintCodeActionProvider;
let registration: { selector: unknown; metadata: unknown };
const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const providerPath = require.resolve('../../src/util/hoi4LintProvider');
const previousProvider = require.cache[providerPath];
delete require.cache[providerPath];
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            Disposable: MockDisposable,
            Range: MockRange,
            Diagnostic: MockDiagnostic,
            DiagnosticSeverity: { Warning: 1 },
            WorkspaceEdit: MockWorkspaceEdit,
            CodeActionKind: MockCodeActionKind,
            CodeAction: class {
                constructor(public readonly title: string, public readonly kind: MockCodeActionKind) {}
            },
            workspace: {
                textDocuments: documents,
                onDidOpenTextDocument: (listener: (document: MockDocument) => void) => opened.subscribe(listener),
                onDidChangeTextDocument: (listener: (event: { document: MockDocument }) => void) => changed.subscribe(listener),
                onDidCloseTextDocument: (listener: (document: MockDocument) => void) => closed.subscribe(listener),
            },
            languages: {
                createDiagnosticCollection: (name: string) => {
                    assert.strictEqual(name, 'hoi4ModUtilities');
                    collection = new MockDiagnosticCollection();
                    return collection;
                },
                registerCodeActionsProvider: (selector: unknown, actionProvider: typeof provider, metadata: unknown) => {
                    provider = actionProvider;
                    registration = { selector, metadata };
                    return new MockDisposable(() => {});
                },
            },
        };
    }
    if (parent?.filename === providerPath) {
        if (request === './i18n') {
            return { localize: (_key: string, message: string) => message };
        }
        if (request === './vsccommon') {
            return { uriToFilePathWhenPossible: (uri: MockDocument['uri']) => uri.fsPath };
        }
        if (request === './vanillaFiles') {
            return { isHoi4VanillaFileSkipped: () => false };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};
const lintProvider = (() => {
    try {
        return require(providerPath) as typeof import('../../src/util/hoi4LintProvider');
    } finally {
        nodeModule._load = originalLoad;
        delete require.cache[providerPath];
        if (previousProvider) {
            require.cache[providerPath] = previousProvider;
        }
    }
})();

class FakeClock {
    public now = 0;
    public readonly timers = new Map<number, { at: number; action: () => void }>();
    private nextId = 0;
    private readonly originalSetTimeout = global.setTimeout;
    private readonly originalClearTimeout = global.clearTimeout;
    private readonly originalNow = Date.now;
    public install(): void {
        Date.now = () => this.now;
        global.setTimeout = ((action: () => void, delay = 0) => {
            const id = ++this.nextId;
            this.timers.set(id, { at: this.now + delay, action });
            return id;
        }) as unknown as typeof setTimeout;
        global.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
            if (typeof id === 'number') {
                this.timers.delete(id);
            } else {
                this.originalClearTimeout(id);
            }
        }) as typeof clearTimeout;
    }
    public tick(milliseconds: number): void {
        this.now += milliseconds;
        for (const [id, timer] of [...this.timers]) {
            if (timer.at <= this.now) {
                this.timers.delete(id);
                timer.action();
            }
        }
    }
    public restore(): void {
        Date.now = this.originalNow;
        global.setTimeout = this.originalSetTimeout;
        global.clearTimeout = this.originalClearTimeout;
    }
}

const legacyText = 'trigger = { check_variable = { var = score value = 10 compare = equals } }';
describe('HOI4 lint provider scheduling and results', () => {
    let clock: FakeClock;
    let disposables: vscode.Disposable[];
    beforeEach(() => {
        documents.length = 0;
        disposables = [];
        clock = new FakeClock();
        clock.install();
    });
    afterEach(() => {
        try {
            disposables.forEach(disposable => disposable.dispose());
            assert.strictEqual(clock.timers.size, 0, 'all scheduled work must be collected');
        } finally {
            clock.restore();
        }
    });
    function start(...initialDocuments: MockDocument[]): void {
        documents.push(...initialDocuments);
        disposables = lintProvider.registerHoi4LintProvider();
    }
    function change(document: MockDocument, text: string): void {
        document.change(text);
        changed.fire({ document });
    }
    async function advance(milliseconds: number): Promise<void> {
        clock.tick(milliseconds);
        await Promise.resolve();
    }

    it('publishes initial and opened diagnostics immediately and preserves public registrations', () => {
        const document = new MockDocument('/mod/common/scripted_triggers/test.txt', legacyText);
        start(document);
        assert.strictEqual(collection.values.get(document.filePath)?.length, 1);
        assert.strictEqual(document.textReads, 1);
        const second = new MockDocument('/mod/localisation/test.yml', 'l_english:\n KEY:0 "Text"');
        opened.fire(second);
        assert.strictEqual(collection.values.get(second.filePath)?.length, 1);
        assert.strictEqual(second.textReads, 1);
        assert.deepStrictEqual(registration.selector, [{ pattern: '**/*.txt' }, { pattern: '**/*.yml' }, { pattern: '**/*.yaml' }]);
        assert.deepStrictEqual(registration.metadata, {
            providedCodeActionKinds: [MockCodeActionKind.QuickFix, MockCodeActionKind.SourceFixAll.append('hoi4')],
        });
    });

    it('coalesces a burst into one computation of the latest document version', async () => {
        const document = new MockDocument('/mod/common/scripted_triggers/test.txt', legacyText);
        start(document);
        for (let index = 0; index < 20; index++) {
            change(document, `${legacyText}\n# edit ${index}`);
        }
        assert.strictEqual(document.textReads, 1);
        assert.strictEqual(clock.timers.size, 1);
        await advance(199);
        assert.strictEqual(document.textReads, 1);
        await advance(1);
        assert.strictEqual(document.textReads, 2);
        assert.strictEqual(collection.publications.length, 2);
        assert.strictEqual(collection.values.get(document.filePath)?.length, 1);
    });

    it('bounds diagnostic delay during sustained typing and schedules documents independently', async () => {
        const first = new MockDocument('/mod/events/first.txt', legacyText);
        const second = new MockDocument('/mod/events/second.txt', legacyText);
        start(first, second);
        for (let index = 0; index < 10; index++) {
            change(first, `${legacyText}\n# edit ${index}`);
            if (index === 0) {
                change(second, 'trigger = { always = yes }');
            }
            await advance(100);
        }
        assert.strictEqual(first.textReads, 2);
        assert.strictEqual(second.textReads, 2);
        assert.deepStrictEqual(collection.values.get(second.filePath), []);
        assert.strictEqual(clock.timers.size, 0);
    });

    it('cancels pending and already queued diagnostics after closure or disposal', async () => {
        const first = new MockDocument('/mod/events/closed.txt', legacyText);
        const second = new MockDocument('/mod/events/disposed.txt', legacyText);
        start(first, second);
        change(first, `${legacyText}\n# changed`);
        clock.tick(200);
        first.isClosed = true;
        closed.fire(first);
        await Promise.resolve();
        assert.strictEqual(collection.values.has(first.filePath), false);
        assert.strictEqual(first.textReads, 1);

        change(second, `${legacyText}\n# changed`);
        clock.tick(200);
        disposables.forEach(disposable => disposable.dispose());
        await Promise.resolve();
        assert.strictEqual(second.textReads, 1);
        assert.strictEqual(collection.publications.length, 2);
        assert.deepStrictEqual(actionsFor(second), []);
        await advance(1000);
        assert.strictEqual(collection.publications.length, 2);
    });

    it('cancels timers before firing and leaves no work on registration disposal', async () => {
        const document = new MockDocument('/mod/events/test.txt', legacyText);
        start(document);
        change(document, 'trigger = { always = yes }');
        document.isClosed = true;
        closed.fire(document);
        assert.strictEqual(clock.timers.size, 0);
        assert.deepStrictEqual(actionsFor(document), []);
        const second = new MockDocument('/mod/events/second.txt', legacyText);
        opened.fire(second);
        change(second, 'trigger = { always = yes }');
        disposables[0].dispose();
        closed.fire(second);
        assert.strictEqual(clock.timers.size, 0);
        await advance(1000);
        assert.strictEqual(collection.publications.length, 2);
    });

    it('does not publish a stale delayed version or overwrite a reopened document at version one', async () => {
        const document = new MockDocument('/mod/events/reopened.txt', legacyText);
        start(document);
        change(document, `${legacyText}\n# scheduled`);
        document.change('trigger = { always = yes }');
        await advance(200);
        assert.strictEqual(collection.publications.length, 1);
        assert.strictEqual(document.textReads, 1);

        changed.fire({ document });
        clock.tick(200);
        document.isClosed = true;
        closed.fire(document);
        const reopened = new MockDocument(document.filePath, legacyText.replace('10', '25'));
        opened.fire(reopened);
        await Promise.resolve();
        assert.strictEqual(collection.publications.length, 2);
        assert.strictEqual(reopened.textReads, 1);
        assert.strictEqual(replacements(actionsFor(reopened)[0])[0].replacement, 'check_variable = { score = 25 }');
        assert.strictEqual(reopened.textReads, 1);
    });

    it('shares versioned results with code actions and never uses stale diagnostic ranges', async () => {
        const document = new MockDocument('/mod/common/scripted_triggers/test.txt', legacyText);
        start(document);
        const initialDiagnostics = collection.values.get(document.filePath)!;
        assert.strictEqual(actionsFor(document, initialDiagnostics).length, 2);
        assert.strictEqual(actionsFor(document, initialDiagnostics).length, 2);
        assert.strictEqual(document.textReads, 1);

        change(document, legacyText.replace('10', '25'));
        const current = actionsFor(document, initialDiagnostics);
        assert.strictEqual(current.length, 2);
        assert.strictEqual(replacements(current[0])[0].replacement, 'check_variable = { score = 25 }');
        assert.strictEqual(document.textReads, 2);
        await advance(200);
        assert.strictEqual(document.textReads, 2);

        change(document, `# moved\n${document.text}`);
        assert.deepStrictEqual(actionsFor(document, initialDiagnostics, MockCodeActionKind.QuickFix), []);
        const fixAll = actionsFor(document, initialDiagnostics, MockCodeActionKind.SourceFixAll);
        assert.strictEqual(fixAll.length, 1);
        assert.strictEqual(replacements(fixAll[0])[0].range.start.offset, document.text.indexOf('check_variable'));
        await advance(200);
        assert.strictEqual(document.textReads, 3);
    });

    it('rejects cancelled requests and versions that change during computation or edit creation', () => {
        const document = new MockDocument('/mod/events/test.txt', legacyText);
        start();
        assert.deepStrictEqual(actionsFor(document, [], undefined, true), []);
        assert.strictEqual(document.textReads, 0);
        document.onRead = () => document.change('trigger = { always = yes }');
        assert.deepStrictEqual(actionsFor(document), []);
        document.onRead = undefined;
        assert.deepStrictEqual(actionsFor(document), []);
        assert.strictEqual(document.textReads, 2);

        document.change(legacyText);
        document.onPosition = () => document.version++;
        assert.deepStrictEqual(actionsFor(document), []);
        document.onPosition = undefined;
        assert.strictEqual(actionsFor(document).length, 1);
    });

    it('drops diagnostics when the document changes or closes while findings are computed', () => {
        start();
        const document = new MockDocument('/mod/events/test.txt', legacyText);
        document.onRead = () => document.change('trigger = { always = yes }');
        opened.fire(document);
        assert.strictEqual(collection.publications.length, 0);
        document.onRead = () => { document.isClosed = true; closed.fire(document); };
        opened.fire(document);
        assert.strictEqual(collection.publications.length, 0);
    });

    it('bounds cached results and reuses empty findings for the same document version', () => {
        const actionProvider = new lintProvider.Hoi4LintCodeActionProvider();
        const manyDocuments = Array.from({ length: 129 }, (_, index) => new MockDocument(`/mod/events/${index}.txt`, 'trigger = { always = yes }'));
        for (const document of manyDocuments) {
            assert.deepStrictEqual(actionsFor(document, [], undefined, false, actionProvider), []);
        }
        actionsFor(manyDocuments[128], [], undefined, false, actionProvider);
        assert.strictEqual(manyDocuments[128].textReads, 1);
        actionsFor(manyDocuments[0], [], undefined, false, actionProvider);
        assert.strictEqual(manyDocuments[0].textReads, 2);
    });

    for (const [filePath, text] of [
        ['/mod/events/test.txt', '\uFEFFcountry_event = {\r\n option = {\r\n  ai_chance = { factor = 1 }\r\n  trigger = { check_variable = { var = score value = 10 compare = equals } }\r\n }\r\n}\r\n# preserved\r\n'],
        ['/mod/localisation/english/test.yml', '\uFEFFl_english:\r\n KEY:0 "Text"\r\n OTHER:12 "Other"\r\n'],
        ['/mod/localization/test.yaml', 'l_english:\n KEY:0 "Text"\n'],
        ['/mod/unrelated.yaml', 'KEY:0 "Text"'],
        ['/mod/interface/test.gui', legacyText],
    ]) {
        it(`preserves diagnostic and atomic edit parity for ${path.basename(filePath)}`, () => {
            const document = new MockDocument(filePath, text);
            start(document);
            const findings = collectHoi4LintFindings(text, filePath);
            const diagnostics = collection.values.get(filePath)!;
            assert.deepStrictEqual(diagnostics.map(diagnostic => ({
                rule: diagnostic.code, start: diagnostic.range.start.offset, end: diagnostic.range.end.offset,
            })), findings.map(finding => ({ rule: finding.rule, start: finding.start, end: finding.end })));
            assert.ok(diagnostics.every(diagnostic => diagnostic.severity === 1 && diagnostic.source === 'HOI4 Mod Utilities'));
            const actions = actionsFor(document, diagnostics);
            assert.strictEqual(actions.length, findings.length === 0 ? 0 : findings.length + 1);
            if (findings.length > 0) {
                assert.ok(actions.slice(0, -1).every(action => action.isPreferred === true));
                const edits = replacements(actions[actions.length - 1]);
                assert.deepStrictEqual(edits.map(edit => ({
                    start: edit.range.start.offset, end: edit.range.end.offset, replacement: edit.replacement,
                })), findings.map(({ start, end, replacement }) => ({ start, end, replacement })));
                assert.ok(edits.every(edit => edit.uri === document.uri));
                let fixed = text;
                for (const edit of [...edits].reverse()) {
                    fixed = fixed.slice(0, edit.range.start.offset) + edit.replacement + fixed.slice(edit.range.end.offset);
                }
                assert.deepStrictEqual(collectHoi4LintFindings(fixed, filePath), []);
                assert.strictEqual(fixed.startsWith('\uFEFF'), text.startsWith('\uFEFF'));
                assert.strictEqual(fixed.includes('\r\n'), text.includes('\r\n'));
            }
            assert.strictEqual(document.textReads, 1);
        });
    }
});

function actionsFor(
    document: MockDocument,
    diagnostics: MockDiagnostic[] = [],
    only?: MockCodeActionKind,
    cancelled = false,
    actionProvider = provider,
): vscode.CodeAction[] {
    return actionProvider.provideCodeActions(
        document as unknown as vscode.TextDocument,
        new MockRange(document.positionAt(0), document.positionAt(document.text.length)) as unknown as vscode.Range,
        { diagnostics, only } as unknown as vscode.CodeActionContext,
        { isCancellationRequested: cancelled } as vscode.CancellationToken,
    );
}

function replacements(action: vscode.CodeAction): MockWorkspaceEdit['replacements'] {
    assert.ok(action.edit instanceof MockWorkspaceEdit, 'all replacements must be in one WorkspaceEdit');
    return (action.edit as unknown as MockWorkspaceEdit).replacements;
}
