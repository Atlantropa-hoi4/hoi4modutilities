import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { buildSync } from 'esbuild';

describe('card preview bundle startup', () => {
    for (const entry of ['ideapreview', 'eventtree', 'decisiontree', 'characterpreview']) {
        for (const stored of [undefined, [], ['traits', 'chains', 'unknown']]) {
            it(`${entry} registers its load and refresh handlers with ${JSON.stringify(stored)} filters`, () => {
                // Bundle the source like the shipped browser entry. CommonJS-only tests hide
                // reads of an exported filter list before the list has been initialized.
                const source = path.resolve(__dirname, '../../..', 'webviewsrc', `${entry}.ts`);
                assert.ok(fs.existsSync(source));
                const result = buildSync({
                    entryPoints: [source],
                    bundle: true,
                    write: false,
                    platform: 'browser',
                    format: 'iife',
                    define: { VERSION: '"test"', EXTENSION_ID: '"test.extension"' },
                });
                const listeners: string[] = [];
                const window = { addEventListener: (type: string) => listeners.push(type), __i18ntable: {} };
                vm.runInNewContext(result.outputFiles[0].text, {
                    window,
                    document: {},
                    console,
                    setTimeout,
                    clearTimeout,
                    acquireVsCodeApi: () => ({
                        postMessage: () => undefined,
                        getState: () => ({ ideaFilters: stored, eventFilters: stored, decisionFilters: stored, characterFilters: stored }),
                        setState: () => undefined,
                    }),
                }, { filename: `${entry}.js`, timeout: 5000 });
                assert.strictEqual(listeners.filter(type => type === 'load').length, 2);
                assert.ok(listeners.includes('message'));
            });
        }
    }
});
