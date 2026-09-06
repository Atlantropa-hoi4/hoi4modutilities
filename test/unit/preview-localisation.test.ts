import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import en from '../../i18n/en';
import ko from '../../i18n/ko';
import ru from '../../i18n/ru';
import zh from '../../i18n/zh-cn';

describe('MD preview localisation', () => {
    const keys = Object.keys(en).filter(key => key.startsWith('characterpreview.') || [
        'miopreview.showIncludedTraits', 'miopreview.showGrid', 'miopreview.showOverlaps', 'miopreview.gridlimit',
    ].includes(key)) as Array<keyof typeof en>;
    for (const [locale, table] of Object.entries({ en, ko, ru, 'zh-cn': zh })) {
        it(`keeps ${locale} legacy messages and runtime bundle placeholders aligned`, () => {
            const filename = locale === 'en' ? 'bundle.l10n.json' : `bundle.l10n.${locale}.json`;
            const bundle = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../..', 'l10n', filename), 'utf8')) as Record<string, string>;
            for (const key of keys) {
                const message = en[key];
                assert.strictEqual(bundle[message], table[key], `${locale}: ${key}`);
                assert.deepStrictEqual(bundle[message].match(/\{\d+\}/g), message.match(/\{\d+\}/g), `${locale}: ${key}`);
            }
        });
    }
});
