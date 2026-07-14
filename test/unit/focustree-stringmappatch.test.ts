import * as assert from 'assert';
import { applyStringMapPatchInPlace } from '../../webviewsrc/focustree/stringmappatch';

describe('focustree string map patch', () => {
    it('applies a small patch without replacing the full render map', () => {
        const rendered = {
            FOCUS_A: '<div>A</div>',
            FOCUS_B: '<div>B</div>',
        };

        const result = applyStringMapPatchInPlace(
            rendered,
            { FOCUS_B: '<div>B updated</div>', FOCUS_C: '<div>C</div>' },
            ['FOCUS_A'],
        );

        assert.strictEqual(result, rendered);
        assert.deepStrictEqual(rendered, {
            FOCUS_B: '<div>B updated</div>',
            FOCUS_C: '<div>C</div>',
        });
    });
});
