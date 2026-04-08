import * as assert from 'assert';
import * as vscode from 'vscode';
import { Commands, ViewType, WebviewType } from '../../src/constants';
import { waitFor } from '../testUtils';

function hasPreviewTab(viewType: string, labelPrefix?: string): boolean {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .some(tab => {
            const normalizedLabel = tab.label.toLowerCase();
            const normalizedPrefix = labelPrefix?.toLowerCase();
            const labelMatches = !labelPrefix
                || normalizedLabel.startsWith(normalizedPrefix ?? '')
                || (viewType === WebviewType.PreviewWorldMap && normalizedLabel.includes('world map'));
            return labelMatches && (
                (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === viewType)
                || (viewType === WebviewType.Preview && tab.label.startsWith('HOI4: '))
                || (viewType === WebviewType.PreviewWorldMap && normalizedLabel.includes('world map'))
            );
        });
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
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_events.txt'), 30000);
    });

    test('opens a technology preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'technologies', 'sample_technology.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_technology.txt'), 30000);
    });

    test('opens a focus preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'national_focus', 'preset-smoke.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: preset-smoke.txt'), 30000);
    });

    test('opens a gui preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'interface', 'sample.gui');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample.gui'), 30000);
    });

    test('opens a gfx preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'interface', 'sample.gfx');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample.gfx'), 30000);
    });

    test('opens a mio preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'military_industrial_organization', 'organizations', 'sample_mio.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_mio.txt'), 30000);
    });

    test('opens a mio preview webview for an off-path MIO fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'misc', 'sample_mio_preview.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_mio_preview.txt'), 30000);
    });

    test('opens the world map preview panel', async () => {
        await vscode.commands.executeCommand(Commands.PreviewWorld);
        await waitFor(() => hasPreviewTab(WebviewType.PreviewWorldMap, 'Preview World Map'), 30000);
    });

    test('opens the TGA custom editor provider', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'gfx', 'broken.tga');
        await vscode.commands.executeCommand('vscode.openWith', fixtureUri, ViewType.TGA);

        await waitFor(() => hasCustomEditorTab(ViewType.TGA, fixtureUri));
    });

    test('opens the DDS custom editor provider', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'gfx', 'broken.dds');
        await vscode.commands.executeCommand('vscode.openWith', fixtureUri, ViewType.DDS);

        await waitFor(() => hasCustomEditorTab(ViewType.DDS, fixtureUri));
    });
});
