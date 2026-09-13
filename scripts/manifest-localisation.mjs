import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function copyManifestLocalisations(rootDir) {
    const defaults = JSON.parse(await fs.readFile(path.join(rootDir, 'package.nls.json'), 'utf8'));
    for (const language of ['en', 'ko', 'ru', 'zh-cn']) {
        const filename = `package.nls.${language}.json`;
        const translations = JSON.parse(await fs.readFile(path.join(rootDir, 'i18n', filename), 'utf8'));
        await fs.writeFile(path.join(rootDir, filename), JSON.stringify({ ...defaults, ...translations }, null, 2) + '\n');
    }
}
