import * as assert from 'assert';
import {
    getWorkspaceLoggingProfile,
    updateWorkspaceLogging,
} from '../../src/hoiformat/workspaceLogging';

describe('workspace logging transformer', () => {
    it('selects only the logging file families and excludes decision category definitions', () => {
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/events/test.txt'), 'events');
        assert.strictEqual(getWorkspaceLoggingProfile('C:\\mod\\common\\ideas\\test.TXT'), 'ideas');
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/common/decisions/test.txt'), 'decisions');
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/common/national_focus/test.txt'), 'focuses');
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/common/decisions/categories/test.txt'), undefined);
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/common/scripted_effects/test.txt'), undefined);
        assert.strictEqual(getWorkspaceLoggingProfile('/mod/events/test.yml'), undefined);
    });

    it('inserts and updates event logs while preserving custom and opted-out content', () => {
        const input = '\uFEFFcountry_event = {\r\n'
            + '\tid = sample.1\r\n'
            + '\toption = {\r\n'
            + '\t\tname = sample.1.a\r\n'
            + '\t\tlog = "[GetDateText]: [Root.GetName]: event stale.1 option stale.1.a"\r\n'
            + '\t}\r\n'
            + '\toption = {\r\n'
            + '\t\tlog = "custom option audit"\r\n'
            + '\t\tadd_stability = 0.1\r\n'
            + '\t}\r\n'
            + '}\r\n'
            + 'news_event = {\r\n'
            + '\tid = sample.2\r\n'
            + '\ttitle = sample.2.t\r\n'
            + '}\r\n'
            + 'country_event = {\r\n'
            + '\tid = sample.3\r\n'
            + '\thidden = yes\r\n'
            + '}\r\n'
            + 'country_event = { #donotlog\r\n'
            + '\tid = sample.4\r\n'
            + '\toption = { name = sample.4.a }\r\n'
            + '}\r\n'
            + 'operative_leader_event = {\r\n'
            + '\tid = sample.5\r\n'
            + '\toption = { name = sample.5.a }\r\n'
            + '}\r\n';

        const result = updateWorkspaceLogging(input, '/mod/events/sample.txt');
        assert.strictEqual(result.inserted, 3);
        assert.strictEqual(result.updated, 1);
        assert.ok(result.text.startsWith('\uFEFF'));
        assert.ok(!result.text.replace(/\r\n/g, '').includes('\n'));
        assert.ok(result.text.includes('log = "[GetLogInfo]: event sample.1 option sample.1.a"'));
        assert.ok(result.text.includes('log = "[GetLogInfo]: event sample.1 option 2"\r\n\t\tlog = "custom option audit"'));
        assert.ok(result.text.includes('id = sample.2\r\n\timmediate = { log = "[GetLogInfo]: event sample.2" }'));
        assert.ok(result.text.includes('id = sample.3\r\n\timmediate = { log = "[GetLogInfo]: event sample.3" }'));
        assert.ok(!result.text.includes('event sample.4 option'));
        assert.ok(!result.text.includes('event sample.5 option'));

        const second = updateWorkspaceLogging(result.text, '/mod/events/sample.txt');
        assert.deepStrictEqual(second, { text: result.text, inserted: 0, updated: 0 });
    });

    it('adds visible idea logs, updates generated hooks, and leaves hidden ideas alone', () => {
        const input = 'ideas = {\n'
            + '\tcountry = {\n'
            + '\t\tnew_idea = { modifier = { stability_factor = 0.1 } }\n'
            + '\t\texisting_idea = {\n'
            + '\t\t\ton_add = {\n'
            + '\t\t\t\tlog = "custom idea audit"\n'
            + '\t\t\t\tlog = "[GetDateText]: [Root.GetName]: add idea stale_idea"\n'
            + '\t\t\t}\n'
            + '\t\t\ton_remove = { log = "[GetDateText]: [Root.GetName]: remove idea stale_idea" }\n'
            + '\t\t}\n'
            + '\t}\n'
            + '\thidden_ideas = {\n'
            + '\t\thidden_idea = { modifier = { stability_factor = 0.2 } }\n'
            + '\t}\n'
            + '}\n';

        const result = updateWorkspaceLogging(input, '/mod/common/ideas/sample.txt');
        assert.strictEqual(result.inserted, 1);
        assert.strictEqual(result.updated, 2);
        assert.ok(result.text.includes('new_idea = { on_add = { log = "[GetLogRoot]: add idea new_idea" }'));
        assert.ok(result.text.includes('log = "custom idea audit"'));
        assert.ok(result.text.includes('log = "[GetLogRoot]: add idea existing_idea"'));
        assert.ok(result.text.includes('log = "[GetLogRoot]: remove idea existing_idea"'));
        assert.ok(!result.text.includes('add idea hidden_idea'));
    });

    it('synchronises logs in existing decision effect blocks and detects targeted decisions', () => {
        const input = 'sample_category = {\n'
            + '\tplain_decision = {\n'
            + '\t\tcomplete_effect = {\n'
            + '\t\t\tlog = "custom completion audit"\n'
            + '\t\t\tadd_stability = 0.1\n'
            + '\t\t}\n'
            + '\t\tcancel_effect = { log = "[GetDateText]: [Root.GetName]: Decision cancel old_id" }\n'
            + '\t\tremove_effect = { #donotlog\n'
            + '\t\t\tlog = "custom removal audit"\n'
            + '\t\t}\n'
            + '\t}\n'
            + '\ttarget_decision = {\n'
            + '\t\ttarget_array = global.targets\n'
            + '\t\tcomplete_effect = { log = "[GetDateText]: [Root.GetName]: Decision complete old_id target: [From.GetName]" }\n'
            + '\t\ttimeout_effect = { }\n'
            + '\t}\n'
            + '\timplicit_target = {\n'
            + '\t\tcomplete_effect = { FROM = { add_stability = 0.1 } }\n'
            + '\t}\n'
            + '}\n';

        const result = updateWorkspaceLogging(input, '/mod/common/decisions/sample.txt');
        assert.strictEqual(result.inserted, 3);
        assert.strictEqual(result.updated, 2);
        assert.ok(result.text.includes('log = "[GetLogRoot]: Decision complete plain_decision"'));
        assert.ok(result.text.includes('log = "custom completion audit"'));
        assert.ok(result.text.includes('log = "[GetLogRoot]: Decision cancel plain_decision"'));
        assert.ok(result.text.includes('[GetLogRoot][GetLogFrom]: Decision complete target_decision'));
        assert.ok(result.text.includes('[GetLogRoot][GetLogFrom]: Decision timeout target_decision'));
        assert.ok(result.text.includes('[GetLogRoot][GetLogFrom]: Decision complete implicit_target'));
        assert.ok(!result.text.includes('Decision remove plain_decision'));
    });

    it('updates existing focus effects without creating absent effect blocks', () => {
        const input = 'focus_tree = {\n'
            + '\tfocus = {\n'
            + '\t\tid = SAMPLE_focus\n'
            + '\t\tselect_effect = { log = "[GetDateText]: [Root.GetName]: Select Focus OLD_focus" }\n'
            + '\t\tcompletion_reward = {\n'
            + '\t\t\tlog = "custom focus audit"\n'
            + '\t\t\tadd_political_power = 10\n'
            + '\t\t}\n'
            + '\t}\n'
            + '\tfocus = { id = NO_effect icon = GFX_goal_generic }\n'
            + '}\n'
            + 'shared_focus = {\n'
            + '\tid = SHARED_focus\n'
            + '\tcompletion_reward = { log = "[GetDateText]: [Root.GetName]: Focus OLD_focus" }\n'
            + '}\n'
            + 'joint_focus = {\n'
            + '\tid = JOINT_focus\n'
            + '\tcompletion_reward = { #donotlog\n'
            + '\t\tadd_stability = 0.1\n'
            + '\t}\n'
            + '}\n';

        const result = updateWorkspaceLogging(input, '/mod/common/national_focus/sample.txt');
        assert.strictEqual(result.inserted, 1);
        assert.strictEqual(result.updated, 2);
        assert.ok(result.text.includes('[GetLogRoot]: Select Focus SAMPLE_focus'));
        assert.ok(result.text.includes('[GetLogRoot]: Focus Completed SAMPLE_focus'));
        assert.ok(result.text.includes('[GetLogRoot]: Focus Completed SHARED_focus'));
        assert.ok(result.text.includes('log = "custom focus audit"'));
        assert.ok(!result.text.includes('Focus Completed NO_effect'));
        assert.ok(!result.text.includes('Focus Completed JOINT_focus'));

        const second = updateWorkspaceLogging(result.text, '/mod/common/national_focus/sample.txt');
        assert.deepStrictEqual(second, { text: result.text, inserted: 0, updated: 0 });
    });
});
