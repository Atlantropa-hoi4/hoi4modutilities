import * as vscode from 'vscode';
import { collectHoi4LintFindings, Hoi4LintFinding, Hoi4LintRule } from '../hoiformat/lint';
import { localize } from './i18n';
import { isHoi4VanillaFileSkipped } from './vanillaFiles';
import { uriToFilePathWhenPossible } from './vsccommon';
import { UpdateScheduler } from '../services/updateScheduler';

const diagnosticSource = 'HOI4 Mod Utilities';
const diagnosticDebounceMs = 200;
const diagnosticMaxWaitMs = 1000;
const maxCachedDocuments = 128;
const fixAllKind = vscode.CodeActionKind.SourceFixAll.append('hoi4');
const documentSelector: vscode.DocumentSelector = [
    { pattern: '**/*.txt' },
    { pattern: '**/*.yml' },
    { pattern: '**/*.yaml' },
];

export function registerHoi4LintProvider(): vscode.Disposable[] {
    const diagnostics = vscode.languages.createDiagnosticCollection('hoi4ModUtilities');
    const findingsCache = new Hoi4LintFindingsCache();
    const scheduler = new UpdateScheduler<string>(key => key);
    const pendingUpdates = new Map<string, { document: vscode.TextDocument; version: number; startedAt: number }>();
    let disposed = false;
    const updateDiagnostics = (document: vscode.TextDocument) => {
        if (disposed || document.isClosed) {
            return;
        }
        const version = document.version;
        const findings = findingsCache.get(document);
        const result = findings.map(finding => createDiagnostic(document, finding));
        if (!disposed && !document.isClosed && document.version === version) {
            diagnostics.set(document.uri, result);
        }
    };
    const onOpen = (document: vscode.TextDocument) => {
        const key = document.uri.toString();
        scheduler.cancel(key);
        pendingUpdates.delete(key);
        updateDiagnostics(document);
    };
    const onChange = (document: vscode.TextDocument) => {
        if (disposed || document.isClosed) {
            return;
        }
        const key = document.uri.toString();
        const previous = pendingUpdates.get(key);
        const now = Date.now();
        const pending = {
            document,
            version: document.version,
            startedAt: previous?.document === document ? previous.startedAt : now,
        };
        pendingUpdates.set(key, pending);
        scheduler.schedule(key, Math.min(diagnosticDebounceMs, Math.max(0, diagnosticMaxWaitMs - (now - pending.startedAt))), () => {
            if (disposed || pendingUpdates.get(key) !== pending) {
                return;
            }
            pendingUpdates.delete(key);
            if (!document.isClosed && document.version === pending.version) {
                updateDiagnostics(document);
            }
        });
    };
    const onClose = (document: vscode.TextDocument) => {
        if (disposed) {
            return;
        }
        const key = document.uri.toString();
        if (pendingUpdates.get(key)?.document === document) {
            scheduler.cancel(key);
            pendingUpdates.delete(key);
        }
        findingsCache.delete(document);
        diagnostics.delete(document.uri);
    };

    for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(document);
    }

    return [
        new vscode.Disposable(() => {
            disposed = true;
            scheduler.dispose();
            pendingUpdates.clear();
            findingsCache.dispose();
            diagnostics.dispose();
        }),
        vscode.workspace.onDidOpenTextDocument(onOpen),
        vscode.workspace.onDidChangeTextDocument(event => onChange(event.document)),
        vscode.workspace.onDidCloseTextDocument(onClose),
        vscode.languages.registerCodeActionsProvider(
            documentSelector,
            new Hoi4LintCodeActionProvider(findingsCache),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, fixAllKind] },
        ),
    ];
}

export class Hoi4LintCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly findingsCache = new Hoi4LintFindingsCache()) {}

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        if (document.isClosed || token.isCancellationRequested || isHoi4VanillaFileSkipped(document)) {
            return [];
        }

        const version = document.version;
        const findings = this.findingsCache.get(document);
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

        return document.isClosed || token.isCancellationRequested || document.version !== version ? [] : actions;
    }
}

class Hoi4LintFindingsCache implements vscode.Disposable {
    private readonly entries = new Map<string, { document: vscode.TextDocument; version: number; findings: Hoi4LintFinding[] }>();
    private disposed = false;

    public get(document: vscode.TextDocument): Hoi4LintFinding[] {
        if (this.disposed || document.isClosed) {
            return [];
        }
        const key = document.uri.toString();
        const version = document.version;
        const cached = this.entries.get(key);
        if (cached?.document === document && cached.version === version) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            return cached.findings;
        }

        const findings = collectHoi4LintFindings(document.getText(), uriToFilePathWhenPossible(document.uri));
        if (this.disposed || document.isClosed || document.version !== version) {
            return [];
        }
        this.entries.delete(key);
        this.entries.set(key, { document, version, findings });
        if (this.entries.size > maxCachedDocuments) {
            this.entries.delete(this.entries.keys().next().value!);
        }
        return findings;
    }

    public delete(document: vscode.TextDocument): void {
        const key = document.uri.toString();
        if (this.entries.get(key)?.document === document) {
            this.entries.delete(key);
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.entries.clear();
    }
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
