import * as assert from 'assert';
import manifest from '../../package.json';

describe('extension manifest', () => {
    it('uses contextual activation with runtime l10n metadata', () => {
        assert.ok(!manifest.activationEvents.includes('onStartupFinished'));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onLanguage:')));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onCommand:')));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onCustomEditor:')));
        assert.deepStrictEqual(manifest.extensionKind, ['workspace']);
        assert.strictEqual(manifest.l10n, './l10n');
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/national_focus/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/technologies/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:events/*.txt'));
    });

    it('shows the preview entry only for previewable file-like editor resources', () => {
        const editorTitlePreviewEntries = manifest.contributes.menus['editor/title']
            .filter(entry => entry.command === 'server.hoi4modutilities.preview');

        assert.strictEqual(editorTitlePreviewEntries.length, 1);
        assert.ok(editorTitlePreviewEntries[0].when.includes('resourceScheme =~ /^(file|untitled)$/'));
        assert.ok(editorTitlePreviewEntries[0].when.includes('resourceExtname =~ /^\\.(txt|gfx|gui|map)$/'));
        assert.ok(editorTitlePreviewEntries[0].when.includes('resourceFilename !~ /^.*goals.*\\.gfx$/'));
        assert.ok(editorTitlePreviewEntries[0].when.includes('server.shouldShowHoi4Preview'));
    });

    it('contributes the focus GFX shine generator command', () => {
        const command = manifest.contributes.commands
            .find(entry => entry.command === 'server.hoi4modutilities.generateFocusGfxShine');

        assert.ok(command);
        assert.strictEqual(command.title, '%hoi4modutilities.generateFocusGfxShine.title%');
    });

    it('shows the shine generator in editor title for goals gfx files', () => {
        const editorTitleEntries = manifest.contributes.menus['editor/title']
            .filter(entry => entry.command === 'server.hoi4modutilities.generateFocusGfxShine');

        assert.strictEqual(editorTitleEntries.length, 1);
        assert.strictEqual(editorTitleEntries[0].group, 'navigation');
        assert.ok(editorTitleEntries[0].when.includes('isFileSystemResource'));
        assert.ok(editorTitleEntries[0].when.includes('server.shouldShowFocusGfxShine'));
        assert.ok(!editorTitleEntries[0].when.includes('resourceFilename =~ /^.*goals.*\\.gfx$/'));
    });

    it('groups command palette entries by preview, tools, and setup flows', () => {
        const commandPaletteEntries = manifest.contributes.menus.commandPalette;
        const entryByCommand = Object.fromEntries(commandPaletteEntries.map(entry => [entry.command, entry]));
        const previewEntry = entryByCommand['server.hoi4modutilities.preview'];

        assert.ok(previewEntry);
        assert.strictEqual(previewEntry.group, '1_preview@1');
        assert.ok(!previewEntry.when?.includes('resourceExtname =~ /^\\.(txt|gfx|gui|map)$/'));
        assert.strictEqual(entryByCommand['server.hoi4modutilities.previewworld'].group, '1_preview@2');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.generateFocusGfxShine'].group, '2_tools@1');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.scanreferences'].group, '2_tools@2');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.selectmodfile'].group, '3_setup@1');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.selecthoifolder'].group, '3_setup@2');
    });

    it('keeps the shine generator discoverable in the command palette behind its execution context', () => {
        const shineEntry = manifest.contributes.menus.commandPalette
            .find(entry => entry.command === 'server.hoi4modutilities.generateFocusGfxShine');

        assert.ok(shineEntry);
        assert.strictEqual(shineEntry.group, '2_tools@1');
        assert.ok(shineEntry.when);
        assert.ok(shineEntry.when.includes('server.shouldShowFocusGfxShine'));
    });
});
