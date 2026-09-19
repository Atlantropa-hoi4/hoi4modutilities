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

    it('excludes comments from formatting while preserving blank lines and final newline style', () => {
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
            '\uFEFF### Army ###   ',
            '',
            'focus = { # note',
            '#Don\'t move   ',
            '}',
            '',
        ].join('\n'));
    });

    it('preserves inline comments and their original spacing', () => {
        const input = [
            'focus = { # ',
            'id = KOR_yoon_mat_afterwar1   #폐허위에서 ',
            'x=1# no gap',
            '}',
        ].join('\n');

        assert.strictEqual(formatHoi4Text(input, { profile: 'script' }), [
            'focus = { # ',
            '\tid = KOR_yoon_mat_afterwar1   #폐허위에서 ',
            '\tx = 1# no gap',
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

    it('removes blank lines immediately before closing braces', () => {
        const input = [
            'focus = {',
            '\tavailable = {',
            '\t\thas_war = yes',
            '',
            '\t}',
            '',
            '}',
        ].join('\n');
        const expected = [
            'focus = {',
            '\tavailable = {',
            '\t\thas_war = yes',
            '\t}',
            '}',
        ].join('\n');

        const formatted = formatHoi4Text(input, { profile: 'script' });
        assert.strictEqual(formatted, expected);
        assert.strictEqual(formatHoi4Text(formatted, { profile: 'script' }), formatted);
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
            '\tcountry_event = korea.52',
            '\tcountry_event = { id = korea.535 days = 60 }',
            '\twhite_peace = { tag = MEO }',
            '\tallowed = { always = no }',
            '\tai_will_do = { factor = 20 }',
            '}',
        ].join('\n'));
    });

    it('canonicalizes safe Kaiserreich block forms and known field order', () => {
        const input = [
            'effect = {',
            '\tset_technology = {',
            '\t\tinfantry_weapons = 1',
            '\t\tsupport_weapons = 1',
            '\t}',
            '\thas_equipment = {',
            '\t\tinfantry_equipment > 1000',
            '\t}',
            '\tai_chance = {',
            '\t\tbase = 10',
            '\t\tfactor = 2',
            '\t}',
            '\tlimit = {',
            '\t\thas_template = "Infantry Division"',
            '\t}',
            '\tactivate_targeted_decision = {',
            '\t\tdecision = invite_country',
            '\t\ttarget = ROOT',
            '\t}',
            '\tremove_targeted_decision = {',
            '\t\tdecision = remove_country',
            '\t\ttarget = PREV',
            '\t}',
            '\thas_game_rule = {',
            '\t\toption = enabled',
            '\t\trule = test_rule',
            '\t}',
            '\thas_opinion = {',
            '\t\tvalue > 25',
            '\t\ttarget = GER',
            '\t}',
            '\tset_province_name = {',
            '\t\tname = test_name',
            '\t\tid = 123',
            '\t}',
            '\ttransfer_ship = {',
            '\t\ttarget = ENG',
            '\t\ttype = battleship',
            '\t\tprefer_name = "Example Ship"',
            '\t}',
            '}',
        ].join('\n');
        const expected = [
            'effect = {',
            '\tset_technology = { infantry_weapons = 1 support_weapons = 1 }',
            '\thas_equipment = { infantry_equipment > 1000 }',
            '\tai_chance = { base = 10 factor = 2 }',
            '\tlimit = { has_template = "Infantry Division" }',
            '\tactivate_targeted_decision = { target = ROOT decision = invite_country }',
            '\tremove_targeted_decision = { target = PREV decision = remove_country }',
            '\thas_game_rule = { rule = test_rule option = enabled }',
            '\thas_opinion = { target = GER value > 25 }',
            '\tset_province_name = { id = 123 name = test_name }',
            '\ttransfer_ship = { prefer_name = "Example Ship" type = battleship target = ENG }',
            '}',
        ].join('\n');

        const formatted = formatHoi4Text(input, { profile: 'script' });
        assert.strictEqual(formatted, expected);
        assert.strictEqual(formatHoi4Text(formatted, { profile: 'script' }), formatted);
    });

    it('keeps multi-entry set_technology blocks multiline in history files', () => {
        const input = [
            'set_technology = {',
            '\tmain_battle_tank1 = 1',
            '\tmain_battle_tank2 = 1',
            '\tlight_tank1 = 1',
            '}',
            'if = {',
            '\tlimit = { has_dlc = "No Step Back" }',
            '\tset_technology = {',
            '\t\tamphibious_tank1 = 1',
            '\t\tamphibious_mechanized_infantry1 = 1',
            '\t}',
            '}',
        ].join('\n');
        const filePath = 'C:\\mod\\history\\countries\\GER - Germany.txt';

        const formatted = formatHoi4Text(input, { profile: 'script', filePath });
        assert.strictEqual(formatted, input);
        assert.strictEqual(formatHoi4TextRange(input, { profile: 'script', filePath }, { startLine: 5, endLine: 11 }), input.split('\n').slice(5).join('\n'));
        assert.strictEqual(formatHoi4Text(input, { profile: 'script', filePath: 'mod/common/national_focus/GER.txt' }), [
            'set_technology = { main_battle_tank1 = 1 main_battle_tank2 = 1 light_tank1 = 1 }',
            'if = {',
            '\tlimit = { has_dlc = "No Step Back" }',
            '\tset_technology = { amphibious_tank1 = 1 amphibious_mechanized_infantry1 = 1 }',
            '}',
        ].join('\n'));
    });

    it('uses direct event calls only for nested id-only blocks and orders known delays', () => {
        const input = [
            'immediate = {',
            '\tcountry_event = { id = test.1 }',
            '\tnews_event = { id = test.2 } # keep this note',
            '\tunit_leader_event = {',
            '\t\tid = test.3',
            '\t}',
            '\tcountry_event = {',
            '\t\trandom_hours = 4',
            '\t\tdays = 3',
            '\t\tid = test.4',
            '\t}',
            '}',
            'country_event = { id = test.definition }',
        ].join('\n');
        const expected = [
            'immediate = {',
            '\tcountry_event = test.1',
            '\tnews_event = test.2 # keep this note',
            '\tunit_leader_event = test.3',
            '\tcountry_event = { id = test.4 days = 3 random_hours = 4 }',
            '}',
            '',
            'country_event = { id = test.definition }',
        ].join('\n');

        const formatted = formatHoi4Text(input, { profile: 'script' });
        assert.strictEqual(formatted, expected);
        assert.strictEqual(formatHoi4Text(formatted, { profile: 'script' }), formatted);
    });

    it('does not reorder known blocks with comments, duplicate fields, or unknown fields', () => {
        const input = [
            'effect = {',
            '\tactivate_targeted_decision = {',
            '\t\tdecision = invite_country',
            '\t\t# keep placement',
            '\t\ttarget = ROOT',
            '\t}',
            '\thas_game_rule = {',
            '\t\trule = test_rule',
            '\t\trule = second_rule',
            '\t\toption = enabled',
            '\t}',
            '\ttransfer_ship = {',
            '\t\ttype = destroyer',
            '\t\ttarget = ENG',
            '\t\tcount = 2',
            '\t}',
            '}',
        ].join('\n');

        const formatted = formatHoi4Text(input, { profile: 'script' });
        assert.strictEqual(formatted, input);
        assert.strictEqual(formatHoi4Text(formatted, { profile: 'script' }), formatted);
    });

    it('collapses nested inline-preferred blocks to an idempotent result', () => {
        const input = [
            'limit = {',
            '\tKOR = {',
            '\t\tNOT = {',
            '\t\t\thas_research = basic_medium_airframe',
            '\t\t}',
            '\t}',
            '}',
        ].join('\n');
        const expected = [
            'limit = {',
            '\tKOR = { NOT = { has_research = basic_medium_airframe } }',
            '}',
        ].join('\n');

        const formatted = formatHoi4Text(input, { profile: 'script' });
        assert.strictEqual(formatted, expected);
        assert.strictEqual(formatHoi4Text(formatted, { profile: 'script' }), formatted);
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

    it('formats GUI structure while normalizing coordinate inline assignment spacing', () => {
        const input = [
            'guiTypes={',
            '\tcontainerWindowType={',
            '\t\tposition = { x=80 y=250}',
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
            '\t\tposition = { x = 80 y = 250 }',
            '\t\ticonType =',
            '\t\t{',
            '\t\t\tname = "stability_bg"',
            '\t\t\tsize = { x = 290 y = 310 }',
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
        assert.strictEqual(getHoi4FormatterProfile('C:\\projects\\map\\my-mod\\events\\sample.txt'), 'script');
    });

    it('does not treat the Steam library steamapps/common folder as a script root', () => {
        const steamGame = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV';
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\common\\ideas\\_economic.txt`), 'script');
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\history\\countries\\GER - Germany.txt`), 'script');
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\interface\\core.gfx`), 'gui');
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\music\\hoi2\\hoi2_soundtrack.txt`), undefined);
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\tests\\argentina.txt`), undefined);
        assert.strictEqual(getHoi4FormatterProfile(`${steamGame}\\licenses.txt`), undefined);
        assert.strictEqual(getHoi4FormatterProfile('/home/user/.steam/steam/steamapps/common/Hearts of Iron IV/tutorial/tutorial.txt'), undefined);
        assert.strictEqual(getHoi4FormatterProfile('/home/user/.steam/steam/steamapps/workshop/content/394360/123/common/ideas/x.txt'), 'script');
    });
});
