import * as vscode from 'vscode';
import { contextContainer } from '../../context';
import { localize } from '../../util/i18n';
import { matchPathEnd } from '../../util/nodecommon';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { PreviewDescriptor } from '../descriptor';
import { findDocumentRegexPreviewPriority } from '../previewdetect';
import { PreviewBase } from '../previewbase';
import { normalizeConditionPresetsByTree, FocusConditionPresetsByTree } from './conditionpresets';
import { FocusTreeEditCommandHandler } from './edithandler';
import { FocusTreeLoader } from './loader';
import {
    FocusPositionEditMessage,
} from './positioneditcommon';
import { FocusTreePreviewSession } from './previewsession';

const focusConditionPresetsStateKeyPrefix = 'focusTree.conditionPresets.v1:';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    const lowerUri = uri.toString().toLowerCase();
    const lowerPath = uri.path.toLowerCase();
    if (!lowerPath.endsWith('.txt')) {
        return undefined;
    }

    if (matchPathEnd(lowerUri, ['common', 'national_focus', '*'])) {
        return 0;
    }

    return findDocumentRegexPreviewPriority(document, /(focus_tree|shared_focus|joint_focus)\s*=\s*{/);
}

export class FocusTreePreview extends PreviewBase {
    private readonly relativeFilePath: string;
    private readonly session: FocusTreePreviewSession;
    private readonly editCommandHandler: FocusTreeEditCommandHandler;
    private persistedConditionPresetsByTree: FocusConditionPresetsByTree;
    private latestDiagnostics: unknown;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.relativeFilePath = getRelativePathInWorkspace(this.uri);
        const focusTreeLoader = new FocusTreeLoader(this.relativeFilePath);
        this.persistedConditionPresetsByTree = this.getStoredConditionPresetsByTree();
        this.session = new FocusTreePreviewSession({
            uri: this.uri,
            webview: this.panel.webview,
            focusTreeLoader,
            getConditionPresetsByTree: () => this.persistedConditionPresetsByTree,
            updateDependencies: dependencies => this.updateDependencies(dependencies),
        });
        this.editCommandHandler = new FocusTreeEditCommandHandler({
            uri: this.uri,
            relativeFilePath: this.relativeFilePath,
            webview: this.panel.webview,
            session: this.session,
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        return this.session.renderShell(document.version);
    }

    public override async initializePanelContent(document: vscode.TextDocument): Promise<void> {
        await this.session.initializePanel(document);
    }

    public override getDocumentChangeDebounceMs(): number {
        return 150;
    }

    public override async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        await this.session.refreshDocument(document);
    }

    public override getDebugState(): unknown {
        return {
            uri: this.uri.toString(),
            session: this.session.getDebugState(),
            diagnostics: this.latestDiagnostics,
        };
    }

    protected async onDidReceiveMessage(msg: FocusPositionEditMessage): Promise<boolean> {
        const command = (msg as { command?: string }).command;
        if (command === 'focusTreeWebviewReady') {
            this.session.handleWebviewReady();
            return true;
        }

        if (command === 'focusTreeDiagnostics') {
            this.latestDiagnostics = (msg as { snapshot?: unknown }).snapshot;
            return true;
        }

        if (command === 'promptFocusConditionPresetName') {
            await this.resolveConditionPresetName((msg as { initialValue?: string }).initialValue);
            return true;
        }

        if (command === 'persistFocusConditionPresets') {
            await this.persistConditionPresets((msg as { presetsByTree: FocusConditionPresetsByTree }).presetsByTree);
            return true;
        }

        return this.editCommandHandler.handleMessage(msg);
    }

    private async resolveConditionPresetName(initialValue?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: localize('TODO', 'Preset name'),
            value: initialValue ?? '',
            ignoreFocusOut: true,
        });

        await this.panel.webview.postMessage({
            command: 'focusConditionPresetNameResolved',
            name,
        });
    }

    private async persistConditionPresets(presetsByTree: FocusConditionPresetsByTree): Promise<void> {
        this.persistedConditionPresetsByTree = normalizeConditionPresetsByTree(presetsByTree);
        await this.storeConditionPresetsByTree(this.persistedConditionPresetsByTree);
    }

    private getConditionPresetsStateKey(): string {
        return `${focusConditionPresetsStateKeyPrefix}${this.relativeFilePath}`;
    }

    private getStoredConditionPresetsByTree(): FocusConditionPresetsByTree {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return {};
        }

        return normalizeConditionPresetsByTree(
            workspaceState.get(this.getConditionPresetsStateKey()) as FocusConditionPresetsByTree | undefined,
        );
    }

    private async storeConditionPresetsByTree(conditionPresetsByTree: FocusConditionPresetsByTree): Promise<void> {
        const workspaceState = contextContainer.current?.workspaceState;
        if (!workspaceState) {
            return;
        }

        const hasEntries = Object.keys(conditionPresetsByTree).length > 0;
        await workspaceState.update(this.getConditionPresetsStateKey(), hasEntries ? conditionPresetsByTree : undefined);
    }
}

export const focusTreePreviewDef: PreviewDescriptor = {
    kind: 'panel',
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    createPreview: (uri, panel) => new FocusTreePreview(uri, panel),
    panelOptions: {
        retainContextWhenHidden: true,
    },
};
