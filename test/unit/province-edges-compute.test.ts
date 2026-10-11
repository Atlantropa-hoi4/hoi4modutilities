import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Module = require('module');
import type { ProvinceEdgeGraph, WorldMapWarning } from '../../src/previewdef/worldmap/definitions';
import type { ProvinceColorContainer } from '../../src/util/image/bmp/provincecolors';
import { decodeProvinceEdges, ProvinceEdgeAnalysis } from '../../src/util/compute/provinceedges';
import { registerRustCompute, RustComputeService } from '../../src/util/compute/service';
import { RustWasmCompute } from '../../src/util/compute/wasm';
import { getPerfSnapshot } from '../../src/util/perf';

const root = path.resolve(__dirname, '../../..');
const wasmPath = path.join(root, 'dist', 'hoi4_compute.wasm');
const file = 'map/provinces.bmp';
type Province = ProvinceColorContainer & { edges?: ProvinceEdgeGraph[] };
type ProvinceHelpers = typeof import('../../src/previewdef/worldmap/loader/provincebmp');

function loadProvinceHelpers(): ProvinceHelpers {
    const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
    const originalLoad = nodeModule._load;
    const cached = { ...require.cache };
    const sourceRoot = path.resolve(path.dirname(require.resolve('../../src/util/common')), '..') + path.sep;
    const computeRoot = path.join(sourceRoot, 'util', 'compute') + path.sep;
    const preserved = new Set([require.resolve('../../src/util/perf'), require.resolve('../../src/util/common')]);
    try {
        // Reload host dependencies with this mock, retaining the registered compute singleton.
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(sourceRoot) && !key.startsWith(computeRoot) && !preserved.has(key)) {
                delete require.cache[key];
            }
        }
        nodeModule._load = function(request, parent, isMain) {
            if (request === 'vscode') {
                class EventEmitter<T> {
                    public event = (_listener: (value: T) => unknown) => ({ dispose: () => undefined });
                    public fire(_value: T): void { }
                    public dispose(): void { }
                }
                return {
                    EventEmitter,
                    l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
                    env: { language: 'en' },
                    workspace: { getConfiguration: () => ({ get: () => undefined }) },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        return require('../../src/previewdef/worldmap/loader/provincebmp') as ProvinceHelpers;
    } finally {
        nodeModule._load = originalLoad;
        for (const key of Object.keys(require.cache)) {
            if (!(key in cached)) { delete require.cache[key]; }
        }
        Object.assign(require.cache, cached);
    }
}

function encodeWords(words: readonly number[]): Uint8Array {
    const bytes = new Uint8Array(words.length * 4);
    const view = new DataView(bytes.buffer);
    words.forEach((word, index) => view.setUint32(index * 4, word, true));
    return bytes;
}

function provincesFor(raster: Uint32Array): { provinces: Province[]; colorToProvince: Record<number, Province> } {
    // Province input order deliberately differs from flood-discovery and numeric-color order.
    const provinces: Province[] = [...new Set(raster)].reverse().map(color => ({ color, warnings: [] }));
    return { provinces, colorToProvince: Object.fromEntries(provinces.map(province => [province.color, province])) };
}

function decodedWarnings(analysis: ProvinceEdgeAnalysis, raster: Uint32Array, width: number): WorldMapWarning[] {
    return [
        ...analysis.onePixels.map(({ color, x, y }): WorldMapWarning => ({
            source: [{ type: 'province', id: -1, color }], relatedFiles: [file],
            text: `One-pixel province color found at ${x}, ${y}.`,
        })),
        ...analysis.crossings.map(({ x, y }): WorldMapWarning => {
            const bottomLeft = (y + 1) * width + x;
            const bottomRight = (y + 1) * width + (x + 1) % width;
            return {
                source: [raster[bottomLeft], raster[bottomRight], raster[bottomLeft - width], raster[bottomRight - width]]
                    .map(color => ({ type: 'province', id: -1, color })),
                relatedFiles: [file], text: `Map invalid X crossing at: (${x}, ${y}).`,
            };
        }),
    ];
}

function stripeRaster(): Uint32Array {
    const raster = new Uint32Array(512 * 512);
    const palette = [0xffffff, 3, 0, 0x010203, 9, 0x223344, 2, 0xaabbcc];
    for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) { raster[y * 512 + x] = palette[Math.floor(x / 64)]; }
    }
    // Include isolated pixels and a four-color crossing without exploding the graph size.
    raster[200 * 512 + 200] = 0xabc123;
    raster[300 * 512 + 300] = 0xabc123;
    raster[255 * 512 + 255] = 0x123456;
    raster[255 * 512 + 256] = 0x654321;
    raster[256 * 512 + 255] = 0x112233;
    raster[256 * 512 + 256] = 0x332211;
    return raster;
}

function backendCount(engine: string): number {
    return getPerfSnapshot().counters
        .filter(counter => counter.label === 'worldmap.provinceEdges.backend' && counter.tags.engine === engine)
        .reduce((total, counter) => total + counter.count, 0);
}

describe('Rust province edge payload decoder', () => {
    const width = 2;
    const height = 2;
    const palette = new Set([9, 3]);
    const validWords = [1, 1, 1, 1, 9, 3, 1, 2, 0, 0, 2, 2, 9, 1, 1, 0, 0];

    it('decodes an offset view, including warnings and unwrapped edge endpoints', () => {
        const bytes = encodeWords(validWords);
        const pooled = Buffer.allocUnsafe(bytes.length + 19);
        pooled.fill(0xee);
        const payload = pooled.subarray(7, 7 + bytes.length);
        payload.set(bytes);
        const before = Buffer.from(pooled);
        const decoded = decodeProvinceEdges(payload, width, height, palette);
        assert.deepStrictEqual([...decoded.byColor], [[9, [{ toColor: 3, path: [[{ x: 0, y: 0 }, { x: 2, y: 2 }]] }]]]);
        assert.deepStrictEqual(decoded.onePixels, [{ color: 9, x: 1, y: 1 }]);
        assert.deepStrictEqual(decoded.crossings, [{ x: 0, y: 0 }]);
        payload.fill(0);
        assert.deepStrictEqual(decoded.byColor.get(9)![0].path[0], [{ x: 0, y: 0 }, { x: 2, y: 2 }]);
        payload.set(bytes);
        assert.deepStrictEqual(pooled, before);
    });

    it('merges disconnected groups for a neighbor while retaining neighbor and path order', () => {
        const decoded = decodeProvinceEdges(encodeWords([
            1, 3, 0, 0,
            9, 3, 1, 2, 0, 0, 1, 0,
            9, 0xffffffff, 1, 2, 0, 2, 2, 2,
            9, 3, 1, 2, 2, 1, 2, 2,
        ]), width, height, palette);
        assert.deepStrictEqual(decoded.byColor.get(9), [
            { toColor: 3, path: [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 1 }, { x: 2, y: 2 }]] },
            { toColor: -1, path: [[{ x: 0, y: 2 }, { x: 2, y: 2 }]] },
        ]);
    });

    it('rejects every truncated prefix, non-word lengths, and trailing data', () => {
        const bytes = encodeWords(validWords);
        for (let length = 0; length < bytes.length; length++) {
            assert.throws(() => decodeProvinceEdges(bytes.subarray(0, length), width, height, palette), /Invalid Rust province edge payload/, `length=${length}`);
        }
        for (const trailing of [new Uint8Array([...bytes, 0]), encodeWords([...validWords, 0])]) {
            assert.throws(() => decodeProvinceEdges(trailing, width, height, palette), /Invalid Rust province edge payload/);
        }
    });

    it('rejects unsupported versions, impossible counts, unknown color references, and out-of-range coordinates', () => {
        const invalidFields: [string, number, number][] = [
            ['version zero', 0, 0], ['future version', 0, 2],
            ['group count', 1, 0xffffffff], ['one-pixel count', 2, 0xffffffff], ['crossing count', 3, 0xffffffff],
            ['source color', 4, 42], ['neighbor color', 5, 42],
            ['empty paths', 6, 0], ['path count', 6, 0xffffffff],
            ['short path', 7, 1], ['point count', 7, 0xffffffff],
            ['edge x', 8, width + 1], ['edge y', 9, height + 1],
            ['pixel color', 12, 42], ['pixel x', 13, width], ['pixel y', 14, height],
            ['crossing x', 15, width], ['crossing bottom row', 16, height - 1],
        ];
        for (const [name, index, value] of invalidFields) {
            const words = validWords.slice();
            words[index] = value;
            assert.throws(() => decodeProvinceEdges(encodeWords(words), width, height, palette), /Invalid Rust province edge payload/, name);
        }
        assert.throws(() => decodeProvinceEdges(encodeWords(validWords), width, height, new Set([3])), /Invalid Rust province edge payload/);
    });
});

describe('Rust province edge parity and production adapter', function() {
    this.timeout(30_000);
    let wasm: RustWasmCompute;
    let helpers: ProvinceHelpers;
    let previousBackend: string | undefined;
    before(async () => {
        helpers = loadProvinceHelpers();
        wasm = await RustWasmCompute.create(await fs.readFile(wasmPath));
    });
    beforeEach(() => {
        previousBackend = process.env.HOI4MU_COMPUTE_BACKEND;
        delete process.env.HOI4MU_COMPUTE_BACKEND;
    });
    afterEach(() => {
        if (previousBackend === undefined) { delete process.env.HOI4MU_COMPUTE_BACKEND; }
        else { process.env.HOI4MU_COMPUTE_BACKEND = previousBackend; }
    });

    function legacy(raster: Uint32Array, width: number, height: number) {
        const { provinces, colorToProvince } = provincesFor(raster);
        const warnings: WorldMapWarning[] = [];
        const result = helpers.fillProvinceEdgesTypescript(provinces, colorToProvince, raster, width, height, file, warnings);
        helpers.validateProvinceRasterTypescript(raster, width, height, file, warnings);
        return { provinces: result, warnings };
    }

    function compare(raster: Uint32Array, width: number, height: number, label: string) {
        const original = raster.slice();
        const result = wasm.compute({ kind: 'edges', bytes: encodeWords([...raster]), width, height });
        assert.ok(result.provinceEdges, label);
        assert.strictEqual(result.pixels.length, 0);
        assert.strictEqual(result.colors.length, 0);
        const decoded = decodeProvinceEdges(result.provinceEdges, width, height, new Set(raster));
        const expected = legacy(raster, width, height);
        assert.deepStrictEqual([...decoded.byColor.keys()], [...new Set(raster)], `${label}: flood-discovery color order`);
        const actual = expected.provinces.map(province => ({ ...province, edges: decoded.byColor.get(province.color) ?? [] }));
        assert.deepStrictEqual(actual, expected.provinces, `${label}: exact neighbor, path, and point order`);
        assert.deepStrictEqual(decodedWarnings(decoded, raster, width), expected.warnings, `${label}: warning text and source order`);
        assert.deepStrictEqual(raster, original, label);
        return { decoded, expected, payload: result.provinceEdges };
    }

    const handCases = [
        { name: 'single pixel', width: 1, colors: [0xffffff] },
        { name: 'width-one column', width: 1, colors: [7, 7, 3, 7, 7] },
        { name: 'horizontal seam joins matching end colors', width: 5, colors: [9, 3, 3, 3, 9] },
        { name: 'same-color disconnected islands', width: 7, colors: [
            2, 2, 2, 2, 2, 2, 2,
            2, 9, 2, 2, 2, 9, 2,
            2, 2, 2, 2, 2, 2, 2,
        ] },
        { name: 'nested holes', width: 5, colors: [
            9, 9, 9, 9, 9,
            9, 3, 3, 3, 9,
            9, 3, 7, 3, 9,
            9, 3, 3, 3, 9,
            9, 9, 9, 9, 9,
        ] },
        { name: 'ordinary and wrapped X crossings', width: 2, colors: [9, 3, 7, 1] },
        { name: 'seam crossing', width: 3, colors: [1, 2, 3, 4, 2, 5] },
        { name: 'diagonal disconnected same color', width: 2, colors: [7, 2, 3, 7] },
        { name: 'uniform black raster', width: 4, colors: new Array<number>(12).fill(0) },
        { name: 'numeric neighbor ordering', width: 4, colors: [0xffffff, 10, 2, 0, 2, 0xffffff, 10, 0] },
    ];
    for (const { name, width, colors } of handCases) {
        it(`matches legacy edge paths and warnings for ${name}`, () => {
            compare(Uint32Array.from(colors), width, colors.length / width, name);
        });
    }

    it('matches many deterministic random small rasters without sorting or normalizing paths', () => {
        const palette = [0xffffff, 9, 0, 0x010203, 2, 0x223344, 10];
        for (let seed = 0; seed < 400; seed++) {
            const width = 1 + seed % 9;
            const height = 1 + Math.floor(seed / 9) % 8;
            const colorCount = 1 + seed % palette.length;
            let state = seed >>> 0;
            const raster = new Uint32Array(width * height);
            for (let index = 0; index < raster.length; index++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                raster[index] = palette[(state >>> 16) % colorCount];
            }
            compare(raster, width, height, `seed=${seed}, ${width}x${height}`);
        }
    });

    it('preserves explicit one-pixel warning order and bottom/top crossing source order', () => {
        const { expected } = compare(Uint32Array.of(9, 3, 7, 1), 2, 2, 'warning order');
        assert.deepStrictEqual(expected.warnings, [
            ...[9, 3, 7, 1].map((color, index): WorldMapWarning => ({
                source: [{ type: 'province', id: -1, color }], relatedFiles: [file],
                text: `One-pixel province color found at ${index % 2}, ${Math.floor(index / 2)}.`,
            })),
            ...[[7, 1, 9, 3], [1, 7, 3, 9]].map((colors, x): WorldMapWarning => ({
                source: colors.map(color => ({ type: 'province', id: -1, color })), relatedFiles: [file],
                text: `Map invalid X crossing at: (${x}, 0).`,
            })),
        ]);
    });

    it('keeps edge payloads and decoded paths independent of later WASM allocations', () => {
        const { decoded, payload } = compare(Uint32Array.of(9, 3, 7, 1), 2, 2, 'retained payload');
        const originalBytes = payload.slice();
        const originalAnalysis = structuredClone(decoded);
        const raster = stripeRaster();
        wasm.compute({ kind: 'edges', bytes: encodeWords([...raster]), width: 512, height: 512 });
        assert.deepStrictEqual(payload, originalBytes);
        assert.deepStrictEqual(decoded, originalAnalysis);
    });

    it('transfers a genuinely pooled offset raster without detaching or changing its source', async () => {
        const pooled = Buffer.allocUnsafe(64);
        pooled.fill(0x7d);
        assert.ok(pooled.buffer.byteLength > pooled.byteLength);
        const raster = new Uint32Array(pooled.buffer, pooled.byteOffset + 8, 4);
        raster.set([9, 3, 7, 1]);
        const before = Buffer.from(pooled);
        const backingLength = pooled.buffer.byteLength;
        const expected = legacy(raster, 2, 2);
        const service = new RustComputeService({ workerPath: path.join(root, 'dist', 'compute-worker.js'), wasmPath, minimumPixels: 0 });
        try {
            const result = await service.run({ kind: 'edges', bytes: new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength), width: 2, height: 2 });
            assert.ok(result?.provinceEdges);
            assert.strictEqual(result.engine, 'rust-wasm');
            const decoded = decodeProvinceEdges(result.provinceEdges, 2, 2, new Set(raster));
            assert.deepStrictEqual(expected.provinces.map(province => ({ ...province, edges: decoded.byColor.get(province.color) })), expected.provinces);
            assert.deepStrictEqual(decodedWarnings(decoded, raster, 2), expected.warnings);
            assert.deepStrictEqual(pooled, before);
            assert.strictEqual(raster.buffer.byteLength, backingLength);
        } finally { service.dispose(); }
    });

    it('uses the registered Rust worker above the production threshold without detaching raster views', async () => {
        const raster = stripeRaster();
        const expected = legacy(raster, 512, 512);
        assert.ok(expected.warnings.some(warning => warning.text.startsWith('One-pixel')));
        assert.ok(expected.warnings.some(warning => warning.text.startsWith('Map invalid X crossing')));
        const dedicatedBacking = new Uint32Array(raster.length + 9);
        dedicatedBacking.fill(0x13579b);
        const offsetRaster = dedicatedBacking.subarray(4, 4 + raster.length);
        offsetRaster.set(raster);
        const pooled = Buffer.allocUnsafe(raster.byteLength + 24);
        pooled.fill(0x7d);
        const pooledRaster = new Uint32Array(pooled.buffer, pooled.byteOffset + 8, raster.length);
        pooledRaster.set(raster);
        const registration = registerRustCompute(root);
        try {
            for (const input of [offsetRaster, pooledRaster]) {
                const { provinces, colorToProvince } = provincesFor(input);
                const originalObjects = provinces.slice();
                const warnings: WorldMapWarning[] = [];
                const snapshot = new Uint8Array(input.buffer).slice();
                const backingLength = input.buffer.byteLength;
                const rustBefore = backendCount('rust-wasm');
                const tsBefore = backendCount('typescript');
                const result = await helpers.fillProvinceEdges(provinces, colorToProvince, input, 512, 512, file, warnings);
                assert.deepStrictEqual(result, expected.provinces);
                assert.deepStrictEqual(warnings, expected.warnings);
                assert.strictEqual(result, provinces);
                result.forEach((province, index) => {
                    assert.strictEqual(province, originalObjects[index]);
                    assert.strictEqual(colorToProvince[province.color], province);
                });
                assert.strictEqual(backendCount('rust-wasm'), rustBefore + 1, 'parity must exercise the Rust worker, not an inline fallback');
                assert.strictEqual(backendCount('typescript'), tsBefore);
                assert.strictEqual(input.buffer.byteLength, backingLength);
                assert.deepStrictEqual(new Uint8Array(input.buffer), snapshot);
            }
        } finally { registration.dispose(); }
    });

    it('falls back with identical paths and warnings when the backend is disabled', async () => {
        const raster = stripeRaster();
        const expected = legacy(raster, 512, 512);
        const { provinces, colorToProvince } = provincesFor(raster);
        const warnings: WorldMapWarning[] = [];
        const registration = registerRustCompute(root);
        try {
            process.env.HOI4MU_COMPUTE_BACKEND = 'typescript';
            const rustBefore = backendCount('rust-wasm');
            const tsBefore = backendCount('typescript');
            assert.deepStrictEqual(await helpers.fillProvinceEdges(provinces, colorToProvince, raster, 512, 512, file, warnings), expected.provinces);
            assert.deepStrictEqual(warnings, expected.warnings);
            assert.strictEqual(backendCount('rust-wasm'), rustBefore);
            assert.strictEqual(backendCount('typescript'), tsBefore + 1);
        } finally { registration.dispose(); }
    });

    it('leaves the original graph and warnings untouched when cancelled before applying worker results', async () => {
        const raster = stripeRaster();
        const originalRaster = raster.slice();
        const registration = registerRustCompute(root);
        try {
            // Checks occur before dispatch, after the worker reply, and after decoding.
            for (const cancelAt of [1, 2, 3]) {
                const { provinces, colorToProvince } = provincesFor(raster);
                for (const province of provinces) {
                    province.edges = [{ toColor: -1, path: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]] }];
                }
                const originalEdges = provinces.map(province => province.edges);
                const originalGraph = structuredClone(provinces);
                const warnings: WorldMapWarning[] = [{ source: [], relatedFiles: ['existing.txt'], text: 'Existing warning' }];
                const originalWarnings = structuredClone(warnings);
                const rustBefore = backendCount('rust-wasm');
                const tsBefore = backendCount('typescript');
                const cancelled = new Error('Load session cancelled.');
                let checks = 0;
                await assert.rejects(helpers.fillProvinceEdges(provinces, colorToProvince, raster, 512, 512, file, warnings, () => {
                    if (++checks >= cancelAt) { throw cancelled; }
                }), error => error === cancelled);
                assert.deepStrictEqual(provinces, originalGraph, `cancelAt=${cancelAt}`);
                provinces.forEach((province, index) => assert.strictEqual(province.edges, originalEdges[index]));
                assert.deepStrictEqual(warnings, originalWarnings);
                assert.deepStrictEqual(raster, originalRaster);
                assert.strictEqual(backendCount('rust-wasm'), rustBefore);
                assert.strictEqual(backendCount('typescript'), tsBefore);
            }
            const { provinces, colorToProvince } = provincesFor(raster);
            const warnings: WorldMapWarning[] = [];
            const before = backendCount('rust-wasm');
            assert.deepStrictEqual(await helpers.fillProvinceEdges(provinces, colorToProvince, raster, 512, 512, file, warnings), legacy(raster, 512, 512).provinces);
            assert.strictEqual(backendCount('rust-wasm'), before + 1);
        } finally { registration.dispose(); }
    });
});
