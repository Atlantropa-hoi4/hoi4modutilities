import * as assert from 'assert';
import {
    collectLocalisationDecorations,
    findLocalisationStringRanges,
    isHoi4LocalisationText,
} from '../../src/util/localisationHighlighting';
import { readFixture } from '../testUtils';

describe('localisation highlighting helpers', () => {
    it('detects HOI4 localisation text using headers and entry lines', () => {
        assert.strictEqual(isHoi4LocalisationText('l_english:\n TEST_KEY:0 "Hello"'), true);
        assert.strictEqual(isHoi4LocalisationText('name: "plain yaml"\nvalue: 1'), false);
    });

    it('finds quoted localisation string ranges while ignoring comments', () => {
        const fixture = readFixture('localisation', 'sample_l_english.yml');
        const ranges = findLocalisationStringRanges(fixture);
        const values = ranges.map(range => fixture.slice(range.start, range.end));

        assert.deepStrictEqual(values, [
            'Nothing special here',
            'Before §Ggreen £pol_power $TARGET$ [ROOT.GetName]§! after',
            'Escaped quote: \\"still inside\\" and §Rred text',
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
        ]);

        assert.ok(summary.some(item => item.kind === 'colorText' && item.colorCode === 'G' && item.text === 'green £pol_power $TARGET$ [ROOT.GetName]'));
        assert.ok(summary.some(item => item.kind === 'colorText' && item.colorCode === 'R' && item.text === 'red text'));
        assert.ok(summary.some(item => item.kind === 'textIcon' && item.text === '£pol_power'));
        assert.ok(summary.some(item => item.kind === 'localisationReference' && item.text === '$TARGET$'));
        assert.ok(summary.some(item => item.kind === 'scriptedLocalisation' && item.text === '[ROOT.GetName]'));
    });
});
