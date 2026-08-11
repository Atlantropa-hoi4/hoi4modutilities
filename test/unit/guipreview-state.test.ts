import * as assert from 'assert';
import { resolveGuiPreviewFolder } from '../../webviewsrc/guipreview/state';

describe('GUI preview state restoration', () => {
    it('keeps a restored folder that still exists', () => {
        assert.strictEqual(
            resolveGuiPreviewFolder('containerwindow_second', ['containerwindow_first', 'containerwindow_second'], 'containerwindow_first'),
            'containerwindow_second',
        );
    });

    it('falls back when the restored folder was removed by a document update', () => {
        assert.strictEqual(
            resolveGuiPreviewFolder('containerwindow_removed', ['containerwindow_first'], 'containerwindow_first'),
            'containerwindow_first',
        );
    });
});
