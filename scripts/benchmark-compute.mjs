#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { buildCompute } from './compute-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await buildCompute(root);
const source = `
export { RustWasmCompute } from './src/util/compute/wasm';
export { RustComputeService } from './src/util/compute/service';
export { scanProvinceColorsTypescript, provinceColorsFromComputeResult } from './src/util/image/bmp/provincecolors';
export { compressedSurface, provinceBitmap } from './test/computeFixtures';
export { PNG } from 'pngjs';`;
const bundle = buildSync({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle)(module, module.exports, createRequire(path.join(root, 'package.json')));
const { RustWasmCompute, RustComputeService, scanProvinceColorsTypescript, provinceColorsFromComputeResult, compressedSurface, provinceBitmap, PNG } = module.exports;
const wasmBytes = await fs.readFile(path.join(root, 'dist', 'hoi4_compute.wasm'));
const compileAt = performance.now();
const wasm = await RustWasmCompute.create(wasmBytes);
const wasmInitializationMs = performance.now() - compileAt;
const service = new RustComputeService({ workerPath: path.join(root, 'dist', 'compute-worker.js'),
    wasmPath: path.join(root, 'dist', 'hoi4_compute.wasm'), minimumPixels: 0 });
const samples = 9;
const results = [];
const distribution = values => {
    const sorted = [...values].sort((left, right) => left - right);
    return { p50Ms: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
};
async function measure(name, candidates, compare) {
    const values = Object.fromEntries(Object.keys(candidates).map(key => [key, []]));
    for (let warmup = 0; warmup < 2; warmup++) {
        for (const run of Object.values(candidates)) { await run(); }
    }
    for (let sample = 0; sample < samples; sample++) {
        const outputs = {};
        // Rotate order to avoid always measuring one backend after the same allocator activity.
        const keys = Object.keys(candidates);
        for (let offset = 0; offset < keys.length; offset++) {
            const key = keys[(sample + offset) % keys.length];
            const started = performance.now();
            outputs[key] = await candidates[key]();
            values[key].push(performance.now() - started);
        }
        compare(outputs);
    }
    results.push({ name, samples, timings: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, distribution(value)])) });
}
async function eventLoopProbe(run) {
    let ticks = 0;
    let previous = performance.now();
    let maxIntervalMs = 0;
    const timer = setInterval(() => {
        const now = performance.now();
        maxIntervalMs = Math.max(maxIntervalMs, now - previous);
        previous = now;
        ticks++;
    }, 1);
    const started = performance.now();
    await run();
    const durationMs = performance.now() - started;
    // Include the delayed first tick when synchronous work prevents every timer callback.
    await new Promise(resolve => setImmediate(resolve));
    maxIntervalMs = Math.max(maxIntervalMs, performance.now() - previous);
    clearInterval(timer);
    return { durationMs, timerTicks: ticks, maxIntervalMs };
}
try {
    const coldSurface = compressedSurface(1024, 1024, 3);
    const coldRequest = { kind: 'bcn', bytes: coldSurface.getPixelData(), width: 1024, height: 1024, format: 3 };
    const coldAt = performance.now();
    const coldResult = await service.run(coldRequest);
    const workerColdMs = performance.now() - coldAt;
    assert.deepEqual(coldResult.pixels, coldSurface.getFullRgba());
    for (const size of [64, 256, 1024, 2048]) {
        const surface = compressedSurface(size, size, 3);
        const request = { kind: 'bcn', bytes: surface.getPixelData(), width: size, height: size, format: 3 };
        await measure(`BC3 decode ${size}x${size}`, {
            typescript: () => surface.getFullRgba(),
            wasmWithCopies: () => wasm.compute(request).pixels,
            workerRoundTrip: async () => (await service.run(request)).pixels,
        }, values => { assert.deepEqual(values.wasmWithCopies, values.typescript); assert.deepEqual(values.workerRoundTrip, values.typescript); });
    }
    const bitmap = provinceBitmap(4096, 2048, 8191);
    const mapRequest = { kind: 'bgr', bytes: bitmap.data, width: bitmap.width, height: bitmap.height, stride: bitmap.bytesPerRow };
    await measure('Province colors 4096x2048 / 8191 colors (including host assembly)', {
        typescript: () => scanProvinceColorsTypescript(bitmap),
        wasmWithCopies: () => provinceColorsFromComputeResult(wasm.compute(mapRequest)),
        workerRoundTrip: async () => provinceColorsFromComputeResult(await service.run(mapRequest)),
    }, values => { assert.deepEqual(values.wasmWithCopies, values.typescript); assert.deepEqual(values.workerRoundTrip, values.typescript); });
    const surface = compressedSurface(1024, 1024, 3);
    const pngRequest = { kind: 'dds', bytes: surface.getPixelData(), width: 1024, height: 1024, pixelFormat: surface.pixelFormat };
    const tsPng = () => {
        const png = new PNG({ width: 1024, height: 1024 });
        png.data = Buffer.from(surface.getFullRgba());
        return PNG.sync.write(png);
    };
    const workerPng = async () => Buffer.from((await service.run(pngRequest)).pngBytes);
    await measure('BC3 to PNG 1024x1024 (decode + encode)', { typescript: tsPng, workerRoundTrip: workerPng },
        values => assert.deepEqual(values.workerRoundTrip, values.typescript));
    const responsiveness = {
        typescript: await eventLoopProbe(tsPng),
        worker: await eventLoopProbe(workerPng),
    };
    console.log(JSON.stringify({ runtime: process.version, platform: process.platform, architecture: process.arch,
        wasmBytes: wasmBytes.byteLength, wasmInitializationMs, workerColdMs,
        note: 'Synthetic isolated workloads, not complete VS Code preview or real-mod startup timings. Worker timings include copying, transfer, queueing and host assembly; warmed medians/p95. PNG is lossless byte-for-byte parity with existing encoder.',
        results, responsiveness }, null, 2));
} finally { service.dispose(); }
