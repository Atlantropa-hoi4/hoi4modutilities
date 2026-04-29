import * as vscode from 'vscode';
import { formatHoi4Text, formatHoi4TextRange, getHoi4ExpectedLineIndent, getHoi4FormatterProfile, Hoi4FormatterProfile } from '../hoiformat/formatter';
import { localize } from './i18n';
import { uriToFilePathWhenPossible } from './vsccommon';

const hoi4FormatterSelector: vscode.DocumentSelector = [
    { pattern: '**/*.txt' },
    { pattern: '**/*.gfx' },
    { pattern: '**/*.gui' },
];

export function registerHoi4FormatterProvider(): vscode.Disposable[] {
    const provider = new Hoi4DocumentFormattingEditProvider();
    return [
        vscode.languages.registerDocumentFormattingEditProvider(hoi4FormatterSelector, provider),
        vscode.languages.registerDocumentRangeFormattingEditProvider(hoi4FormatterSelector, provider),
        vscode.languages.registerOnTypeFormattingEditProvider(hoi4FormatterSelector, provider, '}', '\n'),
    ];
}

export class Hoi4DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider, vscode.OnTypeFormattingEditProvider {
    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const context = getFormatterContext(document);
        if (context === undefined) {
            return [];
        }

        try {
            const text = document.getText();
            const formatted = formatHoi4Text(text, context);
            if (formatted === text) {
                return [];
            }

            return [
                vscode.TextEdit.replace(
                    new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
                    formatted,
                ),
            ];
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(localize('formatter.failed', 'Failed to format HOI4 script: {0}', message));
            return [];
        }
    }

    public provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const context = getFormatterContext(document);
        if (context === undefined || document.lineCount === 0) {
            return [];
        }

        try {
            const lineRange = normalizeLineRange(range, document.lineCount);
            const replacementRange = new vscode.Range(
                document.lineAt(lineRange.startLine).range.start,
                document.lineAt(lineRange.endLine).range.end,
            );
            const text = document.getText();
            const replacement = formatHoi4TextRange(text, context, lineRange);
            if (replacement === document.getText(replacementRange)) {
                return [];
            }

            return [vscode.TextEdit.replace(replacementRange, replacement)];
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(localize('formatter.failed', 'Failed to format HOI4 script: {0}', message));
            return [];
        }
    }

    public provideOnTypeFormattingEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        ch: string,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        if (ch !== '}' && ch !== '\n') {
            return [];
        }

        const context = getFormatterContext(document);
        if (context === undefined || document.lineCount === 0) {
            return [];
        }

        const lineNumber = Math.max(0, Math.min(document.lineCount - 1, position.line));
        const line = document.lineAt(lineNumber);
        const currentIndent = /^\s*/.exec(line.text)?.[0] ?? '';
        const expectedIndent = getHoi4ExpectedLineIndent(document.getText(), context, lineNumber);
        if (currentIndent === expectedIndent) {
            return [];
        }

        return [
            vscode.TextEdit.replace(
                new vscode.Range(lineNumber, 0, lineNumber, currentIndent.length),
                expectedIndent,
            ),
        ];
    }
}

function getFormatterContext(document: vscode.TextDocument): { profile: Hoi4FormatterProfile; filePath: string } | undefined {
    const filePath = uriToFilePathWhenPossible(document.uri);
    const profile = getHoi4FormatterProfile(filePath);
    if (profile === undefined) {
        return undefined;
    }

    return { profile, filePath };
}

function normalizeLineRange(range: vscode.Range, lineCount: number): { startLine: number; endLine: number } {
    const startLine = Math.max(0, Math.min(lineCount - 1, range.start.line));
    const exclusiveEndLine = range.end.character === 0 && range.end.line > range.start.line
        ? range.end.line - 1
        : range.end.line;
    const endLine = Math.max(startLine, Math.min(lineCount - 1, exclusiveEndLine));

    return { startLine, endLine };
}
