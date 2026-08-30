import * as assert from 'assert';
import * as vscode from 'vscode';
import { Commands, ViewType, WebviewType } from '../../src/constants';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { buildFocusPositionWorkspaceEdit } from '../../src/previewdef/focustree/positioneditservice';
import { collectTechnologyFileMetadata } from '../../src/previewdef/technology/editmetadata';
import { buildTechnologyPositionTextChanges } from '../../src/previewdef/technology/editservice';
import { buildTechnologyWorkspaceEdit } from '../../src/previewdef/technology/editworkspace';
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

type FocusPreviewDiagnostics = {
    currentFocusTreeId?: string;
    selectedFocusTreeId?: string;
    selectorOptionCount?: number;
    selectorSelectedText?: string;
    focusCount?: number;
    focusGridBoxItemCount?: number;
    renderedFocusHitCount?: number;
    currentCanvasWidth?: number;
    currentCanvasHeight?: number;
};

type FocusPreviewWebviewTiming = {
    stage?: string;
    payloadBytes?: number;
    applyMs?: number;
    rebuildMs?: number;
    sinceLoadMs?: number;
};

async function waitForFocusPreviewState(uri: vscode.Uri, expectedTreeId: string): Promise<void> {
    await waitFor(async () => {
        const debugState = await vscode.commands.executeCommand(Commands.DebugFocusTreePreviewState, uri) as {
            diagnostics?: FocusPreviewDiagnostics;
            webviewTimings?: FocusPreviewWebviewTiming[];
        } | undefined;
        const diagnostics = debugState?.diagnostics;
        const timings = debugState?.webviewTimings ?? [];

        return diagnostics?.currentFocusTreeId === expectedTreeId
            && diagnostics?.selectedFocusTreeId === expectedTreeId
            && (diagnostics?.selectorOptionCount ?? 0) > 0
            && diagnostics?.selectorSelectedText === expectedTreeId
            && (diagnostics?.focusCount ?? 0) > 0
            && (diagnostics?.focusGridBoxItemCount ?? 0) > 0
            && (diagnostics?.renderedFocusHitCount ?? 0) > 0
            && (diagnostics?.currentCanvasWidth ?? 0) > 0
            && (diagnostics?.currentCanvasHeight ?? 0) > 0
            && timings.some(timing => timing.stage === 'firstContentApplied'
                && (timing.payloadBytes ?? 0) > 0
                && (timing.sinceLoadMs ?? -1) >= 0);
    }, 30000);
}

suite('extension smoke', () => {
    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            return;
        }

        for (const generatedShineUri of [
            vscode.Uri.joinPath(workspaceRoot, 'interface', 'sample_shine.gfx'),
            vscode.Uri.joinPath(workspaceRoot, 'interface', 'goals_shine.gfx'),
            vscode.Uri.joinPath(workspaceRoot, 'interface', 'country_goals_shine.gfx'),
        ]) {
            try {
                await vscode.workspace.fs.delete(generatedShineUri, { recursive: false, useTrash: false });
            } catch {}
        }
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
            Commands.GenerateFocusGfxShine,
            Commands.ResizeFlags,
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

    test('opens an idea preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'ideas', 'sample_ideas.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_ideas.txt'), 30000);
    });

    test('opens a decision preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'decisions', 'sample_decisions.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_decisions.txt'), 30000);
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

    test('applies a technology position edit as one undoable workspace edit', async () => {
        const original = `technologies = {
    root = {
        folder = { name = infantry position = { x = 1 y = 2 } }
    }
}`;
        const document = await vscode.workspace.openTextDocument({ language: 'hoi4', content: original });
        await vscode.window.showTextDocument(document);
        const metadata = collectTechnologyFileMetadata(parseHoi4File(original), 'common/technologies/undo.txt');
        const folder = metadata.technologies[0].folders[0];
        const result = buildTechnologyPositionTextChanges(original, 'common/technologies/undo.txt', 'infantry', [{
            technologyId: 'root',
            editKey: folder.editKey,
            x: 4,
            y: 5,
        }], {
            availableTreeRootsByFolder: { infantry: ['root'] },
            gridLayoutsByFolder: {
                infantry: {
                    root: {
                        format: 'up',
                        gridSize: { width: 500, height: 500 },
                        slotSize: { width: 50, height: 50 },
                        positionsByTechnologyId: { root: { x: 1, y: 2 } },
                    },
                },
            },
        });
        const workspaceEdit = buildTechnologyWorkspaceEdit(document, result);
        assert.ifError(workspaceEdit.error);
        assert.ok(workspaceEdit.edit);
        assert.strictEqual(await vscode.workspace.applyEdit(workspaceEdit.edit!), true);
        assert.match(document.getText(), /position = \{ x = 4 y = 5 \}/);

        await vscode.commands.executeCommand('undo');
        await waitFor(() => document.getText() === original, 5000);
        assert.strictEqual(document.getText(), original);
    });

    test('opens a character preview webview for a representative fixture', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'characters', 'sample_characters.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: sample_characters.txt'), 30000);
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

    test('applies a focus position edit as one undoable workspace edit', async () => {
        const original = `focus_tree = {
    id = undo
    focus = {
        id = ROOT
        x = 1
        y = 2
    }
}`;
        const document = await vscode.workspace.openTextDocument({ language: 'hoi4', content: original });
        await vscode.window.showTextDocument(document);
        const result = buildFocusPositionWorkspaceEdit(document, 'ROOT', 4, 5);
        assert.ifError(result.error);
        assert.ok(result.edit);
        assert.strictEqual(await vscode.workspace.applyEdit(result.edit!), true);
        assert.match(document.getText(), /id = ROOT[\s\S]*?x = 4[\s\S]*?y = 5/);

        await vscode.commands.executeCommand('undo');
        await waitFor(() => document.getText() === original, 5000);
        assert.strictEqual(document.getText(), original);
    });

    test('opens the GXC focus preview and resolves a non-empty current tree', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'GXC focus (Liangguang).txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: GXC focus (Liangguang).txt'), 30000);
        await waitForFocusPreviewState(fixtureUri, 'GXC_focus_tree');
    });

    test('reopens the GXC focus preview and keeps the current tree diagnostics stable', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'GXC focus (Liangguang).txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: GXC focus (Liangguang).txt'), 30000);
        await waitForFocusPreviewState(fixtureUri, 'GXC_focus_tree');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: GXC focus (Liangguang).txt'), 30000);
        await waitForFocusPreviewState(fixtureUri, 'GXC_focus_tree');
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

    test('generates a shine gfx file from a goals-like gfx filename', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const sourceUri = vscode.Uri.joinPath(workspaceRoot!, 'interface', 'country_goals.gfx');
        const targetUri = vscode.Uri.joinPath(workspaceRoot!, 'interface', 'country_goals_shine.gfx');
        const document = await vscode.workspace.openTextDocument(sourceUri);
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(Commands.GenerateFocusGfxShine);
        await waitFor(async () => {
            try {
                await vscode.workspace.fs.stat(targetUri);
                return true;
            } catch {
                return false;
            }
        }, 30000);

        const generated = await vscode.workspace.openTextDocument(targetUri);
        const firstContent = generated.getText();
        assert.match(firstContent, /name = "GFX_country_goal_sample_shine"/);
        assert.match(firstContent, /effectFile = "gfx\/FX\/buttonstate\.lua"/);
        assert.strictEqual((firstContent.match(/name = "GFX_country_goal_sample_shine"/g) ?? []).length, 1);

        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(Commands.GenerateFocusGfxShine);

        const regenerated = await vscode.workspace.openTextDocument(targetUri);
        const secondContent = regenerated.getText();
        assert.strictEqual(secondContent, firstContent);
        assert.strictEqual((secondContent.match(/name = "GFX_country_goal_sample_shine"/g) ?? []).length, 1);

        await vscode.window.showTextDocument(regenerated);
        await vscode.commands.executeCommand('undo');
        await waitFor(async () => {
            try {
                await vscode.workspace.fs.stat(targetUri);
                return false;
            } catch {
                return true;
            }
        }, 5000);
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
