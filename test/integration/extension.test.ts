import * as assert from 'assert';
import * as vscode from 'vscode';
import { Commands, ViewType, WebviewType } from '../../src/constants';
import {
    FocusConditionPresetTestSnapshot,
    FocusTreePreview,
} from '../../src/previewdef/focustree';
import { previewManager } from '../../src/previewdef/previewmanager';
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

function getPreview(uri: vscode.Uri): FocusTreePreview | undefined {
    return (previewManager as any)._previews[uri.toString()] as FocusTreePreview | undefined;
}

function getPresetByName(snapshot: FocusConditionPresetTestSnapshot, name: string) {
    return snapshot.presets.find(preset => preset.name === name);
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

    test('saves, reapplies, and deletes focus condition presets in VS Code runtime', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'national_focus', 'preset-smoke.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview), 30000);
        await waitFor(() => !!getPreview(fixtureUri), 30000);

        const preview = getPreview(fixtureUri);
        assert.ok(preview);

        const initialSnapshot = await preview!.runConditionPresetTestAction('snapshot');
        assert.strictEqual(initialSnapshot.treeId, 'preset_smoke_tree');
        assert.ok(initialSnapshot.availableExprKeys.length >= 2, 'expected at least two selectable condition expressions');

        const [firstExprKey, secondExprKey] = initialSnapshot.availableExprKeys;
        const selectedSnapshot = await preview!.runConditionPresetTestAction('selectConditions', {
            exprKeys: [firstExprKey],
        });
        assert.deepStrictEqual(selectedSnapshot.selectedExprKeys, [firstExprKey]);
        assert.strictEqual(selectedSnapshot.selectedPresetId, undefined);

        const savedSnapshot = await preview!.runConditionPresetTestAction('savePreset', {
            name: 'Runtime Smoke',
        });
        const savedPreset = getPresetByName(savedSnapshot, 'Runtime Smoke');
        assert.ok(savedPreset, 'expected saved preset to be present');
        assert.deepStrictEqual(savedPreset!.exprKeys, [firstExprKey]);
        assert.strictEqual(savedSnapshot.selectedPresetId, savedPreset!.id);

        const customSnapshot = await preview!.runConditionPresetTestAction('selectConditions', {
            exprKeys: [secondExprKey],
        });
        assert.deepStrictEqual(customSnapshot.selectedExprKeys, [secondExprKey]);
        assert.strictEqual(customSnapshot.selectedPresetId, undefined);

        const appliedSnapshot = await preview!.runConditionPresetTestAction('applyPreset', {
            presetId: savedPreset!.id,
        });
        assert.deepStrictEqual(appliedSnapshot.selectedExprKeys, [firstExprKey]);
        assert.strictEqual(appliedSnapshot.selectedPresetId, savedPreset!.id);

        const deletedSnapshot = await preview!.runConditionPresetTestAction('deletePreset');
        assert.strictEqual(getPresetByName(deletedSnapshot, 'Runtime Smoke'), undefined);
        assert.strictEqual(deletedSnapshot.selectedPresetId, undefined);
        assert.deepStrictEqual(deletedSnapshot.selectedExprKeys, [firstExprKey]);
    });
});
