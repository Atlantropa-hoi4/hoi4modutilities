import * as assert from 'assert';
import { htmlAttributeEscape, htmlTextEscape } from '../../src/util/htmlescape';

describe('html escaping helpers', () => {
    it('escapes text nodes without changing quotes', () => {
        assert.strictEqual(htmlTextEscape('A&B <tag> "quoted"'), 'A&amp;B &lt;tag&gt; "quoted"');
    });

    it('escapes double-quoted attribute values', () => {
        assert.strictEqual(htmlAttributeEscape('A&B <tag> "quoted"'), 'A&amp;B &lt;tag&gt; &quot;quoted&quot;');
    });
});
