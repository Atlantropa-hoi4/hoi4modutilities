import { conditionItemToStringValue, conditionToString } from "../../src/hoiformat/condition";
import type { Bookmark, WorldMapData } from "../../src/previewdef/worldmap/definitions";

export interface WorldMapConditionOption {
    value: string;
    text: string;
}

type WorldMapConditionSource = Pick<WorldMapData, 'width' | 'height' | 'conditionExprs' | 'bookmarks'>;

export function buildWorldMapConditionOptions(
    worldMap: WorldMapConditionSource,
): WorldMapConditionOption[] | undefined {
    if (worldMap.width <= 0 || worldMap.height <= 0) {
        return undefined;
    }

    const bookmarkNames = new Map<string, string[]>();
    for (const bookmark of worldMap.bookmarks ?? []) {
        const key = bookmarkDateKey(bookmark);
        const names = bookmarkNames.get(key) ?? [];
        bookmarkNames.set(key, [...names, bookmark.name]);
    }

    return (worldMap.conditionExprs ?? []).map(option => {
        const names = option.scopeName === '' ? bookmarkNames.get(option.nodeContent) : undefined;
        return {
            value: conditionItemToStringValue(option),
            text: names ? `${names.join(' / ')} (${option.nodeContent})` : conditionToString(option),
        };
    });
}

function bookmarkDateKey(bookmark: Bookmark): string {
    const { year, month, day, hour } = bookmark.date;
    return `${year}.${month}.${day}.${hour}`;
}
