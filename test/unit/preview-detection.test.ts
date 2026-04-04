import * as assert from 'assert';
import { findRegexPreviewPriority, previewDetectionMaxChars, samplePreviewText } from '../../src/previewdef/previewdetectshared';

describe('preview detection helpers', () => {
    it('trims text samples to the configured preview limit', () => {
        const input = 'a'.repeat(previewDetectionMaxChars + 25);
        const result = samplePreviewText(input);

        assert.strictEqual(result.length, previewDetectionMaxChars);
        assert.strictEqual(result, input.slice(0, previewDetectionMaxChars));
    });

    it('returns the first regex match index without relying on a global regex state', () => {
        const pattern = /(focus_tree|shared_focus|joint_focus)\s*=\s*{/g;
        const text = 'xxxx focus_tree = {';

        assert.strictEqual(findRegexPreviewPriority(text, pattern), 5);
        assert.strictEqual(findRegexPreviewPriority(text, pattern), 5);
    });

    it('returns undefined when the sampled text does not contain the pattern', () => {
        assert.strictEqual(findRegexPreviewPriority('technology = {', /(country_event|news_event)\s*=\s*{/), undefined);
    });
});
