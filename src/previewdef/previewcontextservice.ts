import * as vscode from 'vscode';
import { basename, getDocumentByUri } from '../util/vsccommon';
import { ContextName } from '../constants';
import { setVscodeContext } from '../context';
import { debug } from '../util/debug';
import type { PreviewProviderResolver } from './previewproviderresolver';

export class PreviewContextService {
    constructor(
        private readonly previewProviderResolver: PreviewProviderResolver,
    ) {}

    public register(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];
        disposables.push(vscode.window.onDidChangeActiveTextEditor(this.safeUpdateHoi4PreviewContextValue, this));
        disposables.push(vscode.window.onDidChangeVisibleTextEditors(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));
        disposables.push(vscode.window.tabGroups.onDidChangeTabGroups(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));
        disposables.push(vscode.window.tabGroups.onDidChangeTabs(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));
        disposables.push(vscode.workspace.onDidOpenTextDocument(() => this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor)));

        this.safeUpdateHoi4PreviewContextValue(vscode.window.activeTextEditor);
        return vscode.Disposable.from(...disposables);
    }

    public safeUpdateHoi4PreviewContextValue(textEditor: vscode.TextEditor | undefined): void {
        try {
            this.updateHoi4PreviewContextValue(textEditor);
        } catch {
            debug(`Failed to update preview context for ${textEditor?.document.uri.toString() ?? '<no editor>'}`);
            setVscodeContext(ContextName.ShouldShowHoi4Preview, false);
            setVscodeContext(ContextName.ShouldHideHoi4Preview, false);
            setVscodeContext(ContextName.ShouldShowHoi4PreviewTitle, false);
            setVscodeContext(ContextName.ShouldShowFocusGfxShine, false);
            setVscodeContext(ContextName.Hoi4PreviewType, '');
        }
    }

    public clearPreviewContext(): void {
        this.updateHoi4PreviewContextValue(undefined);
    }

    private updateHoi4PreviewContextValue(textEditor: vscode.TextEditor | undefined): void {
        let shouldShowPreviewButton = false;
        let shouldShowPreviewTitleButton = false;
        let shouldShowFocusGfxShine = false;
        let hoi4PreviewType = '';
        const activeDocument = this.resolveActivePreviewContextDocument(textEditor);
        if (activeDocument) {
            const provider = this.previewProviderResolver.find(activeDocument);
            if (provider) {
                shouldShowPreviewButton = true;
                shouldShowPreviewTitleButton = this.canShowPreviewTitleButton(activeDocument);
                hoi4PreviewType = provider.type;
            }

            shouldShowFocusGfxShine = this.canShowFocusGfxShine(activeDocument);
        }

        setVscodeContext(ContextName.ShouldShowHoi4Preview, shouldShowPreviewButton);
        setVscodeContext(ContextName.ShouldHideHoi4Preview, !shouldShowPreviewButton);
        setVscodeContext(ContextName.ShouldShowHoi4PreviewTitle, shouldShowPreviewTitleButton);
        setVscodeContext(ContextName.ShouldShowFocusGfxShine, shouldShowFocusGfxShine);
        setVscodeContext(ContextName.Hoi4PreviewType, hoi4PreviewType);
    }

    private resolveActivePreviewContextDocument(textEditor: vscode.TextEditor | undefined): vscode.TextDocument | undefined {
        if (!textEditor) {
            return undefined;
        }

        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!activeTab) {
            return undefined;
        }

        const activeTabUri = this.getActiveTabUri(activeTab.input);
        if (!activeTabUri || !this.canUsePreviewContextUri(activeTabUri)) {
            return undefined;
        }

        if (textEditor.document.uri.toString() === activeTabUri.toString()) {
            return textEditor.document;
        }

        return getDocumentByUri(activeTabUri);
    }

    private canShowFocusGfxShine(document: vscode.TextDocument): boolean {
        if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
            return false;
        }

        const lowerBasename = basename(document.uri).toLowerCase();
        return lowerBasename.endsWith('.gfx') && lowerBasename.includes('goals');
    }

    private canShowPreviewTitleButton(document: vscode.TextDocument): boolean {
        if (document.uri.scheme !== 'file') {
            return false;
        }

        const lowerBasename = basename(document.uri).toLowerCase();
        return !(lowerBasename.endsWith('.gfx') && lowerBasename.includes('goals'));
    }

    private canUsePreviewContextUri(uri: vscode.Uri): boolean {
        return uri.scheme === 'file' || uri.scheme === 'untitled';
    }

    private getActiveTabUri(input: unknown): vscode.Uri | undefined {
        if (input instanceof vscode.TabInputText) {
            return input.uri;
        }

        const candidate = input as { uri?: vscode.Uri } | undefined;
        if (candidate?.uri && typeof candidate.uri.toString === 'function') {
            return candidate.uri;
        }

        return undefined;
    }
}
