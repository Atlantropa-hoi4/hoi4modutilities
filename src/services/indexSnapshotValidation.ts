import { isIndexSnapshot } from './indexSerializationProtocol';

function isIndexRecordOf<T>(value: unknown, validateEntry: (entry: unknown) => entry is T): value is Record<string, T> {
    if (!isIndexSnapshot(value)) { return false; }
    for (const key in value) {
        if (Object.hasOwn(value, key) && !validateEntry(value[key])) { return false; }
    }
    return true;
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

export function isStringIndexRecord(value: unknown): value is Record<string, string> {
    return isIndexRecordOf(value, isString);
}

function isLocalisationData(value: unknown): value is Record<string, Record<string, string>> {
    return isIndexRecordOf(value, isStringIndexRecord);
}

export function isLocalisationIndexSnapshot(value: unknown): value is {
    index: Record<string, Record<string, string>>;
    fileIndexes?: Record<string, Record<string, Record<string, string>>>;
} {
    return isIndexSnapshot(value) && isLocalisationData(value.index)
        && (value.fileIndexes === undefined || isIndexRecordOf(value.fileIndexes, isLocalisationData));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}

function isFocusIndexState(value: unknown): value is { byFile: Record<string, string[]>; byId: Record<string, string[]> } {
    return isIndexSnapshot(value) && isIndexRecordOf(value.byFile, isStringArray) && isIndexRecordOf(value.byId, isStringArray);
}

export function isFocusIndexSnapshot(value: unknown): value is {
    index: { byFile: Record<string, string[]>; byId: Record<string, string[]> };
    dlcIndex?: { byFile: Record<string, string[]>; byId: Record<string, string[]> };
} {
    return isIndexSnapshot(value) && isFocusIndexState(value.index)
        && (value.dlcIndex === undefined || isFocusIndexState(value.dlcIndex));
}

function isGfxIndexItem(value: unknown): value is { file: string } | undefined {
    return value === undefined || (isIndexSnapshot(value) && typeof value.file === 'string');
}

export function isGfxIndexSnapshot(value: unknown): value is {
    index: Record<string, { file: string } | undefined>;
    dlcIndex?: Record<string, { file: string } | undefined>;
} {
    return isIndexSnapshot(value) && isIndexRecordOf(value.index, isGfxIndexItem)
        && (value.dlcIndex === undefined || isIndexRecordOf(value.dlcIndex, isGfxIndexItem));
}

export function isEventIndexSnapshot(value: unknown): value is { index: Record<string, string> } {
    return isIndexSnapshot(value) && isStringIndexRecord(value.index);
}
