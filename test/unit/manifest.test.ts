import * as assert from 'assert';
import manifest from '../../package.json';
import defaultBundle from '../../l10n/bundle.l10n.json';
import koreanBundle from '../../l10n/bundle.l10n.ko.json';
import russianBundle from '../../l10n/bundle.l10n.ru.json';
import chineseBundle from '../../l10n/bundle.l10n.zh-cn.json';
import packageNls from '../../package.nls.json';

describe('extension manifest', () => {
    it('contributes workspace formatting with translated UI messages', () => {
        const command = manifest.contributes.commands.find(entry => entry.command === 'server.hoi4modutilities.formatWorkspace');
        assert.ok(command);
        assert.strictEqual(command.enablement, 'workspaceFolderCount > 0');
        for (const message of [
            'Format Workspace HOI4 Files',
            'Open a workspace folder to format HOI4 files.',
            'Failed to find workspace HOI4 files: {0}',
            'Workspace formatting: {0} changed, {1} unchanged, {2} failed. Changes are not saved automatically.',
            'Formatting cancelled. {0}',
        ]) {
            for (const bundle of [defaultBundle, koreanBundle, russianBundle, chineseBundle]) {
                assert.ok((bundle as Record<string, string>)[message]);
            }
        }
    });

    it('contributes workspace logging with translated UI messages', () => {
        const command = manifest.contributes.commands
            .find(entry => entry.command === 'server.hoi4modutilities.updateWorkspaceLogging');
        assert.ok(command);
        assert.strictEqual(command.enablement, 'workspaceFolderCount > 0');
        assert.strictEqual(command.title, '%hoi4modutilities.updateWorkspaceLogging.title%');
        for (const message of [
            'Open a workspace folder to insert or update HOI4 logs.',
            'Insert and Update Workspace Logs',
            'Failed to find workspace HOI4 logging files: {0}',
            'Workspace logging: {0} files changed ({1} logs inserted, {2} updated), {3} unchanged, {4} failed. Changes are not saved automatically.',
            'Logging update cancelled. {0}',
        ]) {
            for (const bundle of [defaultBundle, koreanBundle, russianBundle, chineseBundle]) {
                assert.ok((bundle as Record<string, string>)[message]);
            }
        }
    });

    it('uses contextual activation with runtime l10n metadata', () => {
        assert.ok(!manifest.activationEvents.includes('onStartupFinished'));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onLanguage:')));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onCommand:')));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onCustomEditor:')));
        assert.deepStrictEqual(manifest.extensionKind, ['workspace']);
        assert.strictEqual(manifest.l10n, './l10n');
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/**/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/national_focus/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/technologies/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:events/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:events/**/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:history/**/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:country_metadata/**/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:interface/**/*.gui'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:interface/**/*.gfx'));
    });

    it('shows the preview entry only for previewable file-like editor resources', () => {
        const editorTitlePreviewEntries = manifest.contributes.menus['editor/title']
            .filter(entry => entry.command === 'server.hoi4modutilities.preview');

        assert.strictEqual(editorTitlePreviewEntries.length, 1);
        assert.strictEqual(editorTitlePreviewEntries[0].when, 'server.shouldShowHoi4PreviewTitle');
    });

    it('keeps the preview command disabled unless the active resource is previewable', () => {
        const command = manifest.contributes.commands
            .find(entry => entry.command === 'server.hoi4modutilities.preview');

        assert.ok(command);
        assert.strictEqual(command.enablement, 'isFileSystemResource && server.shouldShowHoi4Preview');
    });

    it('contributes the focus GFX shine generator command', () => {
        const command = manifest.contributes.commands
            .find(entry => entry.command === 'server.hoi4modutilities.generateFocusGfxShine');

        assert.ok(command);
        assert.strictEqual(command.title, '%hoi4modutilities.generateFocusGfxShine.title%');
        assert.strictEqual(command.icon, '$(sparkle)');
    });

    it('contributes the flag resize command', () => {
        const command = manifest.contributes.commands
            .find(entry => entry.command === 'server.hoi4modutilities.resizeFlags');

        assert.ok(command);
        assert.strictEqual(command.title, '%hoi4modutilities.resizeFlags.title%');
        assert.strictEqual(command.icon, '$(symbol-color)');
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
        assert.ok(previewEntry.when?.includes('isFileSystemResource'));
        assert.ok(previewEntry.when?.includes('server.shouldShowHoi4Preview'));
        assert.ok(!previewEntry.when?.includes('!server.hoi4MULoaded'));
        assert.strictEqual(entryByCommand['server.hoi4modutilities.previewworld'].group, '1_preview@2');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.generateFocusGfxShine'].group, '2_tools@1');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.resizeFlags'].group, '2_tools@2');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.scanreferences'].group, '2_tools@3');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.formatWorkspace'].group, '2_tools@4');
        assert.strictEqual(entryByCommand['server.hoi4modutilities.updateWorkspaceLogging'].group, '2_tools@5');
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

    it('keeps feature flags empty because preview indexes are default-on in code', () => {
        const featureFlags = manifest.contributes.configuration[0].properties['hoi4ModUtilities.featureFlags'];

        assert.deepStrictEqual(featureFlags.default, []);
    });

    it('contributes workspace-scoped formatter ignore patterns', () => {
        const ignoreFiles = manifest.contributes.configuration[0].properties['hoi4ModUtilities.formatter.ignoreFiles'];

        assert.strictEqual(ignoreFiles.type, 'array');
        assert.strictEqual(ignoreFiles.scope, 'resource');
        assert.strictEqual(ignoreFiles.uniqueItems, true);
        assert.deepStrictEqual(ignoreFiles.default, []);
        assert.strictEqual(ignoreFiles.items.type, 'string');
    });

    it('contributes a workspace-scoped vanilla file toggle that is on by default', () => {
        const skipVanillaFiles = manifest.contributes.configuration[0].properties['hoi4ModUtilities.skipVanillaFiles'];

        assert.strictEqual(skipVanillaFiles.type, 'boolean');
        assert.strictEqual(skipVanillaFiles.scope, 'resource');
        assert.strictEqual(skipVanillaFiles.default, true);
    });

    it('defines every manifest localisation token in the default package bundle', () => {
        const tokens = JSON.stringify(manifest).matchAll(/%([^%]+)%/g);
        const keys = new Set(Array.from(tokens, match => match[1]));

        assert.ok(keys.size > 0);
        for (const key of keys) {
            assert.ok(key in packageNls, `missing default package localisation for ${key}`);
        }
    });

    it('localises the technology graph editor controls in every maintained bundle', () => {
        const messages = [
            'Toggle technology graph editing',
            'Applying…',
            'Select Path target',
            'Select XOR target',
            'Select an empty grid position',
            '{0} selected',
            'Link Path',
            'Link XOR',
            'Create Child',
            'Delete',
            'Position is occupied or outside the grid',
            'Technology ID',
            'VS Code refused the technology edit.',
        ] as const;
        const translatedBundles = [koreanBundle, russianBundle, chineseBundle];
        for (const message of messages) {
            assert.strictEqual(defaultBundle[message], message);
            for (const bundle of translatedBundles) {
                assert.ok(bundle[message]);
                assert.notStrictEqual(bundle[message], message);
            }
        }
    });
});
