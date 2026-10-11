import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { RustWasmCompute } from '../../src/util/compute/wasm';
import { RustComputeService, registerRustCompute } from '../../src/util/compute/service';
import { ComputeInput, isComputeInputSupported, maxComputeInputBytes, maxComputeOutputBytes } from '../../src/util/compute/protocol';
import { rawRgba8Input } from '../../src/util/compute/rawformat';
import { CompressFormat, ChannelFormat, PixelValueType, RawPixelFormat } from '../../src/util/image/dds/pixelformat';
import { Surface } from '../../src/util/image/dds/surface';
import { UserError } from '../../src/util/common';
import { ddsToPngBufferAsync } from '../../src/util/image/converter';
import { scanProvinceColors, scanProvinceColorsTypescript } from '../../src/util/image/bmp/provincecolors';
import { compressedSurface, provinceBitmap } from '../computeFixtures';

const root = path.resolve(__dirname, '../../..');
const workerPath = path.join(root, 'dist', 'compute-worker.js');
const wasmPath = path.join(root, 'dist', 'hoi4_compute.wasm');
const rawFormat: RawPixelFormat = {
    compressed: false, valueType: PixelValueType.unorm, bitsPerPixel: 32, channelCount: 4,
    channelOrderInPixel: [0, 1, 2, 3], channelStartInPixel: [0, 8, 16, 24], channelLengthInPixel: [8, 8, 8, 8], channelFormat: ChannelFormat.rgba,
};

function rawSurface(bitsPerPixel: number, starts: number[], valueType = PixelValueType.unorm, width = 16, height = 16): Surface {
    const length = width * height * bitsPerPixel / 8;
    const backing = new Uint8Array(length + 13);
    const bytes = backing.subarray(7, 7 + length);
    for (let pixel = 0; pixel < width * height; pixel++) {
        for (let channel = 0; channel < bitsPerPixel / 8; channel++) {
            bytes[pixel * bitsPerPixel / 8 + channel] = (pixel + channel * 73) & 255;
        }
    }
    const format: RawPixelFormat = {
        compressed: false, valueType, bitsPerPixel, channelCount: starts.length,
        channelOrderInPixel: starts.map((_, channel) => channel).sort((a, b) => starts[a] - starts[b]),
        channelStartInPixel: starts, channelLengthInPixel: starts.map(() => 8),
        channelFormat: starts.length === 4 ? ChannelFormat.rgba : ChannelFormat.rgb,
    };
    return new Surface(backing.buffer, bytes.byteOffset, bytes.byteLength, 'Raw fixture', width, height, format);
}

function ddsInputFor(surface: Surface): ComputeInput {
    return { kind: 'dds', bytes: surface.getPixelData(), width: surface.width, height: surface.height, pixelFormat: surface.pixelFormat };
}

function inputFor(surface: Surface): ComputeInput {
    assert.ok(surface.pixelFormat.compressed);
    return {
        kind: 'bcn', bytes: surface.getPixelData(), width: surface.width, height: surface.height,
        format: surface.pixelFormat.compressFormat, premultiplied: surface.pixelFormat.alphaPremultiplied,
    };
}

function createService(overrides: Partial<ConstructorParameters<typeof RustComputeService>[0]> = {}): RustComputeService {
    return new RustComputeService({ workerPath, wasmPath, minimumPixels: 0, ...overrides });
}

async function withService(run: (service: RustComputeService) => Promise<void>): Promise<void> {
    const service = createService();
    try { await run(service); } finally { service.dispose(); }
}

describe('Rust compute parity', function() {
    this.timeout(20_000);
    let wasm: RustWasmCompute;
    before(async () => { wasm = await RustWasmCompute.create(await fs.readFile(wasmPath)); });

    it('characterizes BC1 color and transparent palettes independently of Rust', () => {
        const surface = compressedSurface(4, 4, CompressFormat.bc1);
        surface.getPixelData().set([0x00, 0xf8, 0xe0, 0x07, 0xe4, 0xe4, 0xe4, 0xe4]);
        assert.deepStrictEqual([...surface.getFullRgba().subarray(0, 16)], [255, 0, 0, 255, 0, 255, 0, 255, 170, 85, 0, 255, 85, 170, 0, 255]);
        surface.getPixelData().set([0, 0, 0, 0, 255, 255, 255, 255]);
        assert.deepStrictEqual([...surface.getFullRgba()], new Array(64).fill(0));
    });

    it('matches BC1/2/3 byte-for-byte for random blocks, partial blocks, and DXT2/4 alpha', () => {
        for (const format of [CompressFormat.bc1, CompressFormat.bc2, CompressFormat.bc3]) {
            for (const premultiplied of [false, true]) {
                for (let seed = 0; seed < 100; seed++) {
                    const width = [1, 2, 3, 5, 13, 32][seed % 6];
                    const height = [1, 3, 5, 7, 17][seed % 5];
                    const surface = compressedSurface(width, height, format, premultiplied, seed);
                    const expected = surface.getFullRgba();
                    assert.deepStrictEqual(wasm.compute(inputFor(surface)).pixels, expected, `BC${format}, premult=${premultiplied}, seed=${seed}`);
                }
            }
        }
    });

    it('preserves all 565 interpolation combinations and explicit alpha levels', () => {
        for (const channel of ['red', 'green'] as const) {
            const levels = channel === 'red' ? 32 : 64;
            const surface = compressedSurface(4 * levels, 4 * levels, CompressFormat.bc2, true);
            const bytes = surface.getPixelData();
            for (let first = 0; first < levels; first++) {
                for (let second = 0; second < levels; second++) {
                    const offset = (first * levels + second) * 16;
                    for (let i = 0; i < 8; i++) { bytes[offset + i] = i * 32 + 16; }
                    const c0 = first << (channel === 'red' ? 11 : 5);
                    const c1 = second << (channel === 'red' ? 11 : 5);
                    bytes[offset + 8] = c0; bytes[offset + 9] = c0 >>> 8;
                    bytes[offset + 10] = c1; bytes[offset + 11] = c1 >>> 8;
                    bytes.fill(0xe4, offset + 12, offset + 16);
                }
            }
            assert.deepStrictEqual(wasm.compute(inputFor(surface)).pixels, surface.getFullRgba());
        }
    });

    it('matches province row reversal, padding, unique order, and duplicate colors', () => {
        for (const [width, height, colors] of [[1, 1, 1], [5, 3, 3], [13, 19, 7], [256, 256, 127]]) {
            const image = provinceBitmap(width, height, colors);
            const result = wasm.compute({ kind: 'bgr', bytes: image.data, width, height, stride: image.bytesPerRow });
            const expected = scanProvinceColorsTypescript(image);
            assert.deepStrictEqual(new Uint32Array(result.pixels.buffer), expected.colorByPosition);
            assert.deepStrictEqual([...result.colors], expected.provinces.map(province => province.color));
        }
    });

    const rawLayouts = [
        { name: 'RGB', bits: 24, starts: [0, 8, 16] },
        { name: 'BGR', bits: 24, starts: [16, 8, 0] },
        { name: 'RGBA', bits: 32, starts: [0, 8, 16, 24] },
        { name: 'BGRA', bits: 32, starts: [16, 8, 0, 24] },
        { name: 'ARGB', bits: 32, starts: [8, 16, 24, 0] },
        { name: 'ABGR', bits: 32, starts: [24, 16, 8, 0] },
        { name: 'RGBX', bits: 32, starts: [0, 8, 16] },
        { name: 'BGRX', bits: 32, starts: [16, 8, 0] },
    ];
    for (const { name, bits, starts } of rawLayouts) {
        for (const valueType of [PixelValueType.uint, PixelValueType.unorm]) {
            it(`matches all byte values for ${name} ${PixelValueType[valueType]} with Surface byte-for-byte`, () => {
                const surface = rawSurface(bits, starts, valueType);
                const source = surface.getPixelData();
                const before = source.slice();
                const input = rawRgba8Input({ ...ddsInputFor(surface), bytes: source });
                assert.ok(input, name);
                assert.strictEqual(input.kind, 'rgba8');
                assert.strictEqual(input.bytes, source, 'the adapter retains the supplied source view');
                assert.ok(isComputeInputSupported(input));
                const result = wasm.compute(input);
                assert.deepStrictEqual(result.pixels, surface.getFullRgba(), `${name}, ${PixelValueType[valueType]}`);
                assert.strictEqual(result.colors.length, 0);
                assert.deepStrictEqual(source, before);
                for (let channel = 0; channel < starts.length; channel++) {
                    assert.strictEqual(new Set(Array.from({ length: 256 }, (_, pixel): number => source[pixel * bits / 8 + starts[channel] / 8])).size, 256);
                }
                if (starts.length === 3) {
                    assert.ok(result.pixels.every((value, index) => index % 4 !== 3 || value === 255), name);
                }
            });
        }
    }

    it('retains legacy XRGB/XBGR leading-padding behavior in the worker fallback', async () => {
        await withService(async service => {
            for (const starts of [[8, 16, 24], [24, 16, 8]]) {
                for (const valueType of [PixelValueType.uint, PixelValueType.unorm]) {
                    const surface = rawSurface(32, starts, valueType);
                    const input = ddsInputFor(surface);
                    assert.strictEqual(rawRgba8Input(input), undefined);
                    const result = await service.run(input);
                    assert.ok(result?.pngBytes);
                    assert.strictEqual(result.engine, 'typescript-worker');
                    assert.deepStrictEqual(PNG.sync.read(Buffer.from(result.pngBytes)).data, Buffer.from(surface.getFullRgba()));
                }
            }
        });
    });

    it('filters unsupported raw value types, channel widths, and malformed layouts', () => {
        const valid = ddsInputFor(rawSurface(32, [0, 8, 16, 24]));
        const unsupported: Partial<RawPixelFormat>[] = [
            ...[PixelValueType.float, PixelValueType.unorm_srgb, PixelValueType.typeless, PixelValueType.sint, PixelValueType.snorm]
                .map(valueType => ({ valueType })),
            { valueType: PixelValueType.float, bitsPerPixel: 128, channelStartInPixel: [0, 32, 64, 96], channelLengthInPixel: [32, 32, 32, 32] },
            { bitsPerPixel: 16, channelLengthInPixel: [5, 6, 5, 0] },
            { channelLengthInPixel: [10, 10, 10, 2] },
            { channelLengthInPixel: [8, 8, 8, 7] },
            { channelFormat: ChannelFormat.la }, { channelCount: 3 },
            { channelOrderInPixel: [0, 1, 2] }, { channelOrderInPixel: [0, 1, 2, 2] },
            { channelOrderInPixel: [0, 1, 2, 4] }, { channelOrderInPixel: [0, 1, 2, 2.5] },
            { channelStartInPixel: [0, 8, 16] }, { channelStartInPixel: [0, 8, 16, 32] },
            { channelStartInPixel: [-8, 8, 16, 24] }, { channelStartInPixel: [0, 8, 16, 23] },
            { channelStartInPixel: [0, 8, 16, 24.5] },
        ];
        for (const overrides of unsupported) {
            assert.strictEqual(rawRgba8Input({ ...valid, pixelFormat: { ...rawFormat, ...overrides } }), undefined, JSON.stringify(overrides));
        }
        assert.strictEqual(rawRgba8Input({ ...valid, pixelFormat: undefined }), undefined);
        assert.strictEqual(rawRgba8Input(ddsInputFor(compressedSurface(4, 4, CompressFormat.bc1))), undefined);
    });

    it('rejects raw input caps, truncated pixels, and invalid packed offsets before allocating WASM memory', () => {
        const valid = rawRgba8Input(ddsInputFor(rawSurface(24, [0, 8, 16])))!;
        const retained = wasm.retainedMemoryBytes;
        const invalid = [
            { ...valid, width: 0 }, { ...valid, height: -1 }, { ...valid, width: 1.5 },
            { ...valid, width: Math.floor((maxComputeOutputBytes - 12) / 4) + 1, height: 1 },
            { ...valid, bytes: new Uint8Array(maxComputeInputBytes + 1) },
            { ...valid, bytes: valid.bytes.subarray(1) },
            ...[0, 2, 5].map(format => ({ ...valid, format })),
            ...[-1, 1.5, 0x100000000, 0xff020300, 0x03020100].map(stride => ({ ...valid, stride })),
        ];
        for (const input of invalid) {
            assert.strictEqual(isComputeInputSupported(input), false);
            assert.throws(() => wasm.compute(input), /Unsupported Rust compute input/);
            assert.strictEqual(wasm.retainedMemoryBytes, retained);
        }
    });

    it('rejects malformed input before touching WASM memory', () => {
        const valid = inputFor(compressedSurface(4, 4, CompressFormat.bc1));
        for (const input of [
            { ...valid, width: 0 }, { ...valid, width: -1 }, { ...valid, width: 1.5 },
            { ...valid, width: 0xffffffff }, { ...valid, format: 7 }, { ...valid, bytes: valid.bytes.subarray(1) },
            { kind: 'bgr', bytes: new Uint8Array(2), width: 1, height: 1, stride: 3 } as ComputeInput,
        ]) {
            assert.strictEqual(isComputeInputSupported(input), false);
            assert.throws(() => wasm.compute(input), /Unsupported Rust compute input/);
        }
    });

    it('keeps results independent of subsequent WASM growth and allocations', () => {
        const surface = compressedSurface(16, 16, CompressFormat.bc3);
        const first = wasm.compute(inputFor(surface)).pixels;
        const copy = first.slice();
        wasm.compute(inputFor(compressedSurface(1024, 1024, CompressFormat.bc1)));
        assert.deepStrictEqual(first, copy);
    });
});

describe('Rust compute worker lifecycle', function() {
    this.timeout(20_000);

    it('matches decode output without detaching pooled or offset source buffers', async () => {
        await withService(async service => {
            const surface = compressedSurface(13, 17, CompressFormat.bc3, true);
            const source = surface.getPixelData();
            const before = source.slice();
            const result = await service.run(inputFor(surface));
            assert.ok(result);
            assert.deepStrictEqual(result.pixels, surface.getFullRgba());
            assert.deepStrictEqual(source, before);
            assert.strictEqual(source.buffer.byteLength, before.length + 13);
        });
    });

    it('encodes the exact existing PNG bytes for compressed and raw DDS surfaces', async () => {
        await withService(async service => {
            for (const surface of [compressedSurface(13, 17, CompressFormat.bc2, true), new Surface(Uint8Array.of(10, 20, 30, 40).buffer, 0, 4, 'Raw', 1, 1, rawFormat)]) {
                const result = await service.run({ kind: 'dds', bytes: surface.getPixelData(), width: surface.width, height: surface.height, pixelFormat: surface.pixelFormat });
                const png = new PNG({ width: surface.width, height: surface.height });
                png.data = Buffer.from(surface.getFullRgba());
                assert.ok(result?.pngBytes);
                assert.deepStrictEqual(Buffer.from(result.pngBytes), PNG.sync.write(png));
                assert.strictEqual(result.engine, 'rust-wasm');
            }
        });
    });

    it('keeps supported sRGB raw DDS decoding in the TypeScript worker with exact PNG bytes', async () => {
        await withService(async service => {
            const surface = rawSurface(32, [16, 8, 0, 24], PixelValueType.unorm_srgb);
            const input = ddsInputFor(surface);
            assert.strictEqual(rawRgba8Input(input), undefined);
            const expected = new PNG({ width: surface.width, height: surface.height });
            expected.data = Buffer.from(surface.getFullRgba());
            assert.notDeepStrictEqual(expected.data, Buffer.from(rawSurface(32, [16, 8, 0, 24]).getFullRgba()));
            const result = await service.run(input);
            assert.ok(result?.pngBytes);
            assert.strictEqual(result.engine, 'typescript-worker');
            assert.deepStrictEqual(Buffer.from(result.pngBytes), PNG.sync.write(expected));
        });
    });

    it('preserves content errors instead of retrying them on the main thread', async () => {
        await withService(async service => {
            const surface = compressedSurface(4, 4, CompressFormat.bc1);
            await assert.rejects(service.run({ kind: 'dds', bytes: surface.getPixelData(), width: 4, height: 4,
                pixelFormat: { compressed: true, compressFormat: CompressFormat.bc7, alphaPremultiplied: false, valueType: PixelValueType.uint } }), UserError);
            assert.ok(await service.run(inputFor(surface)), 'content errors must not disable the worker');
        });
    });

    it('falls back on missing WASM and worker assets without repeated startup failures', async () => {
        for (const overrides of [{ wasmPath: `${wasmPath}.missing` }, { workerPath: `${workerPath}.missing` }]) {
            const service = createService(overrides);
            try {
                const input = inputFor(compressedSurface(4, 4, CompressFormat.bc1));
                assert.strictEqual(await service.run(input), undefined);
                assert.strictEqual(await service.run(input), undefined);
            } finally { service.dispose(); }
        }
    });

    it('uses the small-input policy without starting a worker', async () => {
        const service = createService({ workerPath: `${workerPath}.missing`, minimumPixels: 256 * 1024 });
        try { assert.strictEqual(await service.run(inputFor(compressedSurface(4, 4, CompressFormat.bc1))), undefined); }
        finally { service.dispose(); }
    });

    it('offloads tiny bulk DDS only when explicitly requested and retains the default small-input policy', async () => {
        const service = new RustComputeService({ workerPath, wasmPath });
        const surface = rawSurface(32, [0, 8, 16, 24], PixelValueType.unorm, 1, 1);
        const input = ddsInputFor(surface);
        try {
            assert.strictEqual(await service.run(input), undefined);
            assert.strictEqual(await service.run({ ...input, offloadSmallImage: false }), undefined);
            const result = await service.run({ ...input, offloadSmallImage: true });
            assert.ok(result?.pngBytes);
            assert.strictEqual(result.engine, 'rust-wasm');
            const png = new PNG({ width: 1, height: 1 });
            png.data = Buffer.from(surface.getFullRgba());
            assert.deepStrictEqual(Buffer.from(result.pngBytes), PNG.sync.write(png));
            const bitmap = provinceBitmap(1, 1, 1);
            const nonDds: ComputeInput[] = [
                inputFor(compressedSurface(4, 4, CompressFormat.bc1)), rawRgba8Input(input)!,
                { kind: 'bgr', bytes: bitmap.data, width: 1, height: 1, stride: bitmap.bytesPerRow },
                { kind: 'edges', bytes: new Uint8Array(4), width: 1, height: 1 },
            ];
            for (const request of nonDds) {
                assert.strictEqual(await service.run({ ...request, offloadSmallImage: true }), undefined, request.kind);
            }
        } finally { service.dispose(); }
    });

    it('cancels queued and active tiny bulk DDS without detaching pooled buffers and restarts safely', async () => {
        const service = new RustComputeService({ workerPath, wasmPath });
        const pooled = Buffer.allocUnsafe(64);
        pooled.fill(0x93);
        const bytes = pooled.subarray(7, 11);
        const snapshot = Buffer.from(pooled);
        const backingLength = pooled.buffer.byteLength;
        const input: ComputeInput = { kind: 'dds', bytes, width: 1, height: 1, pixelFormat: rawFormat, offloadSmallImage: true };
        const active = new AbortController();
        const queued = new AbortController();
        try {
            const first = service.run(input, active.signal);
            const second = service.run(input, queued.signal);
            const assertions = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })];
            queued.abort(); active.abort();
            await Promise.all(assertions);
            assert.deepStrictEqual(pooled, snapshot);
            assert.strictEqual(pooled.buffer.byteLength, backingLength);
            const result = await service.run(input);
            assert.ok(result?.pngBytes);
            assert.strictEqual(result.engine, 'rust-wasm');
            assert.deepStrictEqual([...PNG.sync.read(Buffer.from(result.pngBytes)).data], [...bytes]);
            assert.deepStrictEqual(pooled, snapshot);
            service.dispose();
            await assert.rejects(service.run(input), { name: 'AbortError' });
        } finally { service.dispose(); }
    });

    it('cancels queued and active work, restarts safely, and rejects disposed work', async () => {
        const service = createService();
        try {
            const active = new AbortController();
            const queued = new AbortController();
            const input = inputFor(compressedSurface(1024, 1024, CompressFormat.bc3));
            const first = service.run(input, active.signal);
            const second = service.run(input, queued.signal);
            const assertions = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })];
            queued.abort(); active.abort();
            await Promise.all(assertions);
            assert.ok(await service.run(input));
            service.dispose();
            await assert.rejects(service.run(input), { name: 'AbortError' });
        } finally { service.dispose(); }
    });

    it('bounds queued tasks and survives worker timeouts', async () => {
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hoi4mu-compute-'));
        const stalledWorker = path.join(temp, 'stalled.cjs');
        await fs.writeFile(stalledWorker, "require('node:worker_threads').parentPort.on('message', () => {});\n");
        try {
            const tinyDds = ddsInputFor(rawSurface(32, [0, 8, 16, 24], PixelValueType.unorm, 1, 1));
            const inputs = [inputFor(compressedSurface(4, 4, CompressFormat.bc1)), { ...tinyDds, offloadSmallImage: true }];
            for (const input of inputs) {
                const service = createService({ workerPath: stalledWorker, timeoutMs: 50, minimumPixels: input.kind === 'dds' ? 256 * 1024 : 0 });
                try {
                    const tasks = Array.from({ length: 9 }, () => service.run(input));
                    assert.strictEqual(await service.run(input), undefined, 'the queue must be bounded even for tiny bulk DDS');
                    assert.deepStrictEqual(await Promise.all(tasks), new Array(9).fill(undefined));
                    assert.strictEqual(await service.run(input), undefined);
                    assert.strictEqual(maxComputeInputBytes, 128 * 1024 * 1024);
                } finally { service.dispose(); }
            }
        } finally { await fs.rm(temp, { recursive: true, force: true }); }
    });

    it('wires the production adapters to the registered worker and preserves fallback', async () => {
        const registration = registerRustCompute(root);
        try {
            const surface = compressedSurface(512, 512, CompressFormat.bc1);
            const dds = { images: [surface] } as never;
            const expected = new PNG({ width: 512, height: 512 });
            expected.data = Buffer.from(surface.getFullRgba());
            const encoded = await ddsToPngBufferAsync(dds);
            assert.deepStrictEqual(encoded.pngBuffer, PNG.sync.write(expected));
            const bitmap = provinceBitmap(512, 512, 127);
            assert.deepStrictEqual(await scanProvinceColors(bitmap), scanProvinceColorsTypescript(bitmap));
        } finally { registration.dispose(); }
        const bitmap = provinceBitmap(13, 17);
        assert.deepStrictEqual(await scanProvinceColors(bitmap), scanProvinceColorsTypescript(bitmap));
    });
});
