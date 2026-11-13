import { andCondition, extractConditionalExprs, simplifyCondition } from '../../../hoiformat/condition';
import type { ConditionComplexExpr, ConditionItem } from '../../../hoiformat/condition';
import { extractEffectValue, findGuardedEffectItems } from '../../../hoiformat/effect';
import { parseHoi4File } from '../../../hoiformat/hoiparser';
import { convertNodeToJson } from '../../../hoiformat/schema';
import type { Bookmark, CountryNameHistory } from '../definitions';

/** Keeps script order and guards, using the same strict-before-bookmark rule as state history. */
export function parseCountryNameHistory(content: string, tag: string, bookmarks: Bookmark[], conditionExprs: ConditionItem[]): CountryNameHistory {
    const root = parseHoi4File(content);
    const children = Array.isArray(root.value) ? root.value : [];
    const result: CountryNameHistory = { tag, rulingParty: [], cosmeticTag: [], autonomies: [] };
    const scope = { scopeName: tag, scopeType: 'country' as const };
    const historyNames = ['set_politics', 'set_cosmetic_tag', 'drop_cosmetic_tag', 'set_autonomy'];
    const dated = children.filter(node => /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(node.name ?? ''));
    const entries = [{ nodes: children.filter(node => !dated.includes(node)), condition: true as ConditionComplexExpr },
        ...dated.sort((left, right) => compareDate(left.name!, right.name!)).map(node => ({
            nodes: Array.isArray(node.value) ? node.value : [],
            condition: simplifyCondition({ type: 'or', items: bookmarks.filter(bookmark => {
                const { year, month, day, hour } = bookmark.date;
                return compareDate(node.name!, `${year}.${month}.${day}.${hour}`) < 0;
            }).map(bookmark => ({ scopeName: '', nodeContent:
                `${bookmark.date.year}.${bookmark.date.month}.${bookmark.date.day}.${bookmark.date.hour}` })) }),
        })),
    ];
    for (const entry of entries) {
        for (const { item, condition: guard, possibility } of findGuardedEffectItems(extractEffectValue(entry.nodes, scope).effect, historyNames)) {
            // Random outcomes cannot be selected deterministically by the map's condition UI.
            if (possibility !== undefined || item.scopeName !== tag) {
                continue;
            }
            const condition = andCondition(entry.condition, guard);
            if (condition === false) {
                continue;
            }
            extractConditionalExprs(condition, conditionExprs);
            const name = item.node.name?.toLowerCase();
            if (name === 'set_politics') {
                const politics = convertNodeToJson<{ ruling_party: string }>(item.node, { ruling_party: 'string' });
                if (politics.ruling_party) {
                    result.rulingParty.unshift({ value: politics.ruling_party, condition });
                }
            } else if (name === 'set_autonomy') {
                const autonomy = convertNodeToJson<{ target: string; autonomous_state: string }>(item.node,
                    { target: 'string', autonomous_state: 'string' });
                if (autonomy.target && autonomy.autonomous_state) {
                    result.autonomies.unshift({ value: { target: autonomy.target, autonomousState: autonomy.autonomous_state }, condition });
                }
            } else {
                const value = name === 'drop_cosmetic_tag' ? '' : convertNodeToJson<string>(item.node, 'string');
                if (value !== undefined) {
                    result.cosmeticTag.unshift({ value, condition });
                }
            }
        }
    }
    return result;
}

function compareDate(left: string, right: string): number {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let index = 0; index < 4; index++) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference) {
            return difference;
        }
    }
    return 0;
}
