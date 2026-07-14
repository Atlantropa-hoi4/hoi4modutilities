import * as yaml from 'js-yaml';
import { YAMLException } from 'js-yaml';

export type ParsedLocalisationData = Record<string, Record<string, string>>;

export function preprocessYamlContent(fileContent: string): string {
    const lines = fileContent.split(/\r?\n/);

    // Filter out any lines that start with #, regardless of leading spaces
    const filteredLines = lines.filter(line =>
        !/^\s*#/.test(line)
    );

    const header = filteredLines.length > 0 ? filteredLines[0].replace(/^\s+/, '') : '';
    // Can't the goddamn Paradox employees and modders just write standard localization yml files?
    const processedLines = filteredLines.slice(1).map(line => {
        return ' ' + line
            .replace(/\n/g, 'YAMLParsingLFReplacement')
            .replace(
                /^\s*([^:]+?)\s*:\s*\d*\s*"((?:[^"\\]|\\.)*)"(?:\s*#.*)?$/,
                (match, p1, p2) => {
                    // Replace unescaped quotes with escaped ones
                    const escapedContent = p2.replace(/(?<!\\)"/g, '\\"');
                    return `${p1.trim()}: "${escapedContent}"`;
                }
            )
            .replace(/:(\d+)(?=[^"]*")/, ':')
            .replace(/^\s+/, '');
    }).filter(line =>
        line.trim() !== ''
    );

    return [header, ...processedLines].join('\n');
}

export function parseLocalisationFile(fileContent: string): ParsedLocalisationData {
    try {
        return parseYamlLocalisationFile(fileContent);
    } catch (e) {
        if (!(e instanceof YAMLException)) {
            throw e;
        }

        const recovered = parseLocalisationLines(fileContent);
        if (Object.values(recovered).some(entries => Object.keys(entries).length > 0)) {
            return recovered;
        }

        throw e;
    }
}

function parseYamlLocalisationFile(fileContent: string): ParsedLocalisationData {
    const result: ParsedLocalisationData = {};
    const parsed = yaml.load(fileContent, { schema: yaml.JSON_SCHEMA, json: true }) as Record<string, unknown>;

    for (const langKey in parsed) {
        if (!langKey.startsWith('l_')) {
            continue;
        }

        const entries = parsed[langKey];
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
            continue;
        }

        result[langKey] = result[langKey] || {};
        for (const key in entries) {
            const value = (entries as Record<string, unknown>)[key];
            if (typeof value === 'string') {
                result[langKey][key] = restoreLineFeeds(value);
            }
        }
    }

    return result;
}

function parseLocalisationLines(fileContent: string): ParsedLocalisationData {
    const result: ParsedLocalisationData = {};
    let currentLanguage: string | undefined;

    for (const line of fileContent.split(/\r?\n/)) {
        const header = /^\s*\uFEFF?(l_[A-Za-z_]+)\s*:\s*$/.exec(line);
        if (header) {
            currentLanguage = header[1];
            result[currentLanguage] = result[currentLanguage] || {};
            continue;
        }

        if (!currentLanguage || /^\s*#/.test(line)) {
            continue;
        }

        // Paradox localisation is line-oriented. Capture from the first opening
        // quote to the final quote so unescaped quotes in mod prose do not make
        // every otherwise valid entry in the file disappear from the index.
        const entry = /^\s*([^:#][^:]*?)\s*:\s*\d*\s*"(.*)"\s*(?:#.*)?$/.exec(line);
        if (!entry) {
            continue;
        }

        result[currentLanguage][entry[1].trim()] = restoreLineFeeds(decodeLocalisationValue(entry[2]));
    }

    return result;
}

function decodeLocalisationValue(value: string): string {
    return value.replace(/\\([\\"nrt])/g, (_match, escape: string) => {
        switch (escape) {
            case '\\': return '\\';
            case '"': return '"';
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            default: return `\\${escape}`;
        }
    });
}

function restoreLineFeeds(value: string): string {
    return value.replace(/YAMLParsingLFReplacement/g, '\n');
}
