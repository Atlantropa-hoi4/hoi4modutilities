import * as assert from 'assert';
import * as vscode from 'vscode';
import { Commands, ViewType, WebviewType } from '../../src/constants';
import { waitFor } from '../testUtils';

function hasPreviewTab(viewType: string): boolean {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .some(tab => (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === viewType)
            || tab.label.startsWith('HOI4: '));
}

function hasCustomEditorTab(viewType: string, uri: vscode.Uri): boolean {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .some(tab => tab.input instanceof vscode.TabInputCustom &&
            tab.input.viewType === viewType &&
            tab.input.uri.toString() === uri.toString());
}

suite('extension smoke', () => {
    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('activates and registers public commands', async () => {
        const extension = vscode.extensions.getExtension('server.hoi4modutilities');
        assert.ok(extension);

        await extension?.activate();

        const commands = await vscode.commands.getCommands(true);
        for (const command of [
            Commands.Preview,
            Commands.PreviewWorld,
            Commands.ScanReferences,
            Commands.SelectModFile,
            Commands.SelectHoiFolder,
        ]) {
            assert.ok(commands.includes(command), `expected command ${command} to be registered`);
        }
    });

    test('opens an event preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'events', 'sample_events.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview), 30000);
    });

    test('opens the TGA custom editor provider', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'gfx', 'broken.tga');
        await vscode.commands.executeCommand('vscode.openWith', fixtureUri, ViewType.TGA);

        await waitFor(() => hasCustomEditorTab(ViewType.TGA, fixtureUri));
    });
});
