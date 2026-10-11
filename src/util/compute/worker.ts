import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { PNG } from 'pngjs';
import { UserError } from '../common';
import { Surface } from '../image/dds/surface';
import { ComputeReply, ComputeRequest, ComputeResult, isComputeInputSupported } from './protocol';
import { ComputeInputRejectedError, RustWasmCompute } from './wasm';
import { rawRgba8Input } from './rawformat';

const port = parentPort;
if (!port) {
    throw new Error('Rust compute must run in a worker.');
}

// One worker owns one instance. The service retires large instances and idle workers.
const runtime = readFile((workerData as { wasmPath: string }).wasmPath).then(bytes => RustWasmCompute.create(bytes));
runtime.catch(() => undefined);
let pending = Promise.resolve();
port.on('message', (request: ComputeRequest) => {
    pending = pending.then(async () => {
        const startedAt = performance.now();
        let compute: RustWasmCompute | undefined;
        try {
            compute = await runtime;
            const result = processRequest(compute, request);
            const reply: ComputeReply = { id: request.id, result, durationMs: performance.now() - startedAt };
            const transfers = [result.pixels.buffer as ArrayBuffer, result.colors.buffer as ArrayBuffer];
            if (result.pngBytes) {
                transfers.push(result.pngBytes.buffer as ArrayBuffer);
            }
            if (result.provinceEdges) {
                transfers.push(result.provinceEdges.buffer as ArrayBuffer);
            }
            port.postMessage(reply, transfers);
        } catch (error) {
            const rejected = error instanceof ComputeInputRejectedError;
            const reply: ComputeReply = {
                id: request.id, error: error instanceof Error ? error.message : String(error),
                errorKind: rejected ? 'rejected' : compute && request.kind === 'dds' ? 'input' : 'infrastructure',
                userError: error instanceof UserError, retireWorker: rejected ? compute?.shouldRetireWorker : undefined,
                durationMs: performance.now() - startedAt,
            };
            port.postMessage(reply);
        }
    });
});

function processRequest(compute: RustWasmCompute, request: ComputeRequest): ComputeResult {
    if (request.kind !== 'dds') {
        return { ...compute.compute(request), engine: 'rust-wasm' };
    }
    const format = request.pixelFormat!;
    const surface = new Surface(request.bytes.buffer as ArrayBuffer, request.bytes.byteOffset, request.bytes.byteLength,
        'Main image', request.width, request.height, format);
    const kernelInput = format.compressed ? {
        ...request, kind: 'bcn' as const, format: format.compressFormat, premultiplied: format.alphaPremultiplied,
    } : rawRgba8Input(request);
    let pixels: Uint8Array;
    let engine: ComputeResult['engine'] = 'typescript-worker';
    let retireWorker = false;
    if (kernelInput && compute.supports(kernelInput.kind) && isComputeInputSupported(kernelInput)) {
        try {
            const decoded = compute.compute(kernelInput);
            pixels = decoded.pixels;
            retireWorker = decoded.retireWorker ?? false;
            engine = 'rust-wasm';
        } catch (error) {
            // A rejected/trapped kernel must preserve the existing decoder's behavior.
            retireWorker = !(error instanceof ComputeInputRejectedError) || compute.shouldRetireWorker;
            pixels = surface.getFullRgba();
        }
    } else {
        pixels = surface.getFullRgba();
    }
    const png = new PNG({ width: request.width, height: request.height });
    png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    // PNG encoding is deliberately off the extension-host thread too. Copy pooled buffers.
    const pngBytes = Uint8Array.from(PNG.sync.write(png));
    return { pixels: new Uint8Array(0), colors: new Uint32Array(0), pngBytes, engine, retireWorker };
}
