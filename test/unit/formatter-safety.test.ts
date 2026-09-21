import * as assert from 'assert';
import { assertHoi4FormattingSafe } from '../../src/hoiformat/formatterSafety';

describe('HOI4 formatter safety', () => {
    it('accepts whitespace, comment indentation, and trailing whitespace changes', () => {
        assert.doesNotThrow(() => assertHoi4FormattingSafe(
            'effect={\n    # note   \n    value=+0.10 # inline   \n}',
            'effect = {\n\t# note\n\tvalue = +0.10 # inline\n}\n',
        ));
    });

    it('accepts approved direct event calls and known field ordering', () => {
        assert.doesNotThrow(() => assertHoi4FormattingSafe(
            [
                'effect = {',
                '\tcountry_event = { id = test.1 }',
                '\thas_game_rule = { option = enabled rule = test_rule }',
                '}',
            ].join('\n'),
            [
                'effect = {',
                '\tcountry_event = test.1',
                '\thas_game_rule = { rule = test_rule option = enabled }',
                '}',
                '',
            ].join('\n'),
        ));
    });

    it('rejects structural, token, comment, and separator changes', () => {
        assert.throws(
            () => assertHoi4FormattingSafe('value = +0.10', 'value = 0.1\n'),
            /script structure changed/,
        );
        assert.throws(
            () => assertHoi4FormattingSafe('value = 1 # before', 'value = 1 # after\n'),
            /comments changed/,
        );
        assert.throws(
            () => assertHoi4FormattingSafe('values = { a, b }', 'values = { a b }\n'),
            /list separators changed/,
        );
    });
});
