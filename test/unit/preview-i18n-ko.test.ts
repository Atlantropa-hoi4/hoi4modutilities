import * as assert from 'assert';
import en from '../../i18n/en';
import ko from '../../i18n/ko';

const previewPrefixes = ['decisiontree.', 'eventtree.', 'ideapreview.'];

describe('Korean preview localisation', () => {
    const english = en as Record<string, string>;
    const korean = ko as Record<string, string | undefined>;
    const keys = Object.keys(english).filter(key => previewPrefixes.some(prefix => key.startsWith(prefix)));

    it('covers every idea, decision, and event preview string', () => {
        const missing = keys.filter(key => korean[key] === undefined);
        assert.deepStrictEqual(missing, []);
    });

    it('preserves every interpolation placeholder', () => {
        for (const key of keys) {
            const expected = english[key].match(/\{\d+\}/g) ?? [];
            const actual = korean[key]?.match(/\{\d+\}/g) ?? [];
            assert.deepStrictEqual(actual.sort(), expected.sort(), key);
        }
    });
});
