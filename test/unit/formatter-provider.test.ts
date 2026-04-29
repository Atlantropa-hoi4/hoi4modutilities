import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            languages: {
                registerDocumentFormattingEditProvider: () => ({ dispose() {} }),
                registerDocumentRangeFormattingEditProvider: () => ({ dispose() {} }),
                registerOnTypeFormattingEditProvider: () => ({ dispose() {} }),
            },
            l10n: {
                t: (message: string, ...args: Array<string | number | boolean>) =>
                    message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
                bundle: {},
            },
            window: {
                showErrorMessage: () => undefined,
            },
            Range: class {
                public start: unknown;
                public end: unknown;

                constructor(startOrLine: unknown, startCharacterOrEnd: unknown, endLine?: number, endCharacter?: number) {
                    if (typeof startOrLine === 'number' && typeof startCharacterOrEnd === 'number') {
                        this.start = { line: startOrLine, character: startCharacterOrEnd };
                        this.end = { line: endLine, character: endCharacter };
                    } else {
                        this.start = startOrLine;
                        this.end = startCharacterOrEnd;
                    }
                }
            },
            TextEdit: {
                replace: (range: unknown, newText: string) => ({ range, newText }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const formatterProviderModule = (() => {
    try {
        return require('../../src/util/hoi4FormatterProvider') as typeof import('../../src/util/hoi4FormatterProvider');
    } finally {
        nodeModule._load = originalLoad;
    }
})();
const { Hoi4DocumentFormattingEditProvider } = formatterProviderModule;

function createDocument(filePath: string, text: string) {
    const lines = text.split('\n');
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1;
    }
    const offsetAt = (position: { line: number; character: number; offset?: number }) =>
        position.offset ?? lineOffsets[position.line] + position.character;

    return {
        uri: {
            scheme: 'file',
            fsPath: filePath,
            path: filePath.replace(/\\/g, '/'),
            toString: () => filePath,
        },
        lineCount: lines.length,
        getText: (range?: { start: { line: number; character: number; offset?: number }; end: { line: number; character: number; offset?: number } }) =>
            range === undefined ? text : text.slice(offsetAt(range.start), offsetAt(range.end)),
        lineAt: (line: number) => ({
            text: lines[line],
            range: {
                start: { line, character: 0, offset: lineOffsets[line] },
                end: { line, character: lines[line].length, offset: lineOffsets[line] + lines[line].length },
            },
        }),
        positionAt: (targetOffset: number) => {
            let line = 0;
            while (line + 1 < lineOffsets.length && lineOffsets[line + 1] <= targetOffset) {
                line++;
            }

            return { line, character: targetOffset - lineOffsets[line], offset: targetOffset };
        },
    };
}

describe('HOI4 formatter provider', () => {
    it('returns a single full-document edit for supported documents', () => {
        const provider = new Hoi4DocumentFormattingEditProvider();
        const text = 'focus_tree={\n}';
        const edits = provider.provideDocumentFormattingEdits(
            createDocument('C:\\mod\\common\\national_focus\\test.txt', text) as any,
            {} as any,
            {} as any,
        ) as any[];

        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, 'focus_tree = {\n}');
        assert.deepStrictEqual(edits[0].range.start, { line: 0, character: 0, offset: 0 });
        assert.deepStrictEqual(edits[0].range.end, { line: 1, character: 1, offset: text.length });
    });

    it('returns no edits for excluded documents', () => {
        const provider = new Hoi4DocumentFormattingEditProvider();
        const edits = provider.provideDocumentFormattingEdits(
            createDocument('C:\\mod\\map\\weatherpositions.txt', '1;2;3;small') as any,
            {} as any,
            {} as any,
        ) as any[];

        assert.deepStrictEqual(edits, []);
    });

    it('returns a line-range edit for supported range formatting requests', () => {
        const provider = new Hoi4DocumentFormattingEditProvider();
        const text = [
            'focus_tree = {',
            '    id=generic_focus',
            '    focus={',
            '        x=1',
            '    }',
            '}',
        ].join('\n');
        const edits = provider.provideDocumentRangeFormattingEdits(
            createDocument('C:\\mod\\common\\national_focus\\test.txt', text) as any,
            { start: { line: 1, character: 4 }, end: { line: 5, character: 0 } } as any,
            {} as any,
            {} as any,
        ) as any[];

        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, [
            '\tid = generic_focus',
            '\tfocus = {',
            '\t\tx = 1',
            '\t}',
        ].join('\n'));
        assert.deepStrictEqual(edits[0].range.start, { line: 1, character: 0, offset: 15 });
        assert.deepStrictEqual(edits[0].range.end, { line: 4, character: 5, offset: 65 });
    });

    it('returns an indentation edit for on-type formatting', () => {
        const provider = new Hoi4DocumentFormattingEditProvider();
        const text = [
            'focus_tree = {',
            '\tfocus = {',
            '    }',
            '}',
        ].join('\n');
        const edits = provider.provideOnTypeFormattingEdits(
            createDocument('C:\\mod\\common\\national_focus\\test.txt', text) as any,
            { line: 2, character: 5 } as any,
            '}',
            {} as any,
            {} as any,
        ) as any[];

        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, '\t');
        assert.deepStrictEqual(edits[0].range.start, { line: 2, character: 0 });
        assert.deepStrictEqual(edits[0].range.end, { line: 2, character: 4 });
    });
});
