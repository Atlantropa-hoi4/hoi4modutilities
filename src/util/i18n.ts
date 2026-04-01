import { error } from "./debug";
import enTable, { __table } from '../../i18n/en';
import koTable from '../../i18n/ko';
import ruTable from '../../i18n/ru';
import zhCnTable from '../../i18n/zh-cn';

const localeTables: Record<string, Record<string, string>> = {
    en: enTable,
    ko: koTable,
    ru: ruTable,
    'zh-cn': zhCnTable,
};

let table: Record<string, string> = {};

export function loadI18n(locale?: string) {
    const config = JSON.parse(process.env.VSCODE_NLS_CONFIG || '{}') as { locale?: string };
    locale = locale ?? config.locale ?? 'en';
    const splitLocale = locale.split('-');

    table = tryLoadTable(locale) ??
        (splitLocale.length > 1 ? tryLoadTable(splitLocale[0]) : undefined) ??
        localeTables.en;
}

function tryLoadTable(locale: string): Record<string, string> | undefined {
    try {
        return localeTables[locale.toLowerCase()];
    } catch (e) {
        error(e);
    }

    return undefined;
}

export function localize(key: keyof typeof __table | 'TODO', message: string, ...args: any[]): string {
    if (key in table) {
        message = table[key];
    }

    const regex = new RegExp('\\{(' + args.map((_, i) => i.toString()).join('|') + ')\\}', 'g');
    return message.replace(regex, (_, group1) => args[parseInt(group1, 10)]?.toString());
}

export function localizeText(text: string): string {
    return text.replace(/%(.*?)(?:\|(.*?))?%/g, (substr, key, message) => {
        if (substr === '%%') {
            return '%';
        }

        if (!key) {
            return substr;
        }

        if (!message) {
            message = key;
        }

        return localize(key, message);
    });
}

export function i18nTableAsScript(): string {
    return 'window.__i18ntable = ' + JSON.stringify(table) + ';';
}
