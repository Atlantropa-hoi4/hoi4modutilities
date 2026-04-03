import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            languages: {
                registerColorProvider: () => ({ dispose() {} }),
            },
            ColorInformation: class {},
            Range: class {},
            Color: class {},
            ColorPresentation: class {
                public textEdit: unknown;

                constructor(public label: string) {}
            },
            TextEdit: class {
                constructor(public range: unknown, public newText: string) {}
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    findHoi4CountryColorMatches,
    formatHoi4CountryColorValue,
    isCountryColorDocumentPath,
} = require('../../src/util/countryColorProvider') as typeof import('../../src/util/countryColorProvider');

describe('country color provider helpers', () => {
    it('detects supported HOI4 country color documents by path', () => {
        assert.strictEqual(isCountryColorDocumentPath('C:\\mods\\test\\common\\countries\\colors.txt'), true);
        assert.strictEqual(isCountryColorDocumentPath('/mods/test/common/countries/cosmetic.txt'), true);
        assert.strictEqual(isCountryColorDocumentPath('/countries/color.txt'), true);
        assert.strictEqual(isCountryColorDocumentPath('/mods/test/common/ideologies/00_ideologies.txt'), true);
        assert.strictEqual(isCountryColorDocumentPath('/ideologies/subideologies.txt'), true);
        assert.strictEqual(isCountryColorDocumentPath('/mods/test/common/countries/TAGS.txt'), false);
        assert.strictEqual(isCountryColorDocumentPath('/mods/test/events/cosmetic.txt'), false);
        assert.strictEqual(isCountryColorDocumentPath('/mods/test/common/ideologies/readme.md'), false);
    });

    it('finds rgb color assignments and skips commented lines', () => {
        const text = [
            'GER = { color = rgb { 10 20 30 } }',
            '# ITA = { color = rgb { 1 2 3 } }',
            'POL = { color_ui = { 40 50 60 } }',
            'democratic = { color = { 15 25 35 } }',
            'SPR = {',
            '    color = rgb {',
            '        70 80 90',
            '    }',
            '}',
        ].join('\n');

        const matches = findHoi4CountryColorMatches(text);

        assert.deepStrictEqual(matches.map(match => ({
            key: match.key,
            valueText: match.valueText,
            rgb: [match.red, match.green, match.blue],
        })), [
            { key: 'color', valueText: 'rgb { 10 20 30 }', rgb: [10, 20, 30] },
            { key: 'color_ui', valueText: '{ 40 50 60 }', rgb: [40, 50, 60] },
            { key: 'color', valueText: '{ 15 25 35 }', rgb: [15, 25, 35] },
            { key: 'color', valueText: 'rgb {\n        70 80 90\n    }', rgb: [70, 80, 90] },
        ]);
    });

    it('preserves existing formatting while updating rgb values', () => {
        assert.strictEqual(
            formatHoi4CountryColorValue('rgb { 10 20 30 }', 16, 32, 48),
            'rgb { 16 32 48 }',
        );
        assert.strictEqual(
            formatHoi4CountryColorValue('{\n        10 20 30\n    }', 64, 128, 255),
            '{\n        64 128 255\n    }',
        );
    });

    it('rounds and clips values from the picker before writing HOI4 rgb text', () => {
        assert.strictEqual(
            formatHoi4CountryColorValue('rgb { 0 0 0 }', -10.2, 127.6, 999),
            'rgb { 0 128 255 }',
        );
        assert.strictEqual(
            formatHoi4CountryColorValue(undefined, 1, 2, 3),
            'rgb { 1 2 3 }',
        );
    });
});
