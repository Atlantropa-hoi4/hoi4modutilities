import * as vscode from 'vscode';
import { collectHoi4LintFindings, Hoi4LintFinding, Hoi4LintRule } from '../hoiformat/lint';
import { localize } from './i18n';
import { isHoi4VanillaFileSkipped } from './vanillaFiles';
import { uriToFilePathWhenPossible } from './vsccommon';

const diagnosticSource = 'HOI4 Mod Utilities';
const fixAllKind = vscode.CodeActionKind.SourceFixAll.append('hoi4');
const documentSelector: vscode.DocumentSelector = [
    { pattern: '**/*.txt' },
    { pattern: '**/*.yml' },
    { pattern: '**/*.yaml' },
];

export function registerHoi4LintProvider(): vscode.Disposable[] {
    const diagnostics = vscode.languages.createDiagnosticCollection('hoi4ModUtilities');
    const updateDiagnostics = (document: vscode.TextDocument) => {
        const findings = getFindings(document);
        diagnostics.set(document.uri, findings.map(finding => createDiagnostic(document, finding)));
    };

    for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(document);
    }

    return [
        diagnostics,
        vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
        vscode.languages.registerCodeActionsProvider(
            documentSelector,
            new Hoi4LintCodeActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, fixAllKind] },
        ),
    ];
}

export class Hoi4LintCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        if (isHoi4VanillaFileSkipped(document)) {
            return [];
        }

        const findings = getFindings(document);
        if (findings.length === 0) {
            return [];
        }

        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of context.diagnostics) {
            const rule = typeof diagnostic.code === 'string' ? diagnostic.code as Hoi4LintRule : undefined;
            const finding = rule === undefined
                ? undefined
                : findings.find(candidate => candidate.rule === rule && rangesEqual(document, candidate, diagnostic.range));
            if (finding === undefined || diagnostic.range.intersection(range) === undefined) {
                continue;
            }

            const action = new vscode.CodeAction(getFixTitle(finding.rule), vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = createWorkspaceEdit(document, [finding]);
            actions.push(action);
        }

        if (context.only === undefined || context.only.contains(fixAllKind)) {
            const action = new vscode.CodeAction(
                localize('lint.fixAll', 'Fix all safe HOI4 lint issues in this file'),
                fixAllKind,
            );
            action.edit = createWorkspaceEdit(document, findings);
            actions.push(action);
        }

        return actions;
    }
}

function getFindings(document: vscode.TextDocument): Hoi4LintFinding[] {
    return collectHoi4LintFindings(document.getText(), uriToFilePathWhenPossible(document.uri));
}

function createDiagnostic(document: vscode.TextDocument, finding: Hoi4LintFinding): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
        toRange(document, finding),
        getDiagnosticMessage(finding.rule),
        vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.code = finding.rule;
    diagnostic.source = diagnosticSource;
    return diagnostic;
}

function createWorkspaceEdit(document: vscode.TextDocument, findings: Hoi4LintFinding[]): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    for (const finding of findings) {
        edit.replace(document.uri, toRange(document, finding), finding.replacement);
    }
    return edit;
}

function toRange(document: vscode.TextDocument, finding: Hoi4LintFinding): vscode.Range {
    return new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end));
}

function rangesEqual(document: vscode.TextDocument, finding: Hoi4LintFinding, range: vscode.Range): boolean {
    return finding.start === document.offsetAt(range.start) && finding.end === document.offsetAt(range.end);
}

function getDiagnosticMessage(rule: Hoi4LintRule): string {
    switch (rule) {
        case 'legacy-check-variable':
            return localize('lint.legacyCheckVariable', 'Legacy check_variable syntax can be replaced with operator syntax.');
        case 'redundant-single-option-ai-chance':
            return localize('lint.redundantAiChance', 'ai_chance is redundant because this event has only one option.');
        case 'localisation-version-marker':
            return localize('lint.localisationVersion', 'Localisation version numbers are not used by this project.');
    }
}

function getFixTitle(rule: Hoi4LintRule): string {
    switch (rule) {
        case 'legacy-check-variable':
            return localize('lint.fixLegacyCheckVariable', 'Convert to operator syntax');
        case 'redundant-single-option-ai-chance':
            return localize('lint.fixRedundantAiChance', 'Remove redundant ai_chance');
        case 'localisation-version-marker':
            return localize('lint.fixLocalisationVersion', 'Remove localisation version number');
    }
}
