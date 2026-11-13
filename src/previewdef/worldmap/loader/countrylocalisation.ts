import { applyCondition } from '../../../hoiformat/condition';
import type { ConditionItem } from '../../../hoiformat/condition';
import type { Country, CountryLabelsData, WithCondition } from '../definitions';

export function getCountryLocalisationKeys(tag: string, rulingParty?: string, cosmeticTag?: string,
    autonomy?: { overlord: string, autonomousState: string }): string[] {
    const keys: string[] = [];
    if (cosmeticTag) {
        if (rulingParty) {
            keys.push(`${cosmeticTag}_${rulingParty}`);
        }
        keys.push(cosmeticTag);
    }
    if (autonomy) {
        keys.push(`${tag}_${autonomy.overlord}_${autonomy.autonomousState}`);
    }
    if (rulingParty) {
        keys.push(`${tag}_${rulingParty}`);
    }
    keys.push(tag);
    return keys;
}

export function findCountryLocalisedName(keys: string[], getLocalisedText: (key: string) => string | undefined): string | undefined {
    for (const key of keys) {
        const localisedName = getLocalisedText(key);
        if (localisedName && localisedName !== key) {
            return localisedName;
        }
    }
    return undefined;
}

export function resolveCountryName(country: Country, labels: CountryLabelsData | undefined, conditions: ConditionItem[]): string {
    const history = labels?.histories.find(item => item.tag === country.tag);
    const active = <T>(items: WithCondition<T>[] | undefined): T | undefined =>
        items?.find(item => applyCondition(item.condition, conditions))?.value;
    let autonomy: { overlord: string; autonomousState: string } | undefined;
    for (const overlord of labels?.histories ?? []) {
        const value = active(overlord.autonomies.filter(item => item.value.target === country.tag));
        if (value) {
            autonomy = value.autonomousState === 'autonomy_free' ? undefined :
                { overlord: overlord.tag, autonomousState: value.autonomousState };
        }
    }
    const keys = getCountryLocalisationKeys(country.tag, active(history?.rulingParty), active(history?.cosmeticTag), autonomy);
    return findCountryLocalisedName(keys, key => labels?.localisations[key]) ?? country.localisedName ?? country.tag;
}


