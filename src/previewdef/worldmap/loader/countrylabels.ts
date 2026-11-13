import { uniqBy } from 'lodash';
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from '../../../util/fileloader';
import { getLocalisedTextQuickIfReady } from '../../../util/localisationIndex';
import { createConcurrencyLimiter } from '../../../util/common';
import { error } from '../../../util/debug';
import type { LoaderSession } from '../../../util/loader/loader';
import type { ConditionItem } from '../../../hoiformat/condition';
import type { Bookmark, Country, CountryLabelsData, CountryNameHistory } from '../definitions';
import type { LoadResult } from './common';
import { parseCountryNameHistory } from './countryhistory';
import { getCountryLocalisationKeys } from './countrylocalisation';
import { loadMapFont } from './mapfont';

export async function loadCountryLabelsData(countries: Country[], bookmarks: Bookmark[], session: LoaderSession): Promise<LoadResult<CountryLabelsData>> {
    const conditionExprs: ConditionItem[] = [];
    const run = createConcurrencyLimiter(4);
    const files = (await listFilesFromModOrHOI4('history/countries')).filter(file => file.toLowerCase().endsWith('.txt'));
    session.throwIfCancelled();
    const histories = (await Promise.all(files.map(file => run(async () => {
        session.throwIfCancelled();
        const tag = file.replace(/\\/g, '/').split('/').pop()?.match(/^([A-Za-z0-9_]+)/)?.[1];
        if (!tag) { return undefined; }
        try {
            const [content] = await readFileFromModOrHOI4('history/countries/' + file);
            session.throwIfCancelled();
            return parseCountryNameHistory(content.toString(), tag, bookmarks, conditionExprs);
        } catch (e) {
            session.throwIfCancelled();
            error(e);
            return undefined;
        }
    })))).filter((history): history is CountryNameHistory => !!history);
    session.throwIfCancelled();
    const localisations: Record<string, string> = {};
    for (const country of countries) {
        const history = histories.find(item => item.tag === country.tag);
        const parties = new Set([undefined, ...(history?.rulingParty.map(item => item.value) ?? [])]);
        const cosmetics = new Set([undefined, ...(history?.cosmeticTag.map(item => item.value) ?? [])]);
        const keys = new Set<string>();
        for (const party of parties) {
            for (const cosmetic of cosmetics) {
                getCountryLocalisationKeys(country.tag, party, cosmetic).forEach(key => keys.add(key));
            }
        }
        for (const overlord of histories) {
            for (const autonomy of overlord.autonomies) {
                if (autonomy.value.target === country.tag) {
                    keys.add(`${country.tag}_${overlord.tag}_${autonomy.value.autonomousState}`);
                }
            }
        }
        for (const key of keys) {
            const value = getLocalisedTextQuickIfReady(key);
            if (value && value !== key) { localisations[key] = value; }
        }
    }
    const font = await loadMapFont([...Object.values(localisations), ...countries.map(country => country.localisedName ?? country.tag)], session);
    session.throwIfCancelled();
    return {
        result: { histories, localisations, mapFont: font.result,
            conditionExprs: uniqBy(conditionExprs, item => `${item.scopeName}\0${item.nodeContent}`) },
        dependencies: ['history/countries/*', 'history/countries/**/*', ...font.dependencies],
        warnings: font.warnings,
    };
}
