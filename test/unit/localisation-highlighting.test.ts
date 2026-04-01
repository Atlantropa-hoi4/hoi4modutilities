import * as assert from 'assert';
import {
    collectLocalisationDecorations,
    correctLocalisationTextColor,
    findLocalisationStringRanges,
    hasHoi4LocalisationTokenHints,
    isHoi4LocalisationText,
    isLikelyHoi4LocalisationPath,
} from '../../src/util/localisationHighlighting';
import { readFixture } from '../testUtils';

describe('localisation highlighting helpers', () => {
    it('detects HOI4 localisation text using headers and entry lines', () => {
        assert.strictEqual(isHoi4LocalisationText('l_english:\n TEST_KEY:0 "Hello"'), true);
        assert.strictEqual(isHoi4LocalisationText('name: "plain yaml"\nvalue: 1'), false);
    });

    it('detects HOI4 localisation files from their normal paths even before text scanning', () => {
        assert.strictEqual(isLikelyHoi4LocalisationPath('C:\\mods\\test\\localisation\\english\\test_l_english.yml'), true);
        assert.strictEqual(isLikelyHoi4LocalisationPath('/mods/test/localization/korean/test_l_korean.yml'), true);
        assert.strictEqual(isLikelyHoi4LocalisationPath('C:\\mods\\test\\name l_english.yml'), true);
        assert.strictEqual(isLikelyHoi4LocalisationPath('C:\\mods\\test\\name-l_english.yaml'), true);
        assert.strictEqual(isLikelyHoi4LocalisationPath('C:\\mods\\test\\events\\focuses.yml'), false);
        assert.strictEqual(isLikelyHoi4LocalisationPath('C:\\mods\\test\\localisation\\english\\not_localisation.txt'), false);
    });

    it('detects HOI4 localisation token hints even without a parsed header', () => {
        assert.strictEqual(hasHoi4LocalisationTokenHints('Plain text §Ggreen§! £pol_power $TAG$ [ROOT.GetName]'), true);
        assert.strictEqual(hasHoi4LocalisationTokenHints('name: plain yaml value'), false);
    });

    it('corrects extreme text colors for readability across editor themes', () => {
        const correctedWhite = correctLocalisationTextColor('#FFFFFF', 'light');
        const correctedBlue = correctLocalisationTextColor('#0000FF', 'dark');

        assert.notStrictEqual(correctedWhite, '#FFFFFF');
        assert.notStrictEqual(correctedBlue, '#0000FF');
        assert.match(correctedWhite, /^#[0-9A-F]{6}$/);
        assert.match(correctedBlue, /^#[0-9A-F]{6}$/);
    });

    it('finds quoted localisation string ranges while ignoring comments', () => {
        const fixture = readFixture('localisation', 'sample_l_english.yml');
        const ranges = findLocalisationStringRanges(fixture);
        const values = ranges.map(range => fixture.slice(range.start, range.end));

        assert.deepStrictEqual(values, [
            'Nothing special here',
            'Before §Ggreen £pol_power $TARGET$ [ROOT.GetName]§! after',
            'Escaped quote: \\"still inside\\" and §Rred text',
            'Optional version still allows §Yhighlight§!',
        ]);
    });

    it('collects color spans and inline code tokens from localisation strings', () => {
        const fixture = readFixture('localisation', 'sample_l_english.yml');
        const decorations = collectLocalisationDecorations(fixture);

        const summary = decorations.map(decoration => ({
            kind: decoration.kind,
            colorCode: decoration.colorCode,
            text: fixture.slice(decoration.start, decoration.end),
        }));

        assert.deepStrictEqual(summary.filter(item => item.kind === 'colorCode'), [
            { kind: 'colorCode', colorCode: 'G', text: '§G' },
            { kind: 'colorCode', colorCode: '!', text: '§!' },
            { kind: 'colorCode', colorCode: 'R', text: '§R' },
            { kind: 'colorCode', colorCode: 'Y', text: '§Y' },
            { kind: 'colorCode', colorCode: '!', text: '§!' },
        ]);

        assert.ok(summary.some(item => item.kind === 'colorText' && item.colorCode === 'G' && item.text === 'green £pol_power $TARGET$ [ROOT.GetName]'));
        assert.ok(summary.some(item => item.kind === 'colorText' && item.colorCode === 'R' && item.text === 'red text'));
        assert.ok(summary.some(item => item.kind === 'colorText' && item.colorCode === 'Y' && item.text === 'highlight'));
        assert.ok(summary.some(item => item.kind === 'textIcon' && item.text === '£pol_power'));
        assert.ok(summary.some(item => item.kind === 'localisationReference' && item.text === '$TARGET$'));
        assert.ok(summary.some(item => item.kind === 'scriptedLocalisation' && item.text === '[ROOT.GetName]'));
    });
});
