import * as assert from 'assert';
import manifest from '../../package.json';

describe('extension manifest', () => {
    it('activates on HOI4 language ids used by companion syntax extensions', () => {
        assert.ok(manifest.activationEvents.includes('onStartupFinished'));
        assert.ok(manifest.activationEvents.includes('onLanguage:hoi4'));
        assert.ok(manifest.activationEvents.includes('onLanguage:paradox'));
        assert.ok(manifest.activationEvents.includes('onLanguage:yaml'));
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
