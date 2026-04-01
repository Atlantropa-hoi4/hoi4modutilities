import * as assert from 'assert';
import { normalizeFileOrUriString } from '../../src/util/pathinput';

describe('path input normalization', () => {
    it('strips matching outer quotes around pasted file paths', () => {
        assert.strictEqual(normalizeFileOrUriString('  "C:\\Mods\\sample.mod"  '), 'C:\\Mods\\sample.mod');
        assert.strictEqual(normalizeFileOrUriString("  'C:\\Mods\\sample.mod'  "), 'C:\\Mods\\sample.mod');
    });

    it('leaves unquoted paths untouched apart from trimming whitespace', () => {
        assert.strictEqual(normalizeFileOrUriString('  C:\\Mods\\sample.mod  '), 'C:\\Mods\\sample.mod');
        assert.strictEqual(normalizeFileOrUriString('https://example.com/mod.mod'), 'https://example.com/mod.mod');
    });
});
