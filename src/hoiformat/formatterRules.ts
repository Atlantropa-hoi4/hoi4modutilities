export interface OrderedBlockFields {
    order: readonly string[];
    required: readonly string[];
}

export const formatterLineLength = 140;

export const comparisonOperators = new Set(['=', '>', '<', '>=', '<=', '!=']);

export const guiFormatRules = {
    vectorKeys: new Set(['position', 'size', 'borderSize', 'offset', 'rotation', 'scale']),
};

export const directEventCallKeys = new Set(['country_event', 'news_event', 'unit_leader_event']);

export const orderedEventCallFields: OrderedBlockFields = {
    order: ['id', 'days', 'hours', 'random_days', 'random_hours'],
    required: ['id'],
};

export const orderedInlineBlockFields = new Map<string, OrderedBlockFields>([
    ['activate_targeted_decision', { order: ['target', 'decision'], required: ['target', 'decision'] }],
    ['remove_targeted_decision', { order: ['target', 'decision'], required: ['target', 'decision'] }],
    ['has_game_rule', { order: ['rule', 'option'], required: ['rule', 'option'] }],
    ['has_opinion', { order: ['target', 'value'], required: ['target', 'value'] }],
    ['set_province_name', { order: ['id', 'name'], required: ['id', 'name'] }],
    ['transfer_ship', { order: ['prefer_name', 'type', 'target'], required: ['type', 'target'] }],
]);

export const scriptFormatRules = {
    separatedBlockKeys: new Set([
        'focus',
        'shared_focus',
        'joint_focus',
        'country_event',
        'news_event',
        'state_event',
        'unit_leader_event',
        'ace_event',
    ]),
    inlinePreferredBlockKeys: new Set([
        'country_event',
        'news_event',
        'state_event',
        'unit_leader_event',
        'ace_event',
        'white_peace',
        'allowed',
        'hidden_trigger',
        'check_variable',
        'set_rule',
        'custom_trigger_tooltip',
        'set_technology',
        'has_equipment',
        'ai_chance',
        'ai_will_do',
        ...orderedInlineBlockFields.keys(),
        'NOT',
        'OR',
        'AND',
        'FROM',
        'ROOT',
        'PREV',
        'THIS',
    ]),
    multiLineBodyInlinePreferredBlockKeys: new Set([
        'country_event',
        'news_event',
        'state_event',
        'unit_leader_event',
        'ace_event',
        'set_technology',
        'has_equipment',
        'ai_chance',
        ...orderedInlineBlockFields.keys(),
    ]),
    multilinePreferredBlockKeys: new Set([
        'focus_tree',
        'focus',
        'shared_focus',
        'joint_focus',
        'completion_reward',
        'timeout_effect',
        'immediate',
        'option',
        'available',
        'allow_branch',
        'modifier',
        'prerequisite',
        'mutually_exclusive',
        'trigger',
        'visible',
        'complete_effect',
        'remove_trigger',
        'cancel_trigger',
        'custom_cost_trigger',
        'text',
        'bypass',
        'names',
        'provinces',
        'research_bonus',
        'equipment_bonus',
        'if',
        'else',
        'else_if',
        'limit',
        'hidden_effect',
        'effect_tooltip',
        'every_country',
        'random_country',
        'every_state',
        'random_state',
        'every_owned_state',
        'random_owned_state',
    ]),
};

export const historyMultiLineBodyInlinePreferredBlockKeys = new Set(
    [...scriptFormatRules.multiLineBodyInlinePreferredBlockKeys].filter(key => key !== 'set_technology'),
);
