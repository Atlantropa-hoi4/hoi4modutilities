import * as assert from 'assert';
import { findCountryColorMatches, formatCountryColorValue, isCountryColorFile } from '../../src/util/countryColorProviderShared';

describe('country color provider shared helpers', () => {
    it('matches HOI4 country and ideology color files only', () => {
        assert.strictEqual(isCountryColorFile('C:/mod/common/countries/colors.txt'), true);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\countries\\color.txt'), true);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\countries\\cosmetic.txt'), true);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\ideologies\\00_ideologies.txt'), true);
        assert.strictEqual(isCountryColorFile('C:\\mod\\ideologies\\subideologies.txt'), true);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\ideas\\colors.txt'), false);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\countries\\tags.txt'), false);
        assert.strictEqual(isCountryColorFile('C:\\mod\\common\\ideologies\\icons.gfx'), false);
    });

    it('finds rgb and plain country color values while ignoring non-rgb attachments', () => {
        const text = [
            'GER = {',
            '    color = rgb { 10 20 30 }',
            '    color_ui = { 40 50 60 }',
            '    hsv_color = hsv { 0.5 0.2 0.1 }',
            '    ideology = { 1 2 3 }',
            '}',
        ].join('\n');

        const matches = findCountryColorMatches(text);

        assert.strictEqual(matches.length, 2);
        assert.deepStrictEqual(matches.map(match => ({ red: match.red, green: match.green, blue: match.blue, format: match.format })), [
            { red: 10, green: 20, blue: 30, format: 'rgb' },
            { red: 40, green: 50, blue: 60, format: 'plain' },
        ]);
        assert.strictEqual(text.slice(matches[0].start, matches[0].end), 'rgb { 10 20 30 }');
        assert.strictEqual(text.slice(matches[1].start, matches[1].end), '{ 40 50 60 }');
    });

    it('formats rewritten color values with rounding and clipping', () => {
        assert.strictEqual(formatCountryColorValue(12.2, 127.6, 300, 'rgb'), 'rgb { 12 128 255 }');
        assert.strictEqual(formatCountryColorValue(-1, 64, 128, 'plain'), '{ 0 64 128 }');
    });
});
