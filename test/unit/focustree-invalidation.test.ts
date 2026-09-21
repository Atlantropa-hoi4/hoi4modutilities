import * as assert from 'assert';
import {
    classifyFocusTreeInvalidation,
    FocusTreeInvalidation,
} from '../../src/previewdef/focustree/invalidation';

const change = (path: string) => ({
    uri: { path } as any,
    changeKind: 'change' as const,
});

describe('focus tree dependency invalidation', () => {
    it('coalesces dependency categories into one bitmask', () => {
        const result = classifyFocusTreeInvalidation([
            change('/mod/common/national_focus/a.txt'),
            change('/mod/interface/goals.gfx'),
            change('/mod/localisation/english/a_l_english.yml'),
        ]);

        assert.ok(result & FocusTreeInvalidation.Structure);
        assert.ok(result & FocusTreeInvalidation.Presentation);
        assert.ok(result & FocusTreeInvalidation.Assets);
        assert.ok(result & FocusTreeInvalidation.Localisation);
        assert.strictEqual(result & FocusTreeInvalidation.Layout, 0);
    });
});
