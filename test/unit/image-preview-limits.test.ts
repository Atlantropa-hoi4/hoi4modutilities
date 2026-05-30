import * as assert from 'assert';
import {
    formatByteSize,
    isImagePreviewWithinLimit,
    maxCustomEditorImageBytes,
} from '../../src/util/image/previewlimits';

describe('custom image preview limits', () => {
    it('allows files at the preview limit and blocks files above it', () => {
        assert.strictEqual(isImagePreviewWithinLimit(maxCustomEditorImageBytes), true);
        assert.strictEqual(isImagePreviewWithinLimit(maxCustomEditorImageBytes + 1), false);
    });

    it('formats byte sizes for user-facing warnings', () => {
        assert.strictEqual(formatByteSize(512), '512 B');
        assert.strictEqual(formatByteSize(1536), '1.5 KiB');
        assert.strictEqual(formatByteSize(64 * 1024 * 1024), '64 MiB');
    });
});
