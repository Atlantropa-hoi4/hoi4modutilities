import * as assert from 'assert';
import manifest from '../../package.json';

describe('extension manifest', () => {
    it('uses contextual activation with runtime l10n metadata', () => {
        assert.ok(!manifest.activationEvents.includes('onStartupFinished'));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onLanguage:')));
        assert.ok(!manifest.activationEvents.some(event => event.startsWith('onCommand:')));
        assert.deepStrictEqual(manifest.extensionKind, ['workspace']);
        assert.strictEqual(manifest.l10n, './l10n');
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/national_focus/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:common/technologies/*.txt'));
        assert.ok(manifest.activationEvents.includes('workspaceContains:events/*.txt'));
    });

    it('keeps preview entry visible for supported HOI4 file extensions', () => {
        const editorTitlePreviewEntries = manifest.contributes.menus['editor/title']
            .filter(entry => entry.command === 'server.hoi4modutilities.preview');
        assert.strictEqual(editorTitlePreviewEntries.length, 2);
        assert.ok(editorTitlePreviewEntries[0].when.includes('resourceExtname =~ /^\\.(txt|gfx|gui|map)$/'));
        assert.ok(editorTitlePreviewEntries[0].when.includes('!server.shouldShowHoi4Preview'));
        assert.match(editorTitlePreviewEntries[0].when, /resourceScheme != webview-panel/);
    });
});
