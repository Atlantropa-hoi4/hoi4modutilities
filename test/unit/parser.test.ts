import * as assert from 'assert';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson, DetailValue, NumberLike, Raw, parseVariableReference } from '../../src/hoiformat/schema';
import { tryMoveScope, countryScope } from '../../src/hoiformat/scope';
import { nodeToString } from '../../src/hoiformat/tostring';
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

    it('preserves dotted date-like values as single symbolic values', () => {
        const node = parseHoi4File('date > 1936.1.1');
        const [dateNode] = node.value as any[];

        assert.strictEqual(dateNode.operator, '>');
        assert.strictEqual(dateNode.value.name, '1936.1.1');
        assert.strictEqual(dateNode.valueStartToken.value, '1936.1.1');
    });

    it('parses signed and trailing-dot numbers plus signed number-like values', () => {
        const node = parseHoi4File([
            'positive = +0.10',
            'trailing_dot = 0.',
            'negative_zero = -0.0',
            'leading_dot = .5',
            'percent_value = +35%%',
        ].join('\n'));
        const parsed = convertNodeToJson<{
            positive: number;
            trailing_dot: number;
            negative_zero: number;
            leading_dot: number;
            percent_value: NumberLike;
        }>(node, {
            positive: 'number',
            trailing_dot: 'number',
            negative_zero: 'number',
            leading_dot: 'number',
            percent_value: 'numberlike',
        });

        assert.strictEqual(parsed.positive, 0.1);
        assert.strictEqual(parsed.trailing_dot, 0);
        assert.strictEqual(Object.is(parsed.negative_zero, -0), true);
        assert.strictEqual(parsed.leading_dot, 0.5);
        assert.strictEqual(parsed.percent_value?._value, 35);
        assert.strictEqual(parsed.percent_value?._unit, '%%');
    });

    it('parses comparison operators using longest-token matching', () => {
        const node = parseHoi4File([
            'compare >= 2',
            'compare <= value',
            'compare != no',
        ].join('\n'));
        const operators = (node.value as any[]).map(child => child.operator);

        assert.deepStrictEqual(operators, ['>=', '<=', '!=']);
    });

    it('parses permissive HOI4 bare symbols', () => {
        const node = parseHoi4File([
            'add = -num_armies',
            'target = var:361.owner',
            'names = { Édouard Åslund O\'Connor Ra\'i “Shipka” }',
        ].join('\n'));
        const [addNode, targetNode, namesNode] = node.value as any[];

        assert.strictEqual(addNode.value.name, '-num_armies');
        assert.strictEqual(targetNode.value.name, 'var:361.owner');
        assert.deepStrictEqual((namesNode.value as any[]).map(child => child.name), [
            'Édouard',
            'Åslund',
            'O\'Connor',
            'Ra\'i',
            '“Shipka”',
        ]);
    });

    it('parses anonymous block lists used by medals and ribbons', () => {
        const node = parseHoi4File([
            'colors = {',
            '    { bronze = { 155.0 105.0 87.0 1.0 } }',
            '    { silver = { 1.0 1.0 1.0 1.0 } }',
            '}',
        ].join('\n'));
        const [colorsNode] = node.value as any[];
        const [bronzeLayer, silverLayer] = colorsNode.value as any[];

        assert.strictEqual(bronzeLayer.name, null);
        assert.strictEqual(bronzeLayer.operator, null);
        assert.strictEqual((bronzeLayer.value as any[])[0].name, 'bronze');
        assert.strictEqual((silverLayer.value as any[])[0].name, 'silver');
        assert.match(nodeToString(bronzeLayer), /^\{ bronze = \{/);
    });
});
