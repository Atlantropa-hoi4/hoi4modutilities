#!/usr/bin/env node
import { build } from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire, builtinModules } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const modeArg = argv.find(a => a.startsWith('--mode='))?.slice('--mode='.length);
const mode = modeArg === 'production' ? 'production' : 'development';
const isProd = mode === 'production';
const isWatch = argv.includes('--watch');

const pkg = require(path.join(rootDir, 'package.json'));
const define = {
    VERSION: JSON.stringify(pkg.version),
    EXTENSION_ID: JSON.stringify(`${pkg.publisher}.${pkg.name}`),
};

const sharedOptions = {
    bundle: true,
    sourcemap: isProd ? 'linked' : 'inline',
    minify: isProd,
    logLevel: 'info',
    loader: {
        '.html': 'text',
        '.css': 'text',
    },
    define,
    legalComments: 'none',
};

const WEBVIEW_STUBBED_MODULES = new Set([
    'vscode',
    '@vscode/extension-telemetry',
    'adm-zip',
    'pngjs',
    'tga',
    'js-yaml',
    ...builtinModules,
    ...builtinModules.map(name => `node:${name}`),
]);

const webviewStubPlugin = {
    name: 'webview-host-stubs',
    setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
            if (WEBVIEW_STUBBED_MODULES.has(args.path)) {
                return { path: args.path, namespace: 'webview-host-stub' };
            }
            return null;
        });
        build.onLoad({ filter: /.*/, namespace: 'webview-host-stub' }, args => ({
            contents: `const stub = new Proxy(function() {}, {
                get(target, prop) {
                    if (prop === '__esModule') return true;
                    if (prop === 'default') return stub;
                    return stub;
                },
                apply() { return stub; },
                construct() { return stub; },
            });
            module.exports = stub;`,
            loader: 'js',
        }));
    },
};

const staticDir = path.join(rootDir, 'static');
const distDir = path.join(rootDir, 'dist');

const webviewEntries = [
    { in: 'webviewsrc/focustree.ts', out: 'focustree' },
    { in: 'webviewsrc/eventtree.ts', out: 'eventtree' },
    { in: 'webviewsrc/techtree.ts', out: 'techtree' },
    { in: 'webviewsrc/worldmap/index.ts', out: 'worldmap' },
    { in: 'webviewsrc/gfx.ts', out: 'gfx' },
    { in: 'webviewsrc/guipreview.ts', out: 'guipreview' },
    { in: 'webviewsrc/miopreview.ts', out: 'miopreview' },
].map(e => ({ in: path.join(rootDir, e.in), out: e.out }));

async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}

async function copyAsset(src, dest) {
    await ensureDir(path.dirname(dest));
    await fs.copyFile(src, dest);
}

async function copyStaticAssets() {
    await ensureDir(staticDir);
    const codiconRoot = path.dirname(require.resolve('@vscode/codicons/package.json'));
    await copyAsset(path.join(rootDir, 'resource/common.css'), path.join(staticDir, 'common.css'));
    await copyAsset(path.join(rootDir, 'resource/preview-right-dark.svg'), path.join(staticDir, 'preview-right-dark.svg'));
    await copyAsset(path.join(rootDir, 'resource/preview-right-light.svg'), path.join(staticDir, 'preview-right-light.svg'));
    await copyAsset(path.join(codiconRoot, 'dist/codicon.css'), path.join(staticDir, 'codicon.css'));
    await copyAsset(path.join(codiconRoot, 'dist/codicon.ttf'), path.join(staticDir, 'codicon.ttf'));
}

async function buildTarget(options) {
    if (!isWatch) {
        await build(options);
        return;
    }

    const context = await build.context(options);
    await context.watch();
}

async function buildHost() {
    await buildTarget({
        ...sharedOptions,
        entryPoints: [path.join(rootDir, 'src/extension.ts')],
        outfile: path.join(distDir, 'extension.js'),
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['vscode'],
    });
}

async function buildWebviews() {
    await buildTarget({
        ...sharedOptions,
        entryPoints: webviewEntries,
        outdir: staticDir,
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
        plugins: [webviewStubPlugin],
    });
}

async function main() {
    await copyStaticAssets();
    await Promise.all([buildHost(), buildWebviews()]);
    console.log(isWatch ? `Watching bundles (${mode}).` : `Build complete (${mode}).`);

    if (isWatch) {
        await new Promise(() => undefined);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
