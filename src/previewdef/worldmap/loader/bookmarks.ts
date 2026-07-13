import { ConditionItem } from "../../../hoiformat/condition";
import { parseHoi4File } from "../../../hoiformat/hoiparser";
import { convertNodeToJson, SchemaDef } from "../../../hoiformat/schema";
import { error } from "../../../util/debug";
import { readFileFromModOrHOI4AsJson } from "../../../util/fileloader";
import { LoadResult, LoaderSession } from "../../../util/loader/loader";
import { uniqBy } from "lodash";
import { Bookmark, BookmarkDate, MapLoaderExtra } from "../definitions";
import { FileLoader, FolderLoader, LoadResultOD, mergeInLoadResult } from "./common";

interface BookmarkFile {
    bookmarks: BookmarksDefinition;
}

interface BookmarksDefinition {
    bookmark: BookmarkDefinition[];
}

interface BookmarkDefinition {
    name: string;
    date: string;
}

const bookmarkFileSchema: SchemaDef<BookmarkFile> = {
    bookmarks: {
        bookmark: {
            _innerType: {
                name: "string",
                date: "string",
            },
            _type: "array",
        },
    },
};

type BookmarksLoaderResult = { bookmarks: Bookmark[] };

export class BookmarksLoader extends FolderLoader<BookmarksLoaderResult, Bookmark[]> {
    constructor() {
        super('common/bookmarks', BookmarkLoader);
    }

    protected async mergeFiles(
        fileResults: LoadResult<Bookmark[], MapLoaderExtra>[],
        _session: LoaderSession,
    ): Promise<LoadResult<BookmarksLoaderResult, MapLoaderExtra>> {
        const bookmarks = uniqBy(
            mergeInLoadResult(fileResults, 'result'),
            bookmark => `${bookmarkDateToString(bookmark.date)}\0${bookmark.name}`,
        ).sort((left, right) => compareBookmarkDate(left.date, right.date));

        return {
            result: { bookmarks },
            dependencies: [this.folder + '/*'],
            warnings: mergeInLoadResult(fileResults, 'warnings'),
        };
    }

    public toString(): string {
        return `[BookmarksLoader]`;
    }
}

export function parseBookmarkDate(date: string): BookmarkDate | undefined {
    const parts = date.split('.');
    if (parts.length < 3 || parts.length > 4) {
        return undefined;
    }

    const values = parts.map(Number);
    if (values.some(value => !Number.isInteger(value))) {
        return undefined;
    }

    const [year, month, day, hour = 0] = values;
    if (year < 0 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23) {
        return undefined;
    }

    return { year, month, day, hour };
}

export function toBookmarkDate(date: string): BookmarkDate {
    return parseBookmarkDate(date) ?? { year: 0, month: 0, day: 0, hour: 0 };
}

export function compareBookmarkDate(left: BookmarkDate, right: BookmarkDate): number {
    return left.year - right.year ||
        left.month - right.month ||
        left.day - right.day ||
        left.hour - right.hour;
}

export function bookmarkDateToString(date: BookmarkDate): string {
    return `${date.year}.${date.month}.${date.day}.${date.hour}`;
}

export function bookmarkToConditionItem(bookmark: Bookmark): ConditionItem {
    return {
        scopeName: '',
        nodeContent: bookmarkDateToString(bookmark.date),
    };
}

export function parseBookmarkFileContentForTest(content: string): Bookmark[] {
    return convertBookmarkDefinitions(convertNodeToJson<BookmarkFile>(parseHoi4File(content), bookmarkFileSchema));
}

class BookmarkLoader extends FileLoader<Bookmark[]> {
    protected async loadFromFile(): Promise<LoadResultOD<Bookmark[]>> {
        return {
            result: await loadBookmark(this.file),
            warnings: [],
        };
    }

    public toString(): string {
        return `[BookmarkLoader: ${this.file}]`;
    }
}

async function loadBookmark(file: string): Promise<Bookmark[]> {
    try {
        return convertBookmarkDefinitions(await readFileFromModOrHOI4AsJson<BookmarkFile>(file, bookmarkFileSchema));
    } catch (loadError) {
        error(loadError);
        return [];
    }
}

function convertBookmarkDefinitions(data: ReturnType<typeof convertNodeToJson<BookmarkFile>>): Bookmark[] {
    const result: Bookmark[] = [];
    for (const bookmark of data.bookmarks?.bookmark ?? []) {
        if (!bookmark?.date) {
            continue;
        }

        const date = parseBookmarkDate(bookmark.date);
        if (!date) {
            continue;
        }

        result.push({
            name: bookmark.name || bookmark.date,
            date,
        });
    }
    return result;
}
