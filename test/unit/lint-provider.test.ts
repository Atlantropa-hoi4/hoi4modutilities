import * as assert from 'assert';
import Module = require('module');

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

class MockRange {
    constructor(public readonly start: MockPosition, public readonly end: MockPosition) {}

    public intersection(other: MockRange): MockRange | undefined {
        return this.start.offset <= other.end.offset && other.start.offset <= this.end.offset
            ? this
            : undefined;
    }
}

interface MockPosition {
    line: number;
    character: number;
    offset: number;
}

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            CodeActionKind: MockCodeActionKind,
            CodeAction: class {
                public diagnostics?: unknown[];
                public edit?: unknown;
                public isPreferred?: boolean;
                constructor(public title: string, public kind: MockCodeActionKind) {}
            },
            WorkspaceEdit: class {
                public replacements: Array<{ uri: unknown; range: MockRange; replacement: string }> = [];
                public replace(uri: unknown, range: MockRange, replacement: string) {
                    this.replacements.push({ uri, range, replacement });
                }
            },
            Range: MockRange,
            Diagnostic: class {},
            DiagnosticSeverity: { Warning: 1 },
            languages: {},
            workspace: {},
            l10n: {
                t: (message: string) => message,
                bundle: {},
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const lintProviderModule = (() => {
    try {
        return require('../../src/util/hoi4LintProvider') as typeof import('../../src/util/hoi4LintProvider');
    } finally {
        nodeModule._load = originalLoad;
    }
})();
const { Hoi4LintCodeActionProvider } = lintProviderModule;

describe('HOI4 lint code action provider', () => {
    it('provides a preferred quick fix and a document fix-all edit', () => {
        const text = 'trigger = { check_variable = { var = score value = 10 compare = equals } }';
        const document = createDocument('C:\\mod\\common\\scripted_triggers\\test.txt', text);
        const start = text.indexOf('check_variable');
        const end = text.indexOf('}', start) + 1;
        const diagnosticRange = new MockRange(document.positionAt(start), document.positionAt(end));
        const diagnostic = { code: 'legacy-check-variable', range: diagnosticRange };
        const provider = new Hoi4LintCodeActionProvider();

        const actions = provider.provideCodeActions(
            document as any,
            diagnosticRange as any,
            { diagnostics: [diagnostic] } as any,
            {} as any,
        ) as any[];

        assert.strictEqual(actions.length, 2);
        assert.strictEqual(actions[0].title, 'Convert to operator syntax');
        assert.strictEqual(actions[0].isPreferred, true);
        assert.strictEqual(actions[0].edit.replacements[0].replacement, 'check_variable = { score = 10 }');
        assert.strictEqual(actions[1].title, 'Fix all safe HOI4 lint issues in this file');
        assert.strictEqual(actions[1].edit.replacements.length, 1);
    });
});

function createDocument(filePath: string, text: string) {
    const lineOffsets = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') {
            lineOffsets.push(index + 1);
        }
    }

    const positionAt = (offset: number): MockPosition => {
        let line = 0;
        while (line + 1 < lineOffsets.length && lineOffsets[line + 1] <= offset) {
            line++;
        }
        return { line, character: offset - lineOffsets[line], offset };
    };

    return {
        uri: {
            scheme: 'file',
            fsPath: filePath,
            path: filePath.replace(/\\/g, '/'),
            toString: () => filePath,
        },
        getText: () => text,
        positionAt,
        offsetAt: (position: MockPosition) => position.offset,
    };
}
