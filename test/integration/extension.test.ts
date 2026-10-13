import * as assert from 'assert';
import * as vscode from 'vscode';
import { Commands, ViewType, WebviewType } from '../../src/constants';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { buildFocusPositionWorkspaceEdit } from '../../src/previewdef/focustree/positioneditservice';
import { collectTechnologyFileMetadata } from '../../src/previewdef/technology/editmetadata';
import { buildTechnologyPositionTextChanges } from '../../src/previewdef/technology/editservice';
import { buildTechnologyWorkspaceEdit } from '../../src/previewdef/technology/editworkspace';
import { getMiosFromFile } from '../../src/previewdef/mio/schema';
import { buildMioWorkspaceEdit } from '../../src/previewdef/mio/editworkspace';
import { isHoi4FormatterIgnored } from '../../src/util/formatterIgnore';
import { waitFor } from '../testUtils';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { RustComputeService } from '../../src/util/compute/service';
import { CompressFormat } from '../../src/util/image/dds/pixelformat';
import { compressedSurface } from '../computeFixtures';

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
    selectedFocusTreeIndex?: number;
    selectorValue?: string;
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

async function waitForFocusPreviewState(uri: vscode.Uri, expected: {
    treeId: string;
    treeCount: number;
    focusCount: number;
}): Promise<FocusPreviewDiagnostics> {
    let diagnostics: FocusPreviewDiagnostics | undefined;
    await waitFor(async () => {
        const debugState = await vscode.commands.executeCommand(Commands.DebugFocusTreePreviewState, uri) as {
            diagnostics?: FocusPreviewDiagnostics;
            webviewTimings?: FocusPreviewWebviewTiming[];
        } | undefined;
        diagnostics = debugState?.diagnostics;
        const timings = debugState?.webviewTimings ?? [];

        return diagnostics?.currentFocusTreeId === expected.treeId
            && diagnostics?.selectedFocusTreeId === expected.treeId
            && diagnostics?.selectorOptionCount === expected.treeCount
            && diagnostics?.selectorSelectedText === expected.treeId
            && diagnostics?.focusCount === expected.focusCount
            && diagnostics?.focusGridBoxItemCount === expected.focusCount
            && diagnostics?.renderedFocusHitCount === expected.focusCount
            && (diagnostics?.currentCanvasWidth ?? 0) > 0
            && (diagnostics?.currentCanvasHeight ?? 0) > 0
            && timings.some(timing => timing.stage === 'firstScenePainted'
                && (timing.payloadBytes ?? -1) >= 0
                && (timing.sinceLoadMs ?? -1) >= 0);
    }, 30000).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nLast focus diagnostics: ${JSON.stringify(diagnostics)}`);
    });
    assert.ok(diagnostics);
    return diagnostics;
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
            Commands.FormatWorkspace,
            Commands.UpdateWorkspaceLogging,
            Commands.SelectModFile,
            Commands.SelectHoiFolder,
        ]) {
            assert.ok(commands.includes(command), `expected command ${command} to be registered`);
        }
    });

    test('runs the packaged Rust DDS worker inside the VS Code extension host', async () => {
        const extension = vscode.extensions.getExtension('server.hoi4modutilities');
        assert.ok(extension);
        const service = new RustComputeService({
            workerPath: path.join(extension.extensionPath, 'dist', 'compute-worker.js'),
            wasmPath: path.join(extension.extensionPath, 'dist', 'hoi4_compute.wasm'),
            minimumPixels: 0,
        });
        try {
            const surface = compressedSurface(512, 512, CompressFormat.bc3);
            const result = await service.run({ kind: 'dds', bytes: surface.getPixelData(), width: 512, height: 512, pixelFormat: surface.pixelFormat });
            assert.ok(result?.pngBytes, 'Rust worker must execute, not silently fall back');
            assert.strictEqual(result.engine, 'rust-wasm');
            const png = new PNG({ width: 512, height: 512 });
            png.data = Buffer.from(surface.getFullRgba());
            assert.deepStrictEqual(Buffer.from(result.pngBytes), PNG.sync.write(png));
        } finally { service.dispose(); }
    });

    test('skips vanilla-derived folders while vanilla file skipping is on by default', () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        // Glob matching only reads the URI, so the paths do not need fixture files.
        const isIgnored = (relativePath: string) => isHoi4FormatterIgnored({
            uri: vscode.Uri.joinPath(workspaceRoot!, ...relativePath.split('/')),
            languageId: 'plaintext',
        } as vscode.TextDocument);

        for (const relativePath of [
            'interface/sample.gfx',
            'interface/countrytechtreeview.gui',
            'gfx/entities/infantry.gfx',
            'common/names/00_names.txt',
            'common/occupation_laws/occupation_laws.txt',
            'common/special_projects/projects/nuclear_projects.txt',
            'common/technologies/sample_technology.txt',
            'common/units/infantry.txt',
            'common/units/equipment/infantry.txt',
            'common/units/names/00_names.txt',
            'common/units/names_railway_guns/ger_names_railway_guns.txt',
            'history/states/1-France.txt',
        ]) {
            assert.strictEqual(isIgnored(relativePath), true, `expected ${relativePath} to be ignored`);
        }

        for (const relativePath of [
            'events/sample_events.txt',
            'common/ideas/sample_ideas.txt',
            'common/units/names_divisions/GER_names_divisions.txt',
            'common/units/names_ships/GER_names_ships.txt',
            'history/countries/GER - Germany.txt',
            'history/units/GER_1936.txt',
        ]) {
            assert.strictEqual(isIgnored(relativePath), false, `expected ${relativePath} to be formatted`);
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

    test('applies a MIO position edit as one undoable workspace edit', async () => {
        const original = `sample_mio = {
    trait = {
        token = sample_trait
        position = { x = 1 y = 2 }
    }
}`;
        const document = await vscode.workspace.openTextDocument({ language: 'hoi4', content: original });
        await vscode.window.showTextDocument(document);
        const mio = getMiosFromFile(parseHoi4File(original), [], 'common/military_industrial_organization/undo.txt')[0];
        const result = buildMioWorkspaceEdit(document, {
            command: 'applyMioPositionEdits',
            requestId: 'integration-test',
            documentVersion: document.version,
            mioId: mio.id,
            edits: [{ traitId: 'sample_trait', x: 4, y: 5, absoluteX: 4, absoluteY: 5 }],
        }, mio);
        assert.ifError(result.error);
        assert.ok(result.edit);
        assert.strictEqual(await vscode.workspace.applyEdit(result.edit!), true);
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

    test('reopens the authored multi-tree focus preview with identical selection and rendered counts', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(workspaceRoot);

        const fixtureUri = vscode.Uri.joinPath(workspaceRoot!, 'common', 'national_focus', 'multi-tree-preview.txt');
        const document = await vscode.workspace.openTextDocument(fixtureUri);
        await vscode.window.showTextDocument(document);
        const expected = {
            treeId: 'fixture_workshop_tree',
            treeCount: 3,
            focusCount: 3,
        };

        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: multi-tree-preview.txt'), 30000);
        const before = await waitForFocusPreviewState(fixtureUri, expected);
        const previewTab = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .find(tab => tab.label === 'HOI4: multi-tree-preview.txt' && tab.input instanceof vscode.TabInputWebview);
        assert.ok(previewTab, 'expected the focus preview tab to close');
        assert.strictEqual(await vscode.window.tabGroups.close(previewTab), true);
        await waitFor(() => !hasPreviewTab(WebviewType.Preview, 'HOI4: multi-tree-preview.txt'), 10000);

        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(Commands.Preview);
        await waitFor(() => hasPreviewTab(WebviewType.Preview, 'HOI4: multi-tree-preview.txt'), 30000);
        const after = await waitForFocusPreviewState(fixtureUri, expected);
        for (const key of [
            'currentFocusTreeId',
            'selectedFocusTreeId',
            'selectedFocusTreeIndex',
            'selectorValue',
            'selectorOptionCount',
            'selectorSelectedText',
            'focusCount',
            'focusGridBoxItemCount',
            'renderedFocusHitCount',
            'currentCanvasWidth',
            'currentCanvasHeight',
        ] as const) {
            assert.strictEqual(after[key], before[key], `expected ${key} to remain stable after reopening`);
        }
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
