import * as assert from 'assert';
import { formatHoi4Text, formatHoi4TextRange, getHoi4ExpectedLineIndent, getHoi4FormatterProfile } from '../../src/hoiformat/formatter';

describe('HOI4 formatter', () => {
    it('formats script indentation, assignment spacing, comparisons, and inline blocks', () => {
        const input = [
            'focus_tree={',
            '    id=generic_focus',
            '    focus={',
            '        available={is_major=yes}',
            '        modifier={',
            '            has_war_support>0.1 #inline',
            '        }',
            '    }',
            '}',
        ].join('\r\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'focus_tree = {',
            '\tid = generic_focus',
            '\tfocus = {',
            '\t\tavailable = { is_major = yes }',
            '\t\tmodifier = {',
            '\t\t\thas_war_support > 0.1 #inline',
            '\t\t}',
            '\t}',
            '}',
        ].join('\r\n'));
    });

    it('joins script block openings split after assignment', () => {
        const input = [
            'if =',
            '{',
            'limit = { has_dlc_bba = yes }',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'if = {',
            '\tlimit = { has_dlc_bba = yes }',
            '}',
        ].join('\n'));
    });

    it('preserves token text for modern HOI4 values and names', () => {
        const input = [
            'date>1936.1.1',
            'positive=+0.10',
            'trailing=0.',
            'negative=-0.0',
            'percent_value=+35%%',
            'add=-num_armies',
            'names={ Édouard Åslund O\'Connor Ra\'i “Shipka” }',
            'log="A # stays \\"quoted\\""',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'date > 1936.1.1',
            'positive = +0.10',
            'trailing = 0.',
            'negative = -0.0',
            'percent_value = +35%%',
            'add = -num_armies',
            'names = { Édouard Åslund O\'Connor Ra\'i “Shipka” }',
            'log = "A # stays \\"quoted\\""',
        ].join('\n'));
    });

    it('preserves comments, section headers, blank lines, and final newline style', () => {
        const input = [
            '\uFEFF### Army ###   ',
            '',
            '',
            'focus={ # note',
            '#Don\'t move   ',
            '}',
            '',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            '\uFEFF### Army ###',
            '',
            'focus = { # note',
            '\t#Don\'t move',
            '}',
            '',
        ].join('\n'));
    });

    it('removes empty inline comment markers while preserving real inline comments', () => {
        const input = [
            'focus = { # ',
            'id = KOR_yoon_mat_afterwar1 #폐허위에서 ',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'focus = {',
            '\tid = KOR_yoon_mat_afterwar1 #폐허위에서',
            '}',
        ].join('\n'));
    });

    it('adds Kaiserreich-style spacing between repeated focus blocks and section headers', () => {
        const input = [
            'focus_tree = {',
            '\tfocus = {',
            '\t\tid = first_focus',
            '\t}',
            '\tfocus = {',
            '\t\tid = second_focus',
            '\t}',
            '\t### Army ###',
            '\tfocus = {',
            '\t\tid = army_focus',
            '\t}',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'focus_tree = {',
            '\tfocus = {',
            '\t\tid = first_focus',
            '\t}',
            '',
            '\tfocus = {',
            '\t\tid = second_focus',
            '\t}',
            '',
            '\t### Army ###',
            '',
            '\tfocus = {',
            '\t\tid = army_focus',
            '\t}',
            '}',
        ].join('\n'));
    });

    it('adds Kaiserreich-style spacing between root event blocks', () => {
        const input = [
            'add_namespace = test',
            'country_event = {',
            '\tid = test.1',
            '}',
            'country_event = {',
            '\tid = test.2',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'add_namespace = test',
            'country_event = {',
            '\tid = test.1',
            '}',
            '',
            'country_event = {',
            '\tid = test.2',
            '}',
        ].join('\n'));
    });

    it('collapses simple multiline effect blocks into Kaiserreich-style inline blocks', () => {
        const input = [
            'completion_reward = {',
            '\tcountry_event = {',
            '\t\tid = korea.52',
            '\t}',
            '\tcountry_event = {',
            '\t\tid = korea.535',
            '\t\tdays = 60',
            '\t}',
            '\twhite_peace = {',
            '\t\ttag = MEO',
            '\t}',
            '\tallowed = {',
            '\t\talways = no',
            '\t}',
            '\tai_will_do = {',
            '\t\tfactor = 20',
            '\t}',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'completion_reward = {',
            '\tcountry_event = { id = korea.52 }',
            '\tcountry_event = { id = korea.535 days = 60 }',
            '\twhite_peace = { tag = MEO }',
            '\tallowed = { always = no }',
            '\tai_will_do = { factor = 20 }',
            '}',
        ].join('\n'));
    });

    it('keeps multiline-preferred simple blocks expanded for readability', () => {
        const input = [
            'every_country = {',
            '\tlimit = {',
            '\t\thas_war_with = MEO',
            '\t}',
            '\tprerequisite = {',
            '\t\tfocus = previous_focus',
            '\t}',
            '\tmutually_exclusive = {',
            '\t\tfocus = other_focus',
            '\t}',
            '\ttrigger = {',
            '\t\thas_war = yes',
            '\t}',
            '\tFROM = {',
            '\t\thas_war_support > 0.1',
            '\t\tcommand_power > 1.5',
            '\t}',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'every_country = {',
            '\tlimit = {',
            '\t\thas_war_with = MEO',
            '\t}',
            '\tprerequisite = {',
            '\t\tfocus = previous_focus',
            '\t}',
            '\tmutually_exclusive = {',
            '\t\tfocus = other_focus',
            '\t}',
            '\ttrigger = {',
            '\t\thas_war = yes',
            '\t}',
            '\tFROM = {',
            '\t\thas_war_support > 0.1',
            '\t\tcommand_power > 1.5',
            '\t}',
            '}',
        ].join('\n'));
    });

    it('formats anonymous block lists and value attachments without changing structure', () => {
        const input = [
            'colors={',
            '{bronze={155.0 105.0 87.0 1.0}}',
            '{silver={1.0 1.0 1.0 1.0}}',
            '}',
            'attached_value=producer_tag{ key=yes }',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'colors = {',
            '\t{ bronze = { 155.0 105.0 87.0 1.0 } }',
            '\t{ silver = { 1.0 1.0 1.0 1.0 } }',
            '}',
            'attached_value = producer_tag { key = yes }',
        ].join('\n'));
    });

    it('keeps long name lists on one line', () => {
        const names = [
            '"von Aderkas"',
            '"von Adlerberg"',
            '"von Ǻkerman"',
            '"von Anhorn von Hartwiß"',
            '"von Barclay de Tolly-Weymarn"',
            '"von Budberg-Bönninghausen"',
            '"von Schoultz von Ascheraden"',
            '"von Uexküll-Güldenband"',
            '"von Weißmann von Weißenstein"',
        ].join(' ');
        const input = `surnames={ ${names} }`;

        assert.strictEqual(formatHoi4Text(input, { profile: 'script', filePath: 'common/names/BAT names.txt' }), `surnames = { ${names} }`);
    });

    it('preserves Kaiserreich-style decision readability with grouped blank lines and short inline blocks', () => {
        const input = [
            'decisions = {',
            '\tMEO_defend_success = {',
            '\t\ticon = generic_inflation',
            '',
            '\t\tallowed = { always = no }',
            '\t\tavailable = {',
            '\t\t\thidden_trigger = { always = no }',
            '\t\t}',
            '',
            '\t\tselectable_mission = no',
            '\t\tis_good = yes',
            '\t\tdays_mission_timeout = 200',
            '',
            '\t\ttimeout_effect = {',
            '\t\t\tlog = "[GetLogRoot]: Decision timeout MEO_defend_success"',
            '\t\t\tevery_country = {',
            '\t\t\t\tlimit = {',
            '\t\t\t\t\thas_war_with = MEO',
            '\t\t\t\t}',
            '\t\t\t\twhite_peace = { tag = MEO }',
            '\t\t\t}',
            '\t\t\tset_country_flag = MEO_defend_success_flag',
            '\t\t}',
            '\t\tfixed_random_seed = no',
            '\t}',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), input);
    });

    it('formats GUI structure while preserving coordinate inline spacing style', () => {
        const input = [
            'guiTypes={',
            '\tcontainerWindowType={',
            '\t\tposition = {x=150 y=100}',
            '\t\ticonType =',
            '\t\t{',
            '\t\t\tname ="stability_bg"',
            '\t\t\tsize= { x=290 y=310 }',
            '\t\t}',
            '\t}',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'gui' }), [
            'guiTypes = {',
            '\tcontainerWindowType = {',
            '\t\tposition = { x=150 y=100 }',
            '\t\ticonType =',
            '\t\t{',
            '\t\t\tname = "stability_bg"',
            '\t\t\tsize = { x=290 y=310 }',
            '\t\t}',
            '\t}',
            '}',
        ].join('\n'));
    });

    it('formats only the selected line range with surrounding block indentation context', () => {
        const input = [
            'focus_tree = {',
            '    id=generic_focus',
            '    focus={',
            '        x=1',
            '    }',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4TextRange(input, { profile: 'script' }, { startLine: 1, endLine: 4 }), [
            '\tid = generic_focus',
            '\tfocus = {',
            '\t\tx = 1',
            '\t}',
        ].join('\n'));
    });

    it('computes on-type indentation from the surrounding block context without requiring a complete parse', () => {
        const input = [
            'focus_tree = {',
            '\tfocus = {',
            '',
            '\t\t}',
        ].join('\n');

        assert.strictEqual(getHoi4ExpectedLineIndent(input, { profile: 'script' }, 2), '\t\t');
        assert.strictEqual(getHoi4ExpectedLineIndent(input, { profile: 'script' }, 3), '\t');
    });

    it('classifies supported and excluded HOI4 formatter paths', () => {
        assert.strictEqual(getHoi4FormatterProfile('C:\\mod\\common\\national_focus\\test.txt'), 'script');
        assert.strictEqual(getHoi4FormatterProfile('/mod/events/sample.txt'), 'script');
        assert.strictEqual(getHoi4FormatterProfile('/mod/history/countries/AFG - Afghanistan.txt'), 'script');
        assert.strictEqual(getHoi4FormatterProfile('/mod/country_metadata/tags.txt'), 'script');
        assert.strictEqual(getHoi4FormatterProfile('/mod/interface/browser.gui'), 'gui');
        assert.strictEqual(getHoi4FormatterProfile('/mod/interface/core.gfx'), 'gui');
        assert.strictEqual(getHoi4FormatterProfile('/mod/localisation/sample_l_english.yml'), undefined);
        assert.strictEqual(getHoi4FormatterProfile('/mod/map/weatherpositions.txt'), undefined);
        assert.strictEqual(getHoi4FormatterProfile('/mod/README.txt'), undefined);
        assert.strictEqual(getHoi4FormatterProfile('/mod/map/default.map'), undefined);
    });
});
