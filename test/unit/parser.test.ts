import * as assert from 'assert';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson, DetailValue, NumberLike, Raw, parseVariableReference } from '../../src/hoiformat/schema';
import { tryMoveScope, countryScope } from '../../src/hoiformat/scope';
import { readFixture } from '../testUtils';

interface ParserFixture {
    symbol_with_pipe: string;
    array_entry: number;
    scoped_total: number;
    targeted_total: number;
    percent_value: NumberLike;
    attached_value: DetailValue<Raw>;
}

const parserFixtureSchema = {
    symbol_with_pipe: 'string',
    array_entry: 'number',
    scoped_total: 'number',
    targeted_total: 'number',
    percent_value: 'numberlike',
    attached_value: {
        _innerType: 'raw',
        _type: 'detailvalue',
    },
} as const;

describe('parser fixtures', () => {
    it('parses modern scoped variable and attachment syntax', () => {
        const node = parseHoi4File(readFixture('parser', 'modern-syntax.txt'));
        const parsed = convertNodeToJson<ParserFixture>(node, parserFixtureSchema);

        assert.strictEqual(parsed.symbol_with_pipe, 'building_state_modifier|dam');
        assert.strictEqual(parsed.array_entry, 0);
        assert.strictEqual(parsed.scoped_total, 12.5);
        assert.strictEqual(parsed.targeted_total, 3);
        assert.strictEqual(parsed.percent_value?._value, 35);
        assert.strictEqual(parsed.percent_value?._unit, '%%');
        assert.strictEqual(parsed.attached_value?._attachment, 'producer_tag');
        assert.strictEqual(parsed.attached_value?._operator, '=');

        const attachmentNode = parsed.attached_value?._value?._raw;
        assert.ok(Array.isArray(attachmentNode?.value));
        assert.strictEqual(attachmentNode?.name, 'attached_value');
    });

    it('parses expanded variable references used by recent HOI4 scripts', () => {
        const arrayRef = parseVariableReference('equipment_stockpile^0');
        const scopedRef = parseVariableReference('province_controllers^1234:capital:resistance_score?12.5');
        const targetedRef = parseVariableReference('var:GER.capital:factory_count@ROOT?3');

        assert.strictEqual(arrayRef?.var, 'equipment_stockpile^0');
        assert.strictEqual(scopedRef?.scope, 'province_controllers^1234:capital');
        assert.strictEqual(scopedRef?.var, 'resistance_score');
        assert.strictEqual(scopedRef?.defaultValue, 12.5);
        assert.strictEqual(targetedRef?.prefix, 'var');
        assert.strictEqual(targetedRef?.scope, 'GER.capital');
        assert.strictEqual(targetedRef?.target, 'ROOT');
        assert.strictEqual(targetedRef?.defaultValue, 3);
    });

    it('treats explicit scoped variables as standalone scope hops', () => {
        const node = parseHoi4File('province_controllers^1234:capital:resistance_score = { hidden_effect = { } }');
        const scopeStack = [{ ...countryScope }];
        const moved = tryMoveScope((node.value as any[])[0], scopeStack, 'effect');

        assert.strictEqual(moved, true);
        assert.strictEqual(scopeStack[1]?.scopeType, 'unknown');
        assert.strictEqual(scopeStack[1]?.scopeName, '{province_controllers^1234:capital:resistance_score}');
    });

    it('parses date', () => {
        const node = parseHoi4File(readFixture('parser', 'date.txt'));
        const parsed = convertNodeToJson<{
            '2026.4.7': {
                date: string;
            }
        }>(node, {
            '2026.4.7': {
                date: 'string'
            },
        });

        assert.strictEqual(parsed['2026.4.7']?.date, '2026-4-7')
    });
});
