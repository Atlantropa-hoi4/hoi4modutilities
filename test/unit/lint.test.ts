import * as assert from 'assert';
import { collectHoi4LintFindings, Hoi4LintFinding } from '../../src/hoiformat/lint';

describe('HOI4 lint autofixes', () => {
    it('converts legacy check_variable comparisons to operator syntax', () => {
        const cases = [
            ['less_than', 'check_variable = { score < 10 }'],
            ['greater_than', 'check_variable = { score > 10 }'],
            ['equals', 'check_variable = { score = 10 }'],
            ['less_than_or_equals', 'NOT = { check_variable = { score > 10 } }'],
            ['greater_than_or_equals', 'NOT = { check_variable = { score < 10 } }'],
            ['not_equals', 'NOT = { check_variable = { score = 10 } }'],
        ];

        for (const [comparison, expected] of cases) {
            const input = [
                'trigger = {',
                '\tcheck_variable = {',
                '\t\tvar = score',
                '\t\tvalue = 10',
                `\t\tcompare = ${comparison}`,
                '\t}',
                '}',
            ].join('\n');
            const findings = collectHoi4LintFindings(input, 'C:/mod/common/scripted_triggers/test.txt');

            assert.strictEqual(findings.length, 1);
            assert.strictEqual(findings[0].rule, 'legacy-check-variable');
            assert.strictEqual(applyFindings(input, findings), `trigger = {\n\t${expected}\n}`);
        }
    });

    it('does not rewrite check_variable blocks with comments, extra fields, or duplicate fields', () => {
        const input = [
            'trigger = {',
            '\tcheck_variable = {',
            '\t\tvar = score # preserve this explanation',
            '\t\tvalue = 10',
            '\t\tcompare = less_than',
            '\t}',
            '\tcheck_variable = { var = score value = 10 compare = equals extra = yes }',
            '\tcheck_variable = { var = score value = 10 value = 20 compare = equals }',
            '}',
        ].join('\n');

        assert.deepStrictEqual(
            collectHoi4LintFindings(input, 'C:/mod/common/scripted_triggers/test.txt'),
            [],
        );
    });

    it('does not offer script fixes while braces are unbalanced', () => {
        const input = 'trigger = { check_variable = { var = score value = 10 compare = equals }';
        assert.deepStrictEqual(
            collectHoi4LintFindings(input, 'C:/mod/common/scripted_triggers/test.txt'),
            [],
        );
    });

    it('removes ai_chance only from root events with exactly one option', () => {
        const input = [
            'country_event = {',
            '\tid = test.1',
            '\toption = {',
            '\t\tname = test.1.a',
            '\t\tai_chance = {',
            '\t\t\tfactor = 50',
            '\t\t\tcheck_variable = { var = score value = 10 compare = equals }',
            '\t\t}',
            '\t\tadd_stability = 0.1',
            '\t}',
            '}',
            '',
            'country_event = {',
            '\tid = test.2',
            '\toption = { name = test.2.a ai_chance = { factor = 50 } }',
            '\toption = { name = test.2.b }',
            '}',
        ].join('\r\n');
        const findings = collectHoi4LintFindings(input, 'C:/mod/events/test.txt');

        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].rule, 'redundant-single-option-ai-chance');
        assert.strictEqual(applyFindings(input, findings), [
            'country_event = {',
            '\tid = test.1',
            '\toption = {',
            '\t\tname = test.1.a',
            '\t\tadd_stability = 0.1',
            '\t}',
            '}',
            '',
            'country_event = {',
            '\tid = test.2',
            '\toption = { name = test.2.a ai_chance = { factor = 50 } }',
            '\toption = { name = test.2.b }',
            '}',
        ].join('\r\n'));
    });

    it('keeps single-option ai_chance blocks that contain comments', () => {
        const input = [
            'country_event = {',
            '\tid = test.1',
            '\toption = {',
            '\t\tai_chance = { factor = 50 } # retained policy note',
            '\t}',
            '}',
        ].join('\n');

        assert.deepStrictEqual(collectHoi4LintFindings(input, 'C:/mod/events/test.txt'), []);
    });

    it('removes localisation version numbers without changing BOM or values', () => {
        const input = '\uFEFFl_english:\r\n KEY_ONE:0 "Text:1 remains"\r\n KEY_TWO:12 "Second"\r\n';
        const findings = collectHoi4LintFindings(input, 'C:/mod/localisation/english/test_l_english.yml');

        assert.strictEqual(findings.length, 2);
        assert.ok(findings.every(finding => finding.rule === 'localisation-version-marker'));
        assert.strictEqual(
            applyFindings(input, findings),
            '\uFEFFl_english:\r\n KEY_ONE: "Text:1 remains"\r\n KEY_TWO: "Second"\r\n',
        );
        assert.deepStrictEqual(collectHoi4LintFindings(input, 'C:/mod/data/test.yml'), []);
    });
});

function applyFindings(text: string, findings: Hoi4LintFinding[]): string {
    return [...findings]
        .sort((left, right) => right.start - left.start)
        .reduce((result, finding) =>
            result.slice(0, finding.start) + finding.replacement + result.slice(finding.end), text);
}
