import * as assert from 'assert';
import { extractConditionValue } from '../../src/hoiformat/condition';
import { extractEffectValue, findGuardedEffectItems, projectEffects } from '../../src/hoiformat/effect';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { countryScope, tryMoveScope } from '../../src/hoiformat/scope';
import type { Scope } from '../../src/hoiformat/scope';
import { getEvents } from '../../src/previewdef/event/schema';

describe('modern script scopes', () => {
    it('keeps event links inside allied, other-country, faction and collection effects', () => {
        const events = getEvents(parseHoi4File(`add_namespace = scopes
            country_event = { id = scopes.1 option = { name = scopes.a
                every_allied_country = { country_event = { id = scopes.2 } }
                random_other_country = { country_event = { id = scopes.3 } }
                every_faction_member = { country_event = { id = scopes.4 } }
                every_collection_element = { country_event = { id = scopes.5 } }
            } }`), 'events/scopes.txt');
        const calls = events.eventItemsByNamespace.scopes[0].options[0].childEvents;

        assert.deepStrictEqual(calls.map(call => call.eventName), ['scopes.2', 'scopes.3', 'scopes.4', 'scopes.5']);
        assert.ok(calls[0].scopeName.endsWith('every_allied_country'));
        assert.ok(calls[1].scopeName.endsWith('random_other_country'));
    });

    it('extracts owner and controller conditions inside a state as country leaves', () => {
        const value = extractConditionValue(parseHoi4File(`1 = {
            owner = { tag = GER }
            controller = { tag = FRA }
        }`).value, countryScope);

        assert.deepStrictEqual(value.exprs, [
            { scopeName: '1.owner', nodeContent: 'tag = GER' },
            { scopeName: '1.controller', nodeContent: 'tag = FRA' },
        ]);
    });

    it('extracts scientist, state-list and country-list conditions instead of opaque blocks', () => {
        const value = extractConditionValue(parseHoi4File(`
            any_scientist = { has_trait = brilliant }
            all_active_scientist = { has_trait = experienced }
            any_state_in = { state_population > 1000 }
            all_country_of = { has_war = yes }
            any_state_of = { is_coastal = yes }
            all_other_country = { has_war = no }
        `).value, countryScope);

        assert.deepStrictEqual(value.exprs.map(item => item.scopeName), [
            'any_scientist', 'all_active_scientist', 'any_state_in',
            'all_country_of', 'any_state_of', 'all_other_country',
        ]);
        assert.ok(value.exprs.every(item => !item.nodeContent.includes('{')));
    });

    it('recognizes purchase-contract effects while retaining the earlier spelling', () => {
        const value = extractEffectValue(parseHoi4File(`
            every_purchase_contract = { cancel_purchase_contract = yes }
            every_military_purchase_contract = { cancel_purchase_contract = yes }
        `).value, countryScope);

        assert.deepStrictEqual(projectEffects(value.effect), [
            { kind: 'line', scopeName: 'every_purchase_contract', content: 'cancel_purchase_contract = yes' },
            { kind: 'line', scopeName: 'every_military_purchase_contract', content: 'cancel_purchase_contract = yes' },
        ]);
    });

    it('uses a special-project scope before the generic variable-reference fallback', () => {
        const node = parseHoi4File('sp:atomic_bomb = { complete_special_project = yes }');
        assert.ok(Array.isArray(node.value));
        const stack: Scope[] = [{ ...countryScope }];

        assert.strictEqual(tryMoveScope(node.value[0], stack, 'effect'), true);
        assert.deepStrictEqual(stack[1], { scopeName: 'atomic_bomb', scopeType: 'specialProject' });
        const invalid = parseHoi4File('every_scientist = { retire = yes }');
        assert.ok(Array.isArray(invalid.value));
        assert.strictEqual(tryMoveScope(invalid.value[0], stack, 'effect'), false);
        assert.strictEqual(stack.length, 2);
    });

    it('preserves MIO FROM and explicit variable scopes around newly supported effects', () => {
        const value = extractEffectValue(parseHoi4File(`mio:ger_mio = {
            FROM = { every_allied_country = { country_event = { id = scopes.2 } } }
            var:target = { country_event = { id = scopes.3 } }
            event_target:recipient = { country_event = { id = scopes.4 } }
        }`).value, countryScope);
        const calls = findGuardedEffectItems(value.effect, ['country_event']);

        assert.deepStrictEqual(calls.map(call => call.item.scopeName), [
            'FROM.every_allied_country', 'ger_mio.{var:target}', '{event_target:recipient}',
        ]);
    });
});
