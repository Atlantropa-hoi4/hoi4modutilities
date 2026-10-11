#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Read-only real-mod profiling. No build outputs or production sources are written.
// Usage: node --expose-gc scripts/profile-mod.mjs --mod <directory> [--output <report.json>]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limits = {
    inventoryEntries: 200_000, inventoryMs: 120_000, directoryDepth: 32,
    textFileBytes: 32 * 1024 * 1024, focusFiles: 2000, focusBytes: 256 * 1024 * 1024,
    localisationFiles: 24, localisationBytes: 32 * 1024 * 1024,
    binaryFileBytes: 128 * 1024 * 1024, mapPixels: 16 * 1024 * 1024,
    texturePixels: 16 * 1024 * 1024, pngPixels: 4 * 1024 * 1024,
    hashBytes: 512 * 1024 * 1024, textureHeaders: 96,
};
const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const bySize = (left, right) => right.bytes - left.bytes || comparePath(left.path, right.path);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = filename => path.relative(root, filename).split(path.sep).join('/');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function optionsFromArgs(args) {
    const options = { samples: 3, warmups: 3, maxSeconds: 600 };
    const names = { '--mod': 'mod', '--output': 'output', '--samples': 'samples',
        '--warmups': 'warmups', '--max-seconds': 'maxSeconds' };
    for (let index = 0; index < args.length; index++) {
        if (args[index] === '--help' || args[index] === '-h') {
            console.log('Usage: node [--expose-gc] scripts/profile-mod.mjs --mod <directory> [--output <report.json>]\n'
                + 'Options: --samples <3..20> (3), --warmups <0..10> (3), --max-seconds <30..3600> (600).\n'
                + 'JSON goes to stdout; progress goes to stderr. Only --output writes a file.\n'
                + 'Uses current TypeScript sources in memory and existing dist compute artifacts; never builds them.');
            return;
        }
        const [name, inline] = args[index].split(/=(.*)/s);
        const key = names[name];
        if (!key) { throw new Error(`Unknown argument: ${name}`); }
        const value = inline ?? args[++index];
        if (!value || value.startsWith('--')) { throw new Error(`Missing value for ${name}`); }
        options[key] = ['samples', 'warmups', 'maxSeconds'].includes(key) ? Number(value) : value;
    }
    if (!options.mod) { throw new Error('--mod is required; no developer path is assumed.'); }
    for (const [key, minimum, maximum] of [['samples', 3, 20], ['warmups', 0, 10], ['maxSeconds', 30, 3600]]) {
        if (!Number.isInteger(options[key]) || options[key] < minimum || options[key] > maximum) {
            throw new Error(`${key} must be an integer in ${minimum}..${maximum}.`);
        }
    }
    return options;
}

function git(args) {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return undefined; }
}

// Reject outputs inside the mod, including symlinked parent directories.
async function outputPath(filename, mod) {
    if (!filename) { return; }
    const absolute = path.resolve(filename);
    let parent = path.dirname(absolute);
    const missing = [];
    while (!fs.existsSync(parent)) { missing.unshift(path.basename(parent)); parent = path.dirname(parent); }
    const resolved = path.join(await fsp.realpath(parent), ...missing, path.basename(absolute));
    const isWithin = (base, target) => {
        const rel = path.relative(base, target);
        return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
    };
    if (isWithin(mod, resolved)) { throw new Error('--output must be outside the read-only mod.'); }
    for (const name of ['src', 'webviewsrc', 'scripts', 'out', 'dist', 'static', '.git', 'rust', 'test']) {
        if (isWithin(path.join(root, name), resolved)) { throw new Error(`--output cannot overwrite ${name}/.`); }
    }
    if (fs.existsSync(absolute)) { throw new Error(`--output already exists; choose a new report path: ${absolute}`); }
    return absolute;
}

async function inventory(mod) {
    const started = performance.now();
    const result = { files: [], visitedEntries: 0, skippedSymlinks: 0, truncated: false, errors: [], roots: [] };
    const directories = ['common/national_focus', 'events', 'interface', 'localisation', 'localization',
        'gfx', 'portraits', 'map', 'common/defines'];
    const stop = () => result.visitedEntries >= limits.inventoryEntries || performance.now() - started >= limits.inventoryMs;
    async function walk(directory, depth = 0) {
        if (stop() || depth > limits.directoryDepth) { result.truncated = true; return; }
        let entries;
        try { entries = await fsp.readdir(path.join(mod, directory), { withFileTypes: true }); }
        catch (error) {
            if (error.code !== 'ENOENT') { result.errors.push({ path: directory, error: error.message }); }
            return;
        }
        entries.sort((left, right) => comparePath(left.name, right.name));
        for (const entry of entries) {
            if (stop()) { result.truncated = true; return; }
            result.visitedEntries++;
            const filename = `${directory}/${entry.name}`;
            if (entry.isSymbolicLink()) { result.skippedSymlinks++; continue; }
            if (entry.isDirectory()) { await walk(filename, depth + 1); }
            else if (entry.isFile()) {
                try {
                    const stat = await fsp.stat(path.join(mod, filename));
                    result.files.push({ path: filename, bytes: stat.size, modifiedUtc: stat.mtime.toISOString() });
                } catch (error) { result.errors.push({ path: filename, error: error.message }); }
            }
        }
    }
    for (const directory of directories) {
        // A mod-supplied junction must not extend the read-only scan outside its root.
        try {
            const stat = await fsp.lstat(path.join(mod, directory));
            if (stat.isSymbolicLink()) { result.skippedSymlinks++; continue; }
        } catch (error) { if (error.code === 'ENOENT') { continue; } throw error; }
        result.roots.push(directory);
        await walk(directory);
    }
    result.files.sort((left, right) => comparePath(left.path, right.path));
    result.durationMs = performance.now() - started;
    return result;
}

async function loadProductionCode() {
    const provinceFile = path.join(root, 'src/previewdef/worldmap/loader/provincebmp.ts');
    const inputs = new Map();
    const source = `
export { parseHoi4File } from './src/hoiformat/hoiparser';
export { convertNodeToJson } from './src/hoiformat/schema';
export { convertFocusFileNodeToJson, createFocusTreeSourceSnapshot, getFocusTreeFromSourceSnapshot } from './src/previewdef/focustree/schema';
export { parseLocalisationFileContent } from './src/util/localisationparser';
export { DDS } from './src/util/image/dds/dds';
export { pixelFormatToString } from './src/util/image/dds/pixelformat';
export { RustWasmCompute } from './src/util/compute/wasm';
export { RustComputeService, registerRustCompute } from './src/util/compute/service';
export { rawRgba8Input } from './src/util/compute/rawformat';
export { isComputeInputSupported } from './src/util/compute/protocol';
export { scanProvinceColors, scanProvinceColorsTypescript, provinceColorsFromComputeResult } from './src/util/image/bmp/provincecolors';
export { parseProvinceBmpBuffer, validateProvinceDimensions, fillProvinceZones, fillEdges, validateProvince, fillProvinceEdges } from './src/previewdef/worldmap/loader/provincebmp';
export { parseMinimumProvinceSize } from './src/previewdef/worldmap/loader/defines';
export { getPerfSnapshot } from './src/util/perf';
export { PNG } from 'pngjs';`;
    const started = performance.now();
    const bundle = await build({
        stdin: { contents: source, resolveDir: root, loader: 'ts', sourcefile: 'profile-mod-entry.ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, tsconfigRaw: {}, absWorkingDir: root,
        packages: 'external', external: ['vscode'],
        plugins: [{ name: 'profile-private-pure-functions', setup(builder) {
            // Resolve source files ourselves so esbuild does not inspect restricted
            // ancestor directories for package/tsconfig discovery on Windows.
            builder.onResolve({ filter: /.*/ }, args => {
                if (!args.path.startsWith('.')) { return { path: args.path, external: true }; }
                const absolute = path.resolve(args.resolveDir || path.dirname(args.importer), args.path);
                const filename = [absolute, `${absolute}.ts`, `${absolute}.js`, `${absolute}.json`,
                    path.join(absolute, 'index.ts'), path.join(absolute, 'index.js')]
                    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
                if (!filename) { throw new Error(`Cannot resolve production source: ${args.path}`); }
                return { path: filename, namespace: 'profile-source' };
            });
            builder.onLoad({ filter: /.*/, namespace: 'profile-source' }, async ({ path: filename }) => {
                const bytes = await fsp.readFile(filename);
                inputs.set(filename, { path: relative(filename), bytes: bytes.length, sha256: sha256(bytes) });
                const injected = filename === provinceFile
                    ? '\nexport { validateProvinceDimensions, fillProvinceZones, fillEdges, validateProvince };\n' : '';
                return { contents: bytes.toString('utf8') + injected,
                    loader: filename.endsWith('.json') ? 'json' : 'ts', resolveDir: path.dirname(filename) };
            });
        } }],
    });
    const require = createRequire(path.join(root, 'package.json'));
    // Import-time host plumbing only. No editor, disk, watchers, indexes or UI are emulated.
    class EventEmitter {
        event = () => ({ dispose() {} });
        fire() {}
        dispose() {}
    }
    const vscode = { EventEmitter, env: { language: 'en' },
        workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
        l10n: { t: (message, ...args) => message.replace(/\{(\d+)\}/g, (match, index) => String(args[index] ?? match)) } };
    const module = { exports: {} };
    const originalLoad = Module._load;
    try {
        // Also cover import-time vscode references in external packages; restore immediately.
        Module._load = function(name, parent, isMain) {
            return name === 'vscode' ? vscode : originalLoad.call(this, name, parent, isMain);
        };
        new Function('module', 'exports', 'require', 'console', bundle.outputFiles[0].text)(
            module, module.exports, require, { ...console, log: (...args) => console.error(...args) });
    } finally { Module._load = originalLoad; }
    return { api: module.exports, provenance: { durationMs: performance.now() - started,
        instrumentation: 'In-memory esbuild onLoad appends exports to original provincebmp.ts; algorithms are unchanged.',
        vscodeMock: ['EventEmitter import plumbing', 'env.language=en', 'workspace.getConfiguration fallback', 'English l10n.t'],
        bundleSha256: sha256(bundle.outputFiles[0].contents), inputs: [...inputs.values()].sort((left, right) => comparePath(left.path, right.path)) } };
}

function memorySnapshot() {
    return { ...process.memoryUsage(), processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024 };
}

async function measure(run, summarize) {
    // GC and settling are outside the timed interval. RSS includes resident worker memory.
    globalThis.gc?.();
    await pause(8);
    const before = memorySnapshot();
    let peak = before;
    let previous = performance.now();
    let maxIntervalMs = 0;
    let timerTicks = 0;
    const probe = () => {
        const now = performance.now();
        maxIntervalMs = Math.max(maxIntervalMs, now - previous);
        previous = now;
        timerTicks++;
        const current = memorySnapshot();
        peak = Object.fromEntries(Object.keys(current).map(key => [key, Math.max(peak[key], current[key])]));
    };
    const timer = setInterval(probe, 5);
    const utilization = performance.eventLoopUtilization();
    const started = performance.now();
    let value;
    try {
        value = await run();
        const durationMs = performance.now() - started;
        const after = memorySnapshot();
        const eventLoop = performance.eventLoopUtilization(utilization);
        // Let an armed timer observe a stall even when run() never yields.
        await pause(6);
        clearInterval(timer);
        const summary = summarize(value);
        value = undefined;
        return { durationMs, eventLoop: { timerTicks, maxIntervalMs,
            maxStallOver5ms: Math.max(0, maxIntervalMs - 5), utilization: eventLoop.utilization },
        memory: { before, after, sampledPeak: Object.fromEntries(Object.keys(after).map(key => [key, Math.max(peak[key], after[key])])),
            delta: Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]])) }, summary };
    } finally { clearInterval(timer); }
}

const distribution = values => {
    const sorted = [...values].sort((left, right) => left - right);
    return { min: sorted[0], p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
};

async function main(options) {
    const started = performance.now();
    const mod = await fsp.realpath(path.resolve(options.mod));
    if (!(await fsp.stat(mod)).isDirectory()) { throw new Error('--mod must be a directory.'); }
    const output = await outputPath(options.output, mod);
    const deadline = started + options.maxSeconds * 1000;
    const report = {
        reportVersion: 1, generatedUtc: new Date().toISOString(), modPath: mod,
        scope: 'Real mod, isolated production CPU stages and bounded disk sweeps; NOT VS Code preview/startup latency.',
        environment: { node: process.version, platform: process.platform, architecture: process.arch,
            osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
            totalMemoryBytes: os.totalmem(), explicitGc: typeof globalThis.gc === 'function',
            computeBackendEnvironment: process.env.HOI4MU_COMPUTE_BACKEND ?? null },
        repository: { head: git(['rev-parse', 'HEAD']), statusBefore: git(['status', '--short']),
            scriptSha256: sha256(await fsp.readFile(fileURLToPath(import.meta.url))),
            packageJsonSha256: sha256(await fsp.readFile(path.join(root, 'package.json'))),
            packageLockSha256: sha256(await fsp.readFile(path.join(root, 'package-lock.json'))) },
        policy: { ...options, mod: undefined, output: undefined, limits,
            requestedWarmups: options.warmups,
            warmupPolicy: 'Requested warmups only if first invocation <= 1000ms; otherwise none to bound expensive runs.',
            coldFirst: 'First invocation of this workload in this process; shared modules/JIT and OS disk cache may already be warm.',
            deadline: 'Soft overall deadline checked between operations; a running synchronous stage is not interrupted.' },
        caveats: [
            'Source modules are loaded once in memory; module bundling, input preparation and result hashing are outside pure-stage timings.',
            'Focus computations use an empty external shared-focus set: no dependency/GUI/GFX resolution, asset hydration, layout rendering, webview or VS Code flow.',
            'Province pipeline covers BMP parse, dimensions, colors, TypeScript zones/regions, edges and validation; excludes definitions/adjacencies, states, rivers, terrain and webview rendering.',
            'Localisation includes production YAML preprocessing and recovery; dataset timings do not measure index watchers, precedence or lookups.',
            'Memory snapshots/5ms polling miss synchronous transient heap peaks. Process lifetime RSS high-water is cumulative; RSS includes workers, heap fields describe the main isolate.',
            'Event-loop timer gaps are scheduling observations, not user interaction latency. Repeated samples are fixed-order and OS/JIT/GC activity affects timings.',
            'Already-built worker/WASM artifacts are fingerprinted but are not rebuilt; source/artifact freshness is not guaranteed.',
            'Worker service uses minimumPixels=0 to compare small inputs too; actual editors may choose TypeScript below the production threshold. Large-worker retirement and transfer/copy costs remain active.',
            'File inventory is metadata-only, capped, skips symlinks and covers named categories, not the entire mod. Content hashes are recorded for measured inputs and largest listed files within a byte budget.',
        ],
        inventory: {}, inputs: [], stages: [], skipped: [], errors: [],
    };
    const progress = message => console.error(`[profile-mod] ${message}`);
    const inputCache = new Map();
    let hashBytes = 0;
    async function input(file, readLimit = limits.binaryFileBytes) {
        if (file.bytes > readLimit) { throw new Error(`Input exceeds read limit: ${file.path} (${file.bytes} bytes)`); }
        const bytes = await fsp.readFile(path.join(mod, file.path));
        assert.equal(bytes.length, file.bytes, `Input size changed: ${file.path}`);
        const digest = sha256(bytes);
        const previous = inputCache.get(file.path);
        if (previous) { assert.equal(digest, previous.sha256, `Input changed during profiling: ${file.path}`); }
        else {
            const record = { ...file, sha256: digest };
            inputCache.set(file.path, record);
            report.inputs.push(record);
            hashBytes += bytes.length;
        }
        return bytes;
    }
    async function fingerprint(file) {
        if (inputCache.has(file.path)) { return inputCache.get(file.path); }
        if (hashBytes + file.bytes > limits.hashBytes) { return { ...file, hashSkipped: 'Content hash byte budget' }; }
        const hash = createHash('sha256');
        for await (const chunk of fs.createReadStream(path.join(mod, file.path))) { hash.update(chunk); }
        const record = { ...file, sha256: hash.digest('hex') };
        hashBytes += file.bytes;
        inputCache.set(file.path, record);
        report.inputs.push(record);
        return record;
    }
    const boundedFiles = (files, maxFiles, maxBytes) => {
        const selected = [];
        let bytes = 0;
        for (const file of [...files].sort(bySize)) {
            if (selected.length >= maxFiles || file.bytes > limits.textFileBytes || bytes + file.bytes > maxBytes) { continue; }
            selected.push(file);
            bytes += file.bytes;
        }
        return { files: selected, bytes, availableFiles: files.length, availableBytes: files.reduce((sum, file) => sum + file.bytes, 0),
            omittedFiles: files.length - selected.length };
    };
    async function benchmark(name, run, summarize, metadata = {}, warmupsAllowed = true) {
        if (performance.now() >= deadline) { report.skipped.push({ name, reason: 'Overall soft deadline' }); return; }
        progress(name);
        const stage = { name, ...metadata, status: 'running', coldFirst: undefined, warmups: 0, samples: [] };
        report.stages.push(stage);
        try {
            stage.coldFirst = await measure(run, summarize);
            const warmups = warmupsAllowed && stage.coldFirst.durationMs <= 1000 ? options.warmups : 0;
            for (let index = 0; index < warmups && performance.now() < deadline; index++) {
                await run(); stage.warmups++;
                await pause(0);
            }
            for (let index = 0; index < options.samples && performance.now() < deadline; index++) {
                stage.samples.push(await measure(run, summarize));
            }
            stage.status = stage.samples.length === options.samples ? 'ok' : 'partial';
            stage.repeatedMs = distribution(stage.samples.map(sample => sample.durationMs));
            if (stage.samples[0]?.summary?.timingsMs) {
                stage.repeatedSubstagesMs = Object.fromEntries(Object.keys(stage.samples[0].summary.timingsMs).map(key =>
                    [key, distribution(stage.samples.map(sample => sample.summary.timingsMs[key]))]));
            }
            return stage;
        } catch (error) {
            stage.status = 'failed'; stage.error = error.stack ?? String(error);
            report.errors.push({ name, error: stage.error });
            progress(`FAILED ${name}: ${error.message}`);
        }
    }

    progress('Bounded metadata inventory');
    const scan = await inventory(mod);
    const categories = {
        focus: file => file.path.startsWith('common/national_focus/') && /\.txt$/i.test(file.path),
        event: file => file.path.startsWith('events/') && /\.txt$/i.test(file.path),
        interface: file => file.path.startsWith('interface/') && /\.(gfx|gui)$/i.test(file.path),
        localisation: file => /^locali[sz]ation\//.test(file.path) && /\.ya?ml$/i.test(file.path),
        texture: file => /\.(dds|tga|png|bmp)$/i.test(file.path),
    };
    const files = {};
    for (const [name, predicate] of Object.entries(categories)) {
        files[name] = scan.files.filter(predicate).sort(bySize);
        const largest = [];
        for (const file of files[name].slice(0, 10)) { largest.push(await fingerprint(file)); }
        report.inventory[name] = { count: files[name].length, bytes: files[name].reduce((sum, file) => sum + file.bytes, 0), largest };
    }
    report.inventory.scan = { ...scan, files: undefined,
        note: scan.truncated ? 'Counts/bytes are observed lower bounds because the scan was capped.' : 'Counts cover the listed directories and file extensions.' };
    try {
        const stat = await fsp.stat(path.join(mod, 'descriptor.mod'));
        const file = { path: 'descriptor.mod', bytes: stat.size };
        const content = (await input(file, limits.textFileBytes)).toString('utf8');
        report.descriptor = { ...inputCache.get(file.path), name: /^\s*name\s*=\s*"(.*)"/m.exec(content)?.[1],
            version: /^\s*version\s*=\s*"(.*)"/m.exec(content)?.[1] };
    } catch (error) { report.skipped.push({ name: 'descriptor.mod', reason: error.message }); }

    progress('Load current production modules entirely in memory');
    const { api, provenance } = await loadProductionCode();
    report.repository.productionModules = provenance;
    const focusSummary = schema => ({ trees: schema.focus_tree.length,
        focuses: schema.focus_tree.reduce((sum, tree) => sum + tree.focus.length, 0),
        sharedFocuses: schema.shared_focus.length, jointFocuses: schema.joint_focus.length });
    const focusSelection = boundedFiles(files.focus, limits.focusFiles, limits.focusBytes);
    report.inventory.focus.schemaSelection = { ...focusSelection, files: focusSelection.files.map(file => file.path) };
    async function profileFocus(file) {
        const text = (await input(file, limits.textFileBytes)).toString('utf8');
        await benchmark(`focus.structure:${file.path}`, () => {
            const timingsMs = {};
            let at = performance.now();
            const node = api.parseHoi4File(text, `In file ${file.path}:\n`);
            timingsMs.parse = performance.now() - at;
            at = performance.now();
            const snapshot = api.createFocusTreeSourceSnapshot(node, file.path);
            timingsMs.schemaAndSourceMetadata = performance.now() - at;
            at = performance.now();
            const trees = api.getFocusTreeFromSourceSnapshot(snapshot, []);
            timingsMs.focusComputations = performance.now() - at;
            return { snapshot, trees, timingsMs };
        }, ({ snapshot, trees, timingsMs }) => ({ ...focusSummary(snapshot.file),
            loadedFocuses: trees.reduce((sum, tree) => sum + Object.keys(tree.focuses).length, 0),
            warnings: trees.reduce((sum, tree) => sum + tree.warnings.length, 0), timingsMs }),
        { input: inputCache.get(file.path), includes: 'parseHoi4File + convertNodeToJson via snapshot + source metadata + production tree/condition/branch/lint computations',
            excludes: 'I/O, external shared-focus resolution, assets, presentation, rendering' });
        const node = api.parseHoi4File(text);
        await benchmark(`focus.convertNodeToJson:${file.path}`, () => api.convertFocusFileNodeToJson(node, {}), focusSummary,
            { input: inputCache.get(file.path), excludes: 'Parser, source metadata, tree computations and I/O' });
    }
    const topFocuses = focusSelection.files.slice(0, 3);
    for (const file of topFocuses) { await profileFocus(file); }

    // Bounded sweep parses every selected file, one at a time; ASTs are never retained as a dataset.
    const schemaFacts = new Map();
    await benchmark('focus.allSchemaSweep', async () => {
        let parseMs = 0; let conversionMs = 0; let readAndHashMs = 0;
        const counts = { files: 0, bytes: 0, trees: 0, focuses: 0, sharedFocuses: 0, jointFocuses: 0, errors: [] };
        const manifest = createHash('sha256');
        for (const file of focusSelection.files) {
            if (performance.now() >= deadline) { counts.stoppedAtDeadline = true; break; }
            let at = performance.now();
            const text = (await input(file, limits.textFileBytes)).toString('utf8');
            readAndHashMs += performance.now() - at;
            manifest.update(`${file.path}\0${inputCache.get(file.path).sha256}\n`);
            counts.files++; counts.bytes += file.bytes;
            try {
                at = performance.now();
                const node = api.parseHoi4File(text, `In file ${file.path}:\n`);
                parseMs += performance.now() - at;
                at = performance.now();
                const schema = api.convertFocusFileNodeToJson(node, {});
                conversionMs += performance.now() - at;
                const fact = focusSummary(schema);
                schemaFacts.set(file.path, fact);
                for (const key of ['trees', 'focuses', 'sharedFocuses', 'jointFocuses']) { counts[key] += fact[key]; }
            } catch (error) { counts.errors.push({ path: file.path, error: error.message }); }
        }
        return { ...counts, manifestSha256: manifest.digest('hex'), timingsMs: { parse: parseMs, convertNodeToJson: conversionMs, readUtf8AndHash: readAndHashMs } };
    }, value => value, { selection: report.inventory.focus.schemaSelection,
        includes: 'Serial mod-only file read/UTF-8/hash + production parse/schema conversion; substage CPU totals separate I/O',
        excludes: 'Tree loading, indexes and mod/dependency/game file resolution' });
    // Largest files may all contain shared focuses; include actual local-tree workloads too.
    for (const file of focusSelection.files.filter(file => schemaFacts.get(file.path)?.trees > 0
        && !topFocuses.some(top => top.path === file.path)).slice(0, 2)) { await profileFocus(file); }

    for (const category of ['event', 'interface']) {
        for (const file of files[category].slice(0, 2).filter(file => file.bytes <= limits.textFileBytes)) {
            const text = (await input(file, limits.textFileBytes)).toString('utf8');
            await benchmark(`${category}.parse:${file.path}`, () => api.parseHoi4File(text, `In file ${file.path}:\n`),
                node => ({ topLevelNodes: Array.isArray(node.value) ? node.value.length : 0 }),
                { input: inputCache.get(file.path), excludes: 'I/O, feature schema/loaders, references, assets and rendering' });
        }
    }

    const localisationSelection = boundedFiles(files.localisation, limits.localisationFiles, limits.localisationBytes);
    const localTexts = [];
    for (const file of localisationSelection.files) {
        localTexts.push({ file, text: (await input(file, limits.textFileBytes)).toString('utf8') });
    }
    const localSummary = parsed => ({ languages: Object.keys(parsed),
        entries: Object.values(parsed).reduce((sum, entries) => sum + Object.keys(entries).length, 0) });
    for (const { file, text } of localTexts.slice(0, 3)) {
        await benchmark(`localisation.parse:${file.path}`, () => api.parseLocalisationFileContent(text), localSummary,
            { input: inputCache.get(file.path), excludes: 'I/O, index assembly/precedence/watchers' });
    }
    await benchmark('localisation.dataset', () => {
        const languages = new Set(); let entries = 0;
        for (const { text } of localTexts) {
            const summary = localSummary(api.parseLocalisationFileContent(text));
            entries += summary.entries;
            summary.languages.forEach(language => languages.add(language));
        }
        return { files: localTexts.length, bytes: localisationSelection.bytes, entries,
            languages: [...languages].sort(comparePath), entriesNote: 'Per-file entry sum; no cross-file deduplication.' };
    }, value => value, { selection: { ...localisationSelection, files: localTexts.map(({ file }) => inputCache.get(file.path)) },
        excludes: 'I/O and localisation index assembly; production parser is run serially over prepared text' });

    let wasm; let service; let registration;
    const artifacts = ['dist/hoi4_compute.wasm', 'dist/compute-worker.js'];
    report.repository.computeArtifacts = [];
    try {
        for (const filename of artifacts) {
            const bytes = await fsp.readFile(path.join(root, filename));
            report.repository.computeArtifacts.push({ path: filename, bytes: bytes.length, sha256: sha256(bytes) });
        }
        const wasmBytes = await fsp.readFile(path.join(root, artifacts[0]));
        const at = performance.now();
        wasm = await api.RustWasmCompute.create(wasmBytes);
        report.repository.wasmInitializationMs = performance.now() - at;
        service = new api.RustComputeService({ workerPath: path.join(root, artifacts[1]),
            wasmPath: path.join(root, artifacts[0]), minimumPixels: 0 });
        registration = api.registerRustCompute(root);
    } catch (error) { report.skipped.push({ name: 'Rust compute', reason: error.message }); }
    async function workerCompute(request) {
        const value = await service.run(request);
        assert.ok(value, 'Existing compute service returned fallback/undefined; worker timings must not be labelled Rust.');
        return value;
    }
    try {
        let minimumProvinceSize = 8;
        const defineInputs = [];
        for (const file of scan.files.filter(file => file.path.startsWith('common/defines/') && /\.lua$/i.test(file.path))) {
            if (file.bytes > limits.textFileBytes) { continue; }
            const value = api.parseMinimumProvinceSize((await input(file, limits.textFileBytes)).toString('utf8'));
            defineInputs.push(inputCache.get(file.path));
            if (value !== undefined) { minimumProvinceSize = value; }
        }
        report.inventory.provinceDefines = { minimumProvinceSize, inputs: defineInputs,
            note: 'Mod-only Lua files in deterministic path order, default 8. No dependency/game define resolution.' };
        const map = scan.files.find(file => file.path === 'map/provinces.bmp');
        if (map && map.bytes <= limits.binaryFileBytes) {
            const bytes = await input(map);
            const image = api.parseProvinceBmpBuffer(bytes);
            report.inventory.provinceBmp = { ...inputCache.get(map.path), width: image.width, height: image.height,
                bitsPerPixel: image.bitsPerPixel, bytesPerRow: image.bytesPerRow, pixels: image.width * image.height };
            if (image.width * image.height <= limits.mapPixels && image.bitsPerPixel === 24) {
                api.validateProvinceDimensions(image);
                const request = { kind: 'bgr', bytes: image.data, width: image.width, height: image.height, stride: image.bytesPerRow };
                const candidates = { typescript: () => api.scanProvinceColorsTypescript(image) };
                if (wasm && api.isComputeInputSupported(request)) {
                    candidates.wasmWithCopies = () => api.provinceColorsFromComputeResult(wasm.compute(request));
                    candidates.workerRoundTrip = async () => api.provinceColorsFromComputeResult(await workerCompute(request));
                }
                const colorDigest = colors => ({ provinces: colors.provinces.length,
                    pixelsSha256: sha256(Buffer.from(colors.colorByPosition.buffer, colors.colorByPosition.byteOffset, colors.colorByPosition.byteLength)),
                    orderedColorsSha256: sha256(JSON.stringify(colors.provinces.map(province => province.color))) });
                let expectedColors;
                for (const [backend, run] of Object.entries(candidates)) {
                    await benchmark(`province.colors:${backend}`, run, colors => {
                        const summary = colorDigest(colors);
                        if (!expectedColors) { expectedColors = summary; }
                        else { assert.deepEqual(summary, expectedColors, 'Province colors/order parity'); }
                        return summary;
                    }, { input: report.inventory.provinceBmp, parity: 'Complete pixel bytes and ordered color list SHA-256 compared to TypeScript',
                        includes: backend === 'typescript' ? 'Color scan and host containers' : 'Copies + compute + host containers; worker includes transfer/startup/retirement policy' });
                }
                let expectedPipeline;
                const pipelineBackends = ['typescript', 'workerRoundTrip'].filter(name => candidates[name]);
                if (registration && process.env.HOI4MU_COMPUTE_BACKEND !== 'typescript') { pipelineBackends.push('acceleratedWorker'); }
                for (const backend of pipelineBackends) {
                    await benchmark(`province.fullPurePipeline:${backend}`, async () => {
                        const timingsMs = {}; const warnings = [];
                        let at = performance.now();
                        const current = api.parseProvinceBmpBuffer(bytes);
                        api.validateProvinceDimensions(current);
                        timingsMs.parseAndDimensions = performance.now() - at;
                        at = performance.now();
                        const colors = backend === 'typescript' ? api.scanProvinceColorsTypescript(current)
                            : backend === 'acceleratedWorker' ? await api.scanProvinceColors(current)
                                : api.provinceColorsFromComputeResult(await workerCompute(request));
                        timingsMs.colors = performance.now() - at;
                        at = performance.now();
                        const zones = api.fillProvinceZones(colors.provinces, colors.colorToProvince,
                            colors.colorByPosition, current.width, current.height, map.path, minimumProvinceSize, warnings);
                        timingsMs.zones = performance.now() - at;
                        at = performance.now();
                        let provinces;
                        if (backend === 'acceleratedWorker') {
                            const rustCalls = () => api.getPerfSnapshot().counters.find(counter =>
                                counter.label === 'worldmap.provinceEdges.backend' && counter.tags.engine === 'rust-wasm')?.count ?? 0;
                            const before = rustCalls();
                            provinces = await api.fillProvinceEdges(zones, colors.colorToProvince, colors.colorByPosition,
                                current.width, current.height, map.path, warnings);
                            assert.equal(rustCalls(), before + 1, 'Accelerated pipeline must execute Rust edges, not silent fallback.');
                            timingsMs.edgesAndValidation = performance.now() - at;
                        } else {
                            provinces = api.fillEdges(zones, colors.colorToProvince, colors.colorByPosition,
                                current.width, current.height, map.path, warnings);
                            timingsMs.edgesAndValidation = performance.now() - at;
                            at = performance.now();
                            api.validateProvince(colors.colorByPosition, current.width, current.height, map.path, warnings);
                            timingsMs.edgesAndValidation += performance.now() - at;
                        }
                        return { colors, provinces, warnings, timingsMs };
                    }, ({ colors, provinces, warnings, timingsMs }) => {
                        const hash = createHash('sha256');
                        let zones = 0; let edges = 0; let edgePoints = 0;
                        for (const province of provinces) {
                            hash.update(JSON.stringify(province)); hash.update('\n');
                            zones += province.coverZones.length; edges += province.edges.length;
                            for (const edge of province.edges) { for (const line of edge.path) { edgePoints += line.length; } }
                        }
                        hash.update(JSON.stringify(warnings));
                        const signature = { ...colorDigest(colors), graphAndWarningsSha256: hash.digest('hex'),
                            zones, directedEdges: edges, edgePoints, warnings: warnings.length };
                        if (!expectedPipeline) { expectedPipeline = signature; }
                        else { assert.deepEqual(signature, expectedPipeline, 'Full province pipeline parity'); }
                        return { ...signature, timingsMs };
                    }, { input: report.inventory.provinceBmp, minimumProvinceSize,
                        includes: backend === 'acceleratedWorker'
                            ? 'Production bitmap colors + zones + Rust edges/validation adapter, copy/transfer/startup/retirement included'
                            : 'All bitmap CPU stages; TypeScript zones/edges/validation, optionally Rust colors only',
                        excludes: 'Disk/loader/session/progress callbacks and rest of world map',
                        parity: 'Complete color hashes plus all province graph fields and warnings compared to TypeScript' });
                }
            } else { report.skipped.push({ name: 'province pipeline', reason: 'Map pixel cap or non-24-bit bitmap' }); }
        } else { report.skipped.push({ name: 'province pipeline', reason: 'No mod-owned provinces.bmp within binary byte cap; no game fallback' }); }

        // Header inspection is bounded; include large textures and a goal icon for representative decode sizes.
        const ddsFiles = files.texture.filter(file => /\.dds$/i.test(file.path));
        const goalFiles = ddsFiles.filter(file => /\/(?:goals|focus[^/]*)\//i.test(file.path));
        const strata = Array.from({ length: Math.min(24, ddsFiles.length) }, (_, index) =>
            ddsFiles[Math.floor(index * (ddsFiles.length - 1) / Math.max(1, Math.min(24, ddsFiles.length) - 1))]);
        const headerCandidates = [...files.texture.slice(0, 24), ...ddsFiles.slice(0, 12),
            ...goalFiles.slice(0, 4), ...goalFiles.filter(file => file.bytes < 128 * 1024).slice(0, 4),
            ...strata, ...ddsFiles.filter(file => file.path.startsWith('gfx/loadingscreens/')).slice(0, 4),
            ...ddsFiles.filter(file => file.bytes < 128 * 1024).slice(0, 4)];
        const notable = [];
        for (const file of [...new Map(headerCandidates.map(file => [file.path, file])).values()].slice(0, limits.textureHeaders)) {
            const handle = await fsp.open(path.join(mod, file.path), 'r');
            try {
                const header = Buffer.alloc(148);
                const { bytesRead } = await handle.read(header, 0, header.length, 0);
                let dimensions;
                if (/\.dds$/i.test(file.path) && bytesRead >= 128 && header.toString('ascii', 0, 4) === 'DDS ') {
                    dimensions = { width: header.readUInt32LE(16), height: header.readUInt32LE(12),
                        fourCC: header.toString('ascii', 84, 88).replace(/\0/g, ''), mipLevels: header.readUInt32LE(28) };
                } else if (/\.bmp$/i.test(file.path) && bytesRead >= 30 && header.toString('ascii', 0, 2) === 'BM') {
                    dimensions = { width: header.readInt32LE(18), height: Math.abs(header.readInt32LE(22)), bitsPerPixel: header.readUInt16LE(28) };
                } else if (/\.png$/i.test(file.path) && bytesRead >= 24 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
                    dimensions = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
                } else if (/\.tga$/i.test(file.path) && bytesRead >= 18) {
                    dimensions = { width: header.readUInt16LE(12), height: header.readUInt16LE(14), bitsPerPixel: header[16] };
                }
                notable.push({ ...file, ...dimensions, headerBytes: bytesRead,
                    headerSha256: sha256(header.subarray(0, bytesRead)), ...(inputCache.get(file.path) ?? {}) });
            } finally { await handle.close(); }
        }
        report.inventory.texture.notable = notable;
        const eligible = notable.filter(file => /\.dds$/i.test(file.path) && file.bytes <= limits.binaryFileBytes
            && file.width > 0 && file.height > 0 && file.width * file.height <= limits.texturePixels);
        const chosen = [eligible[0], eligible.find(file => file.width * file.height <= limits.pngPixels),
            eligible.find(file => /\/(?:goals|focus[^/]*)\//i.test(file.path) && file.width * file.height < 128 * 1024)
                ?? eligible.find(file => file.width * file.height < 128 * 1024),
            eligible.find(file => /^DXT[1-5]$/.test(file.fourCC))];
        const pngFormatsMeasured = new Set();
        if (!eligible.some(file => /^DXT[1-5]$/.test(file.fourCC))) {
            report.skipped.push({ name: 'DDS Rust BCn comparison', reason: 'No BC1/2/3 candidate in bounded header sample; eligible dense raw RGB(A) uses the Rust RGBA8 kernel.' });
        }
        for (const file of [...new Map(chosen.filter(Boolean).map(file => [file.path, file])).values()]) {
            // Dedicated aligned buffer: DDS.parse uses Int32Array at the supplied offset.
            const bytes = Uint8Array.from(await input(file));
            const surface = api.DDS.parse(bytes.buffer, 0).images[0];
            const metadata = { input: inputCache.get(file.path), width: surface.width, height: surface.height,
                pixelFormat: api.pixelFormatToString(surface.pixelFormat), excludes: 'I/O, DDS header parsing/mip selection and editor lifecycle' };
            let expectedRgba;
            const rgbaSummary = pixels => {
                const summary = { bytes: pixels.length, sha256: sha256(pixels) };
                if (!expectedRgba) { expectedRgba = summary; }
                else { assert.deepEqual(summary, expectedRgba, 'DDS RGBA byte parity'); }
                return summary;
            };
            await benchmark(`dds.decode.typescript:${file.path}`, () => surface.getFullRgba(), rgbaSummary, metadata);
            if (wasm) {
                const request = surface.pixelFormat.compressed
                    ? { kind: 'bcn', bytes: surface.getPixelData(), width: surface.width, height: surface.height,
                        format: surface.pixelFormat.compressFormat, premultiplied: surface.pixelFormat.alphaPremultiplied }
                    : api.rawRgba8Input({ kind: 'dds', bytes: surface.getPixelData(), width: surface.width,
                        height: surface.height, pixelFormat: surface.pixelFormat });
                if (request && api.isComputeInputSupported(request)) {
                    await benchmark(`dds.decode.wasmWithCopies:${file.path}`, () => wasm.compute(request).pixels, rgbaSummary, metadata);
                    await benchmark(`dds.decode.workerRoundTrip:${file.path}`, async () => (await workerCompute(request)).pixels, rgbaSummary, metadata);
                }
            }
            const pngFamily = surface.pixelFormat.compressed ? 'compressed' : 'raw';
            if (!pngFormatsMeasured.has(pngFamily) && service && surface.width * surface.height <= limits.pngPixels) {
                pngFormatsMeasured.add(pngFamily);
                let expectedPng;
                const pngSummary = (bytes, engine) => {
                    const summary = { bytes: bytes.length, sha256: sha256(bytes) };
                    if (!expectedPng) { expectedPng = summary; }
                    else { assert.deepEqual(summary, expectedPng, 'Lossless DDS PNG byte parity'); }
                    return { ...summary, engine };
                };
                await benchmark(`dds.png.typescript:${file.path}`, () => {
                    const png = new api.PNG({ width: surface.width, height: surface.height });
                    png.data = Buffer.from(surface.getFullRgba());
                    return api.PNG.sync.write(png);
                }, bytes => pngSummary(bytes, 'typescript'), { ...metadata, includes: 'Main mip RGBA decode + PNG encode' });
                await benchmark(`dds.png.workerRoundTrip:${file.path}`, () => workerCompute({
                    kind: 'dds', bytes: surface.getPixelData(), width: surface.width, height: surface.height, pixelFormat: surface.pixelFormat,
                }), result => pngSummary(result.pngBytes, result.engine),
                { ...metadata, includes: 'Transfer + production worker RGBA decode and PNG encode; actual engine recorded' });
            }
        }
    } finally { registration?.dispose(); service?.dispose(); }
    report.productionPerf = api.getPerfSnapshot();
    report.inputs.sort((left, right) => comparePath(left.path, right.path));
    report.inputManifestSha256 = sha256(report.inputs.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
    report.repository.statusAfter = git(['status', '--short']);
    report.durationMs = performance.now() - started;
    report.memoryAtCompletion = memorySnapshot();
    report.status = report.errors.length ? 'failed' : report.stages.some(stage => stage.status !== 'ok') || scan.truncated ? 'partial' : 'ok';
    const json = JSON.stringify(report, null, 2) + '\n';
    if (output) {
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await fsp.writeFile(output, json, { flag: 'wx' });
        progress(`Report: ${output}`);
    }
    process.stdout.write(json);
    if (report.errors.length) { process.exitCode = 1; }
}

try {
    const options = optionsFromArgs(process.argv.slice(2));
    if (options) { await main(options); }
} catch (error) {
    console.error(`[profile-mod] ${error.stack ?? error}`);
    process.exitCode = 1;
}
