import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    if (index < 0) { return fallback; }
    if (!args[index + 1] || args[index + 1].startsWith('--')) { throw new Error(`${name} requires a value.`); }
    return args[index + 1];
};
const mod = option('--mod', process.env.HOI4MU_PROFILE_MOD);
const game = option('--game', process.env.HOI4MU_PROFILE_GAME);
if (!mod || !game) { throw new Error('Usage: node scripts/profile-vscode-mod.mjs --mod <directory> --game <directory> [--output <json>] [--focus <relative-file>] [--edits] [--worldmap]'); }
const modRoot = await fs.realpath(path.resolve(mod));
const gameRoot = await fs.realpath(path.resolve(game));
const extensionRoot = path.resolve(option('--extension', root));
await fs.access(path.join(extensionRoot, 'dist', 'extension.js'));
const backend = option('--backend', 'auto');
if (!['auto', 'typescript'].includes(backend)) { throw new Error('--backend must be auto or typescript.'); }
const language = option('--language', 'English');
const samples = Number(option('--samples', '3'));
if (!Number.isInteger(samples) || samples < 1 || samples > 10) { throw new Error('--samples must be between 1 and 10.'); }
const requestedOutput = path.resolve(option('--output', path.join(root, '.vscode-test', 'performance', 'realmod.json')));
let outputParent = path.dirname(requestedOutput);
const missingParents = [];
while (true) {
    try { await fs.access(outputParent); break; } catch {
        missingParents.unshift(path.basename(outputParent));
        const next = path.dirname(outputParent);
        if (next === outputParent) { throw new Error('Cannot resolve output parent.'); }
        outputParent = next;
    }
}
const output = path.join(await fs.realpath(outputParent), ...missingParents, path.basename(requestedOutput));
for (const inputRoot of [modRoot, gameRoot]) {
    const relative = path.relative(inputRoot, output);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('--output must be outside the read-only mod and game.');
    }
}
try { await fs.access(output); throw new Error('--output already exists; choose a new report path.'); }
catch (error) { if (error.code !== 'ENOENT') { throw error; } }
const session = path.join(root, '.vscode-test', 'performance', `session-${Date.now()}`);
const focusFiles = args.flatMap((value, index) => value === '--focus' ? [args[index + 1]] : []);
for (const focus of focusFiles) {
    if (!focus || focus.startsWith('--') || path.isAbsolute(focus) || path.relative(modRoot, path.resolve(modRoot, focus)).startsWith('..')) {
        throw new Error('--focus must name a file inside --mod.');
    }
}
await fs.access(path.join(modRoot, 'descriptor.mod'));
await fs.access(path.join(gameRoot, 'hoi4.exe'));
const testEntry = path.resolve(option('--test-entry', path.join(root, 'out', 'test', 'performance', 'realmod.js')));
await fs.access(testEntry);
await fs.mkdir(session, { recursive: true });
const workspace = path.join(session, 'benchmark.code-workspace');
await fs.writeFile(workspace, JSON.stringify({
    folders: [{ path: modRoot }],
    settings: {
        'hoi4ModUtilities.installPath': gameRoot,
        'hoi4ModUtilities.modFile': path.join(modRoot, 'descriptor.mod'),
        'hoi4ModUtilities.previewLocalisation': language,
        'hoi4ModUtilities.loadDlcContents': false,
        'files.autoSave': 'off',
        'workbench.editor.enablePreview': false,
        'telemetry.telemetryLevel': 'off',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
    },
}, null, 2));
// Electron-based parent applications can export this flag; VS Code must launch as an application.
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
    version: option('--version', 'stable'),
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: testEntry,
    extensionTestsEnv: {
        HOI4MU_PROFILE_MOD: modRoot,
        HOI4MU_PROFILE_GAME: gameRoot,
        HOI4MU_PROFILE_OUTPUT: output,
        HOI4MU_PROFILE_FOCUS: JSON.stringify(focusFiles),
        HOI4MU_PROFILE_SAMPLES: String(samples),
        HOI4MU_PROFILE_WORLD: args.includes('--worldmap') ? '1' : '0',
        HOI4MU_PROFILE_EDITS: args.includes('--edits') ? '1' : '0',
        HOI4MU_COMPUTE_BACKEND: backend,
        NODE_ENV: 'production',
    },
    launchArgs: [workspace, '--user-data-dir=' + path.join(session, 'user-data'),
        '--extensions-dir=' + path.join(session, 'extensions'), '--disable-extensions',
        '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu'],
});
console.log(`Real VS Code profile saved to ${output}`);
