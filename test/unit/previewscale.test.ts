import * as assert from 'assert';
import { normalizePreviewScale } from '../../src/util/previewscale';

describe('preview scale normalization', () => {
    it('keeps restored preview scales inside the supported zoom range', () => {
        assert.strictEqual(normalizePreviewScale(1), 1);
        assert.strictEqual(normalizePreviewScale(0.6), 0.6);
        assert.strictEqual(normalizePreviewScale(0.000001), 0.2);
        assert.strictEqual(normalizePreviewScale(2), 1);
    });

    it('falls back to the default scale for invalid restored state values', () => {
        assert.strictEqual(normalizePreviewScale(undefined), 1);
        assert.strictEqual(normalizePreviewScale(Number.NaN), 1);
        assert.strictEqual(normalizePreviewScale('0.4'), 0.4);
    });
});
