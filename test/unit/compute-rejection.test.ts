import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type { Worker } from 'node:worker_threads';
import { PNG } from 'pngjs';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { UserError } from '../../src/util/common';
import { ComputeInput, ComputeReply, ComputeRequest, isComputeInputSupported } from '../../src/util/compute/protocol';
import { rawRgba8Input } from '../../src/util/compute/rawformat';
import { RustComputeService } from '../../src/util/compute/service';
import { ComputeInputRejectedError, RustWasmCompute } from '../../src/util/compute/wasm';
import { ChannelFormat, CompressFormat, PixelValueType, RawPixelFormat } from '../../src/util/image/dds/pixelformat';
import { Surface } from '../../src/util/image/dds/surface';

type Kernel = (...arguments_: number[]) => number;
interface StubExports {
    memory: { buffer: ArrayBuffer };
    abi_version(): number;
    allocate(length: number): number;
    deallocate(pointer: number, length: number): void;
    process_bcn: Kernel;
    process_bgr: Kernel;
    process_edges?: Kernel;
    process_rgba8?: Kernel;
}

const inputs: ComputeInput[] = [
    { kind: 'bcn', width: 1, height: 1, bytes: new Uint8Array(8), format: 1 },
    { kind: 'bgr', width: 1, height: 1, bytes: Uint8Array.of(10, 20, 30), stride: 3 },
    { kind: 'edges', width: 1, height: 1, bytes: new Uint8Array(4) },
    { kind: 'rgba8', width: 1, height: 1, bytes: Uint8Array.of(10, 20, 30, 40), format: 4, stride: 0x03020100 },
];
const rawFormat: RawPixelFormat = {
    compressed: false, valueType: PixelValueType.unorm, bitsPerPixel: 32, channelCount: 4,
    channelOrderInPixel: [0, 1, 2, 3], channelStartInPixel: [0, 8, 16, 24], channelLengthInPixel: [8, 8, 8, 8], channelFormat: ChannelFormat.rgba,
};
const ddsInputs: ComputeInput[] = [
    { kind: 'dds', width: 1, height: 1, bytes: Uint8Array.of(10, 20, 30, 40), pixelFormat: rawFormat },
    { kind: 'dds', width: 1, height: 1, bytes: new Uint8Array(8), pixelFormat: {
        compressed: true, compressFormat: CompressFormat.bc1, alphaPremultiplied: false, valueType: PixelValueType.uint,
    } },
];

function stubExports(overrides: Partial<StubExports> = {}) {
    const allocations: number[] = [];
    const frees: [number, number][] = [];
    const memory = { buffer: new ArrayBuffer(4096) };
    const output = (edges = false): number => {
        const pixelLength = edges ? 16 : 4;
        const header = new DataView(memory.buffer, 256, 12);
        header.setUint32(0, 12 + pixelLength, true);
        header.setUint32(4, pixelLength, true);
        header.setUint32(8, 0, true);
        new Uint8Array(memory.buffer, 268, pixelLength).set(edges ? [1, 0, 0, 0] : [10, 20, 30, 40]);
        return 256;
    };
    const exports: StubExports = {
        memory, abi_version: () => 1,
        allocate: length => { allocations.push(length); return 32; },
        deallocate: (pointer, length) => { frees.push([pointer, length]); },
        process_bcn: () => output(), process_bgr: () => output(),
        process_edges: () => output(true), process_rgba8: () => output(),
        ...overrides,
    };
    return { exports, allocations, frees };
}

async function createStub(exports: StubExports): Promise<RustWasmCompute> {
    const runtime = (globalThis as unknown as { WebAssembly: {
        instantiate(bytes: Uint8Array): Promise<{ instance: { exports: Record<string, unknown> } }>;
    } }).WebAssembly;
    const instantiate = runtime.instantiate;
    runtime.instantiate = async () => ({ instance: { exports: exports as unknown as Record<string, unknown> } });
    try { return await RustWasmCompute.create(new Uint8Array(0)); }
    finally { runtime.instantiate = instantiate; }
}

// Exercise the current worker source without generating or relying on a worker bundle.
async function workerHarness(compute: RustWasmCompute | Error) {
    let receive: (request: ComputeRequest) => void = () => { throw new Error('Worker listener missing.'); };
    let nextId = 1;
    const replies = new Map<number, (reply: ComputeReply) => void>();
    const sourcePath = path.resolve(__dirname, '../../../src/util/compute/worker.ts');
    const source = await fs.readFile(sourcePath, 'utf8');
    const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
    const imports: Record<string, unknown> = {
        'node:fs/promises': { readFile: async () => new Uint8Array(0) },
        'node:worker_threads': { workerData: { wasmPath: 'unused' }, parentPort: {
            on: (_event: string, listener: typeof receive) => { receive = listener; },
            postMessage: (reply: ComputeReply, transfers: ArrayBuffer[] = []) => {
                const copy = structuredClone(reply, { transfer: transfers });
                replies.get(reply.id)!(copy);
                replies.delete(reply.id);
            },
        } },
        'node:perf_hooks': { performance }, 'pngjs': { PNG }, '../common': { UserError },
        '../image/dds/surface': { Surface }, './protocol': { isComputeInputSupported },
        './rawformat': { rawRgba8Input }, './wasm': { ComputeInputRejectedError, RustWasmCompute: {
            create: async () => { if (compute instanceof Error) { throw compute; } return compute; },
        } },
    };
    vm.runInNewContext(code, { exports: {}, Buffer, Error, Uint8Array, Uint32Array,
        require: (name: string) => { assert.ok(name in imports, name); return imports[name]; },
    }, { filename: sourcePath });
    return (input: ComputeInput): Promise<ComputeReply> => new Promise(resolve => {
        const id = nextId++;
        replies.set(id, resolve);
        receive({ ...input, id });
    });
}

function assertDdsFallback(reply: ComputeReply, input: ComputeInput, retireWorker: boolean): void {
    assert.strictEqual(reply.error, undefined);
    assert.strictEqual(reply.result?.engine, 'typescript-worker');
    assert.strictEqual(reply.result?.retireWorker, retireWorker);
    const surface = new Surface(input.bytes.buffer as ArrayBuffer, input.bytes.byteOffset, input.bytes.byteLength,
        'Fixture', input.width, input.height, input.pixelFormat!);
    const png = new PNG({ width: input.width, height: input.height });
    png.data = Buffer.from(surface.getFullRgba());
    assert.deepStrictEqual(Buffer.from(reply.result!.pngBytes!), PNG.sync.write(png));
}

function trappingKernel(): Kernel {
    // A real WASM export executing unreachable, independent of generated/local WASM artifacts.
    const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127,
        3, 2, 1, 0, 7, 8, 1, 4, 116, 114, 97, 112, 0, 0, 10, 5, 1, 3, 0, 0, 11]);
    return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.trap as Kernel;
}

describe('Rust compute input rejection', () => {
    it('keeps ABI 1 BCN/BGR available when optional exports are absent, declining before allocation', async () => {
        const stub = stubExports({ process_edges: undefined, process_rgba8: undefined });
        const compute = await createStub(stub.exports);
        assert.strictEqual(compute.supports('dds'), false);
        for (const input of inputs.slice(2)) {
            assert.strictEqual(compute.supports(input.kind), false);
            assert.throws(() => compute.compute(input), ComputeInputRejectedError);
        }
        assert.deepStrictEqual(stub.allocations, []);
        assert.deepStrictEqual(stub.frees, []);
        for (const input of inputs.slice(0, 2)) {
            assert.strictEqual(compute.supports(input.kind), true);
            assert.deepStrictEqual([...compute.compute(input).pixels], [10, 20, 30, 40]);
        }
    });

    for (const input of inputs) {
        it(`types ${input.kind} return-zero rejection and frees only the input allocation`, async () => {
            const name = `process_${input.kind}` as keyof StubExports;
            const stub = stubExports({ [name]: () => 0 });
            const compute = await createStub(stub.exports);
            assert.strictEqual(compute.supports(input.kind), true);
            assert.throws(() => compute.compute(input), ComputeInputRejectedError);
            assert.deepStrictEqual(stub.allocations, [input.bytes.byteLength]);
            assert.deepStrictEqual(stub.frees, [[32, input.bytes.byteLength]]);
            assert.strictEqual(compute.shouldRetireWorker, false);
        });
    }

    it('preserves mandatory exports and ABI validation as initialization failures', async () => {
        for (const overrides of [{ abi_version: () => 2 }, { process_bcn: undefined }, { process_bgr: undefined },
            { allocate: undefined }, { deallocate: undefined }, { memory: undefined }]) {
            await assert.rejects(createStub(stubExports(overrides).exports), error => error instanceof Error && !(error instanceof ComputeInputRejectedError));
        }
        await assert.rejects(RustWasmCompute.create(Uint8Array.of(1, 2, 3)), WebAssembly.CompileError);
    });

    it('keeps invalid serialized results and actual WASM traps fatal, regardless of error wording', async () => {
        const invalid = stubExports({ process_bgr: () => 256 });
        const compute = await createStub(invalid.exports);
        assert.throws(() => compute.compute(inputs[1]), error => error instanceof Error && !(error instanceof ComputeInputRejectedError));
        assert.deepStrictEqual(invalid.frees, [[32, 3]]);
        const trapped = stubExports({ process_bgr: trappingKernel() });
        assert.throws(() => trappingKernel()(), WebAssembly.RuntimeError);
        const trapCompute = await createStub(trapped.exports);
        assert.throws(() => trapCompute.compute(inputs[1]), WebAssembly.RuntimeError);
        assert.deepStrictEqual(trapped.frees, [[32, 3]]);
        const similarMessage = await createStub(stubExports({ process_bgr: () => { throw new Error('Rust compute rejected the input.'); } }).exports);
        assert.throws(() => similarMessage.compute(inputs[1]), error => error instanceof Error && !(error instanceof ComputeInputRejectedError));
    });
});

describe('Rust compute worker rejection protocol', () => {
    it('skips absent optional raw DDS kernels without allocating or retiring and still processes BCN', async () => {
        const stub = stubExports({ process_rgba8: undefined, process_edges: undefined });
        const send = await workerHarness(await createStub(stub.exports));
        assertDdsFallback(await send(ddsInputs[0]), ddsInputs[0], false);
        assertDdsFallback(await send(ddsInputs[0]), ddsInputs[0], false);
        assert.deepStrictEqual(stub.allocations, []);
        assert.strictEqual((await send(inputs[0])).result?.engine, 'rust-wasm');
        for (const input of inputs.slice(2)) {
            const reply = await send(input);
            assert.strictEqual(reply.errorKind, 'rejected');
            assert.strictEqual(reply.retireWorker, false);
        }
        assert.deepStrictEqual(stub.allocations, [8]);
    });

    it('falls back inside the worker for normal raw/BCN DDS rejection without retiring', async () => {
        const compute = await createStub(stubExports({ process_rgba8: () => 0, process_bcn: () => 0 }).exports);
        const send = await workerHarness(compute);
        for (const input of ddsInputs) { assertDdsFallback(await send(input), input, false); }
        assert.strictEqual((await send(inputs[1])).result?.engine, 'rust-wasm');
    });

    it('reports direct kernel rejection separately from infrastructure failure', async () => {
        const compute = await createStub(stubExports({ process_bcn: () => 0, process_bgr: () => 0, process_edges: () => 0, process_rgba8: () => 0 }).exports);
        const send = await workerHarness(compute);
        for (const input of inputs) {
            const reply = await send(input);
            assert.strictEqual(reply.errorKind, 'rejected', input.kind);
            assert.strictEqual(reply.retireWorker, false);
            assert.strictEqual(reply.result, undefined);
        }
    });

    it('retires rejected direct/DDS work at the inclusive retained-memory high-water mark', async () => {
        const stub = stubExports({ process_rgba8: () => 0, process_bgr: () => 0 });
        const compute = await createStub(stub.exports);
        const send = await workerHarness(compute);
        stub.exports.memory.buffer = new ArrayBuffer(128 * 1024 * 1024 - 1);
        assert.strictEqual((await send(inputs[1])).retireWorker, false);
        stub.exports.memory.buffer = new ArrayBuffer(128 * 1024 * 1024);
        assert.strictEqual((await send(inputs[1])).retireWorker, true);
        assertDdsFallback(await send(ddsInputs[0]), ddsInputs[0], true);
    });

    it('preserves worker DDS fallback/retirement and direct fatal replies for invalid output and actual traps', async () => {
        for (const kernel of [() => 256, trappingKernel(), () => { throw new Error('Rust compute rejected the input.'); }]) {
            const send = await workerHarness(await createStub(stubExports({ process_bgr: kernel, process_rgba8: kernel, process_bcn: kernel }).exports));
            assert.strictEqual((await send(inputs[1])).errorKind, 'infrastructure');
            for (const input of ddsInputs) { assertDdsFallback(await send(input), input, true); }
        }
    });

    it('keeps initialization failures fatal and content errors marked as UserError', async () => {
        const uninitialized = await workerHarness(new Error('Bad ABI.'));
        assert.strictEqual((await uninitialized(ddsInputs[0])).errorKind, 'infrastructure');
        const send = await workerHarness(await createStub(stubExports().exports));
        const reply = await send({ ...ddsInputs[0], pixelFormat: { ...rawFormat, valueType: PixelValueType.typeless } });
        assert.strictEqual(reply.errorKind, 'input');
        assert.strictEqual(reply.userError, true);
        assert.strictEqual(reply.error, "Can't get rgba from typeless pixel value");
        assert.strictEqual((await send(inputs[1])).result?.engine, 'rust-wasm');
    });
});

// The service tests use a temporary worker so they exercise real transfers and worker identities.
const fakeWorker = `
const { parentPort, threadId } = require('node:worker_threads');
let jobs = 0;
parentPort.on('message', request => {
    const action = request.bytes[0];
    jobs++;
    if (action <= 3) {
        parentPort.postMessage({ id: request.id, error: 'fixture failure', durationMs: 0,
            errorKind: action <= 1 ? 'rejected' : action === 2 ? 'infrastructure' : 'input',
            userError: action === 3, retireWorker: action === 1 });
        return;
    }
    const pixels = request.bytes.slice();
    request.bytes.fill(255);
    const colors = Uint32Array.of(threadId, jobs);
    parentPort.postMessage({ id: request.id, result: { pixels, colors }, durationMs: 0 }, [pixels.buffer, colors.buffer]);
});
`;

async function withFakeService(run: (service: RustComputeService) => Promise<void>): Promise<void> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hoi4mu-rejection-'));
    const workerPath = path.join(directory, 'worker.cjs');
    await fs.writeFile(workerPath, fakeWorker);
    const service = new RustComputeService({ workerPath, wasmPath: 'unused', minimumPixels: 0 });
    try { await run(service); }
    finally {
        service.dispose();
        await (service as unknown as { stopping?: Promise<void> }).stopping;
        await fs.rm(directory, { recursive: true, force: true });
    }
}

function serviceInput(action: number): ComputeInput {
    return { ...inputs[1], bytes: Uint8Array.of(action, 20, 30) };
}

describe('Rust compute service rejected-job lifecycle', function() {
    this.timeout(10_000);

    it('resolves only the rejected job and processes queued and later jobs on the same available worker', async () => {
        await withFakeService(async service => {
            const jobs = [service.run(serviceInput(0)), service.run(serviceInput(10)), service.run(serviceInput(11))];
            const [rejected, first, second] = await Promise.all(jobs);
            assert.strictEqual(rejected, undefined);
            assert.ok(first && second);
            assert.strictEqual(first.colors[0], second.colors[0]);
            assert.deepStrictEqual([first.colors[1], second.colors[1]], [2, 3]);
            const later = await service.run(serviceInput(12));
            assert.ok(later);
            assert.strictEqual(later.colors[0], first.colors[0]);
            assert.strictEqual(later.colors[1], 4);
        });
    });

    it('retires high-water rejection and resumes pending work on a fresh worker', async () => {
        await withFakeService(async service => {
            const [rejected, first, second] = await Promise.all([
                service.run(serviceInput(1)), service.run(serviceInput(10)), service.run(serviceInput(11)),
            ]);
            assert.strictEqual(rejected, undefined);
            assert.ok(first && second);
            assert.deepStrictEqual([first.colors[1], second.colors[1]], [1, 2]);
            assert.strictEqual(first.colors[0], second.colors[0]);
        });
    });

    it('waits for the termination promise before replacing a worker after rejection', async () => {
        await withFakeService(async service => {
            const rejected = service.run(serviceInput(1));
            const state = service as unknown as { worker?: Worker; stopping?: Promise<void> };
            assert.ok(state.worker);
            const terminate = state.worker.terminate.bind(state.worker);
            let releaseTermination!: () => void;
            let didTerminate!: () => void;
            const gate = new Promise<void>(resolve => { releaseTermination = resolve; });
            const terminated = new Promise<void>(resolve => { didTerminate = resolve; });
            state.worker.terminate = async () => {
                const code = await terminate();
                didTerminate();
                await gate;
                return code;
            };
            const queued = service.run(serviceInput(10));
            try {
                assert.strictEqual(await rejected, undefined);
                await terminated;
                assert.ok(state.stopping);
                assert.strictEqual(state.worker, undefined, 'replacement must wait for termination to settle');
                releaseTermination();
                assert.strictEqual((await queued)?.colors[1], 1);
            } finally {
                releaseTermination();
                await Promise.allSettled([rejected, queued]);
            }
        });
    });

    it('preserves infrastructure failure disabling the service and resolving pending jobs', async () => {
        await withFakeService(async service => {
            assert.deepStrictEqual(await Promise.all([service.run(serviceInput(2)), service.run(serviceInput(10))]), [undefined, undefined]);
            assert.strictEqual(await service.run(serviceInput(11)), undefined);
        });
    });

    it('propagates content UserError and continues queued work', async () => {
        await withFakeService(async service => {
            const content = service.run(serviceInput(3));
            const healthy = service.run(serviceInput(10));
            await assert.rejects(content, error => error instanceof UserError && error.message === 'fixture failure');
            assert.strictEqual((await healthy)?.colors[1], 2);
        });
    });

    it('copies offset arrays and pooled Buffers without aliasing or detaching their storage', async () => {
        await withFakeService(async service => {
            const pooled = Buffer.allocUnsafe(64);
            pooled.fill(10);
            const array = new Uint8Array(64).fill(11);
            for (const source of [pooled, array]) {
                const before = Buffer.from(source);
                const backingLength = source.buffer.byteLength;
                const bytes = source.subarray(7, 10);
                const result = await service.run({ ...inputs[1], bytes });
                assert.ok(result);
                assert.deepStrictEqual([...result.pixels], [...before.subarray(7, 10)]);
                assert.strictEqual(source.buffer.byteLength, backingLength);
                assert.deepStrictEqual(Buffer.from(source), before);
            }
        });
    });

    it('cleans cancellation listeners after rejection and preserves active/queued cancellation and restart', async () => {
        await withFakeService(async service => {
            const rejectedController = new AbortController();
            assert.strictEqual(await service.run(serviceInput(0), rejectedController.signal), undefined);
            rejectedController.abort();
            const active = new AbortController();
            const queued = new AbortController();
            const first = service.run(serviceInput(10), active.signal);
            const second = service.run(serviceInput(11), queued.signal);
            const assertions = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })];
            queued.abort(); active.abort();
            await Promise.all(assertions);
            assert.ok(await service.run(serviceInput(12)));
            service.dispose();
            await assert.rejects(service.run(serviceInput(13)), { name: 'AbortError' });
        });
    });
});
