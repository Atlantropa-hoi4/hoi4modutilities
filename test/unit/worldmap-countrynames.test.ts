import * as assert from 'assert';
import { findCountryLocalisedName, getCountryLocalisationKeys, resolveCountryName } from '../../src/previewdef/worldmap/loader/countrylocalisation';
import { parseCountryNameHistory } from '../../src/previewdef/worldmap/loader/countryhistory';
import type { Bookmark, CountryLabelsData } from '../../src/previewdef/worldmap/definitions';

describe('country map localisation', () => {
    const bookmarks: Bookmark[] = [1936, 1939].map(year => ({ name: `${year}`, date: { year, month: 1, day: 1, hour: 0 } }));
    const country = { tag: 'AAA', localisedName: 'Fallback', color: 0, file: 'common/countries/a.txt' };
    const selected = [{ scopeName: '', nodeContent: '1939.1.1.0' }];

    it('selects political and cosmetic names with bookmark dates and script conditions', () => {
        const conditions: CountryLabelsData['conditionExprs'] = [];
        const history = parseCountryNameHistory(`
            set_politics = { ruling_party = neutrality }
            1938.1.1 = {
                set_politics = { ruling_party = democratic }
                if = { limit = { has_country_flag = renamed } set_cosmetic_tag = NEW }
            }
        `, 'AAA', bookmarks, conditions);
        const labels: CountryLabelsData = { histories: [history], conditionExprs: conditions, mapFont: undefined,
            localisations: { AAA_neutrality: 'Old Republic', AAA_democratic: 'Republic', NEW_democratic: 'New Republic' } };
        assert.strictEqual(resolveCountryName(country, labels, []), 'Old Republic');
        assert.strictEqual(resolveCountryName(country, labels, selected), 'Republic');
        const rename = conditions.find(condition => condition.nodeContent.includes('has_country_flag'))!;
        assert.ok(rename);
        assert.strictEqual(resolveCountryName(country, labels, [...selected, rename]), 'New Republic');
    });

    it('keeps an exact-date history entry inactive until a later bookmark', () => {
        const history = parseCountryNameHistory('set_politics = { ruling_party = neutrality } 1939.1.1 = { set_politics = { ruling_party = democratic } }',
            'AAA', bookmarks, []);
        const labels: CountryLabelsData = { histories: [history], conditionExprs: [], mapFont: undefined,
            localisations: { AAA_neutrality: 'Old Republic', AAA_democratic: 'Republic' } };
        assert.strictEqual(resolveCountryName(country, labels, selected), 'Old Republic');
    });

    it('clears a cosmetic name and restores an independent name after dated changes', () => {
        const subject = parseCountryNameHistory('set_politics = { ruling_party = democratic } set_cosmetic_tag = COS 1938.1.1 = { drop_cosmetic_tag = yes }',
            'AAA', bookmarks, []);
        const overlord = parseCountryNameHistory(`set_autonomy = { target = AAA autonomous_state = autonomy_dominion }
            1938.1.1 = { set_autonomy = { target = AAA autonomous_state = autonomy_free } }`, 'BBB', bookmarks, []);
        const labels: CountryLabelsData = { histories: [subject, overlord], conditionExprs: [], mapFont: undefined,
            localisations: { COS_democratic: 'Cosmetic', AAA_democratic: 'Republic', AAA_BBB_autonomy_dominion: 'Dominion' } };
        assert.strictEqual(resolveCountryName(country, labels, []), 'Cosmetic');
        assert.strictEqual(resolveCountryName(country, labels, selected), 'Republic');
        labels.histories = [parseCountryNameHistory('set_politics = { ruling_party = democratic }', 'AAA', bookmarks, []), overlord];
        assert.strictEqual(resolveCountryName(country, labels, []), 'Dominion');
    });

    it('keeps the existing country fallback when localisation keys cannot be resolved', () => {
        assert.strictEqual(resolveCountryName(country, undefined, []), 'Fallback');
    });

    it('prefers cosmetic and autonomy-specific country names', () => {
        assert.deepStrictEqual(getCountryLocalisationKeys('AAA', 'democratic', 'AAA_COSMETIC', {
            overlord: 'BBB',
            autonomousState: 'autonomy_dominion',
        }), [
            'AAA_COSMETIC_democratic',
            'AAA_COSMETIC',
            'AAA_BBB_autonomy_dominion',
            'AAA_democratic',
            'AAA',
        ]);
    });

    it('does not use an unresolved localisation key as a country name', () => {
        const keys = getCountryLocalisationKeys('AAA', 'democratic');
        assert.strictEqual(findCountryLocalisedName(keys, key => key), undefined);
        assert.strictEqual(findCountryLocalisedName(keys, key => key === 'AAA' ? 'Country A' : key), 'Country A');
    });
});

