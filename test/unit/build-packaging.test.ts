import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('build packaging', () => {
    it('removes only generated build directories before rebuilding', async () => {
        const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hoi4mu-build-output-'));
        try {
            await Promise.all([
                writeFixture(path.join(testRoot, 'dist', 'obsolete.js')),
                writeFixture(path.join(testRoot, 'static', 'obsolete.js')),
                writeFixture(path.join(testRoot, 'resource', 'keep.css')),
            ]);

            const helperPath = path.resolve(__dirname, '../../../scripts/build-output.mjs');
            const helper = await import(pathToFileURL(helperPath).href) as {
                cleanBuildOutputDirectories(rootDir: string): Promise<void>;
            };
            await helper.cleanBuildOutputDirectories(testRoot);

            assert.strictEqual(await exists(path.join(testRoot, 'dist')), false);
            assert.strictEqual(await exists(path.join(testRoot, 'static')), false);
            assert.strictEqual(await exists(path.join(testRoot, 'resource', 'keep.css')), true);
        } finally {
            await fs.rm(testRoot, { recursive: true, force: true });
        }
    });

    it('excludes non-runtime and obsolete artifacts from the VSIX', async () => {
        const repositoryRoot = path.resolve(__dirname, '../../..');
        const ignoreEntries = new Set(
            (await fs.readFile(path.join(repositoryRoot, '.vscodeignore'), 'utf8'))
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean),
        );

        for (const entry of [
            '*.vsix',
            '.codex/**',
            'AGENTS.md',
            'FlagAutoResizer.py',
            'FOCUS_EXAMPLE/**',
            'outputs/**',
            'dist/web-extension.js',
            'static/common.js',
            'static/common.js.LICENSE.txt',
        ]) {
            assert.ok(ignoreEntries.has(entry), `expected .vscodeignore to contain ${entry}`);
        }

        for (const requiredRuntimePath of ['dist/extension.js', 'static/focustree.js', 'l10n/**']) {
            assert.ok(!ignoreEntries.has(requiredRuntimePath), `runtime path must remain packageable: ${requiredRuntimePath}`);
        }
    });
});

async function writeFixture(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'fixture');
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
