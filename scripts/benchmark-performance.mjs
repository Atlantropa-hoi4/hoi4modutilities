#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Microbenchmarks compare isolated algorithms, not end-to-end VS Code latency.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRef = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length) ?? 'HEAD';
const baselineCommit = execFileSync('git', ['rev-parse', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const baselineSource = file => execFileSync('git', ['show', `${baselineCommit}:${file}`], {
    cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
});
const currentSource = file => fs.readFileSync(path.join(root, file), 'utf8');

function load(source, file, outputConsole = console) {
    const filename = path.join(root, file);
    const bundle = buildSync({
        stdin: { contents: source, resolveDir: path.dirname(filename), loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['vscode'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', 'console', bundle)(module, module.exports, createRequire(filename), outputConsole);
    return module.exports;
}

function compare(name, setupBefore, setupAfter, run, samples = 5) {
    const measure = setup => {
        const value = setup();
        const started = performance.now();
        run(value);
        const elapsed = performance.now() - started;
        value.dispose?.();
        return elapsed;
    };
    measure(setupBefore);
    measure(setupAfter);
    const before = [];
    const after = [];
    for (let index = 0; index < samples; index++) {
        before.push(measure(setupBefore));
        after.push(measure(setupAfter));
    }
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    return { name, samples, beforeMs: median(before), afterMs: median(after) };
}

const geometryFile = 'src/previewdef/focustree/scenegeometry.ts';
const oldGeometry = load(baselineSource(geometryFile), geometryFile);
const newGeometry = load(currentSource(geometryFile), geometryFile);
const geometryOptions = {
    items: Array.from({ length: 10000 }, (_, index) => ({
        id: String(index), gridX: index % 100, gridY: Math.floor(index / 100),
        connections: index === 0 ? [] : [{ target: String(index - 1), targetType: 'parent' }],
    })),
    slotSize: { width: 96, height: 130 }, padding: { left: 20, top: 30, right: 20, bottom: 30 },
};
const geometrySetup = api => () => ({ api, geometry: api.buildFocusSceneGeometry(geometryOptions) });
const results = [compare('focus: 10000 nodes, 9999 edges, 2000 local geometry updates',
    geometrySetup(oldGeometry), geometrySetup(newGeometry), ({ api, geometry }) => {
        for (let index = 0; index < 2000; index++) {
            const id = String(100 + index % 9000);
            const visual = geometry.nodes[id].visual;
            api.updateFocusSceneNodeVisuals(geometry, { [id]: { ...visual, y: visual.y + (index % 2 ? 1 : -1) } });
        }
    })];

const schemaFile = 'src/previewdef/focustree/focustreeschemahelpers.ts';
const oldSchema = baselineSource(schemaFile);
const branchStart = oldSchema.indexOf('    let hasChangedInAllowBranch = true;');
const branchEnd = oldSchema.indexOf('\n    return focuses;', branchStart);
if (branchStart < 0 || branchEnd < 0) {
    throw new Error('The baseline must precede the focus branch work-queue change (for example c2afd9e).');
}
const oldBranches = new Function('focuses', 'flatten', oldSchema.slice(branchStart, branchEnd));
const branchFile = 'src/previewdef/focustree/branchmembership.ts';
const newBranches = load(currentSource(branchFile), branchFile).propagateFocusBranchMembership;
function createBranches() {
    return Object.fromEntries(Array.from({ length: 1000 }, (_, offset) => {
        const index = 999 - offset;
        return [`F${index}`, { id: `F${index}`, prerequisite: index > 0 ? [[`F${index - 1}`]] : [], inAllowBranch: index === 0 ? ['F0'] : [] }];
    }));
}
const expectedBranches = createBranches();
const actualBranches = createBranches();
oldBranches(expectedBranches, values => values.flat());
newBranches(actualBranches);
assert.deepEqual(actualBranches, expectedBranches);
results.push(compare('focus: branch propagation along a reverse-ordered 1000-node chain',
    () => ({ focuses: createBranches(), propagate: focuses => oldBranches(focuses, values => values.flat()) }),
    () => ({ focuses: createBranches(), propagate: newBranches }),
    ({ focuses, propagate }) => propagate(focuses)));

const cacheFile = 'src/util/cache.ts';
const oldCache = load(baselineSource(cacheFile), cacheFile);
const newCache = load(currentSource(cacheFile), cacheFile);
const cacheSetup = Cache => () => new Cache({
    factory: key => key, life: 0, maxSize: 512, maxBytes: 4096, weigher: value => value.length,
});
results.push(compare('shared cache: 12000 insertions, 512 entries / 4096 bytes, one hit per 8 insertions',
    cacheSetup(oldCache.Cache), cacheSetup(newCache.Cache), cache => {
        for (let index = 0; index < 12000; index++) {
            cache.get(`key-${index}`);
            if (index % 8 === 0) { cache.get(`key-${index}`); }
        }
    }, 3));

const names = Array.from({ length: 8000 }, (_, index) => `file-${index}.gfx`);
const fileNames = [...names, ...names, ...names];
const oldDedupe = values => values.filter((value, index, array) => index === array.indexOf(value));
const newDedupe = values => [...new Set(values)];
assert.deepEqual(newDedupe(fileNames), oldDedupe(fileNames));
results.push(compare('file list deduplication only: 24000 paths, 8000 unique, excludes I/O',
    () => ({ dedupe: oldDedupe }), () => ({ dedupe: newDedupe }), ({ dedupe }) => dedupe(fileNames), 3));

const parserFile = 'src/hoiformat/hoiparser.ts';
const oldParser = load(baselineSource(parserFile), parserFile);
const newParser = load(currentSource(parserFile), parserFile);
const script = Array.from({ length: 5000 }, (_, index) =>
    `focus = {\n id = F${index}\n x = ${index}\n y = 1\n prerequisite = { focus = F0 }\n}\n`).join('');
results.push(compare('parser: valid script, 5000 focus blocks / 30000 lines',
    () => ({ parse: oldParser.parseHoi4File }), () => ({ parse: newParser.parseHoi4File }),
    ({ parse }) => parse(script), 9));

async function expiryBurst(PromiseCache) {
    let version = 1;
    let factories = 0;
    let expiryChecks = 0;
    const cache = new PromiseCache({
        factory: async () => ++factories,
        expireWhenChange: async () => { expiryChecks++; return version; },
        life: 0, nonExpireLife: 0,
    });
    await cache.get('shared');
    version++;
    await Promise.all(Array.from({ length: 32 }, () => cache.get('shared')));
    cache.dispose();
    return { factoriesIncludingColdLoad: factories, expiryChecksIncludingColdLoad: expiryChecks };
}

const perfFile = 'src/util/perf.ts';
const perf = load(currentSource(perfFile), perfFile, { ...console, log: (...args) => console.error(...args) });
for (const result of results) {
    perf.recordPerf('benchmark.before', result.beforeMs, { benchmark: result.name, baseline: baselineCommit });
    perf.recordPerf('benchmark.after', result.afterMs, { benchmark: result.name, baseline: baselineCommit });
}
console.log(JSON.stringify({
    baselineCommit, runtime: process.version, platform: process.platform,
    scope: 'Isolated CPU algorithms; wall-clock medians exclude setup and are not full preview load times.',
    results,
    expiryBurst: { requests: 32, before: await expiryBurst(oldCache.PromiseCache), after: await expiryBurst(newCache.PromiseCache) },
    perf: perf.getPerfSnapshot(),
}, null, 2));
