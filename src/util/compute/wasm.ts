import { ComputeInput, ComputeResult, isComputeInputSupported, maxComputeOutputBytes } from './protocol';

interface ComputeExports {
    memory: { buffer: ArrayBuffer };
    abi_version(): number;
    allocate(length: number): number;
    deallocate(pointer: number, length: number): void;
    process_bcn(pointer: number, length: number, width: number, height: number, format: number, premultiplied: number): number;
    process_bgr(pointer: number, length: number, width: number, height: number, stride: number): number;
    process_edges?(pointer: number, length: number, width: number, height: number): number;
    process_rgba8?(pointer: number, length: number, width: number, height: number, pixelStride: number, channelOffsets: number): number;
}

// The extension host's TypeScript configuration intentionally excludes DOM globals.
interface WasmRuntime {
    instantiate(bytes: Uint8Array): Promise<{ instance: { exports: Record<string, unknown> } }>;
}

export class ComputeInputRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ComputeInputRejectedError';
    }
}

export class RustWasmCompute {
    private constructor(private readonly exports: ComputeExports) {}

    public static async create(bytes: Uint8Array): Promise<RustWasmCompute> {
        const runtime = (globalThis as unknown as { WebAssembly: WasmRuntime }).WebAssembly;
        const { instance } = await runtime.instantiate(bytes);
        const exports = instance.exports as unknown as ComputeExports;
        for (const name of ['abi_version', 'allocate', 'deallocate', 'process_bcn', 'process_bgr'] as const) {
            if (typeof exports[name] !== 'function') {
                throw new Error(`Missing Rust compute export: ${name}`);
            }
        }
        if (!exports.memory?.buffer || exports.abi_version() !== 1) {
            throw new Error('Unsupported Rust compute ABI.');
        }
        return new RustWasmCompute(exports);
    }

    public get retainedMemoryBytes(): number { return this.exports.memory.buffer.byteLength; }

    public get shouldRetireWorker(): boolean { return this.retainedMemoryBytes >= 128 * 1024 * 1024; }

    public supports(kind: ComputeInput['kind']): boolean {
        switch (kind) {
            case 'bcn': case 'bgr': return true;
            case 'edges': return typeof this.exports.process_edges === 'function';
            case 'rgba8': return typeof this.exports.process_rgba8 === 'function';
            default: return false;
        }
    }

    public compute(input: ComputeInput): ComputeResult {
        if (!this.supports(input.kind) || !isComputeInputSupported(input)) {
            throw new ComputeInputRejectedError('Unsupported Rust compute input.');
        }
        const inputLength = input.bytes.byteLength;
        const inputPointer = this.exports.allocate(inputLength) >>> 0;
        if (!inputPointer) {
            throw new Error('Rust compute input allocation failed.');
        }
        let outputPointer = 0;
        let outputLength = 0;
        try {
            new Uint8Array(this.exports.memory.buffer, inputPointer, inputLength).set(input.bytes);
            if (input.kind === 'edges') {
                outputPointer = this.exports.process_edges!(inputPointer, inputLength, input.width, input.height) >>> 0;
            } else if (input.kind === 'rgba8') {
                outputPointer = this.exports.process_rgba8!(inputPointer, inputLength, input.width, input.height, input.format!, input.stride!) >>> 0;
            } else {
                outputPointer = (input.kind === 'bcn'
                    ? this.exports.process_bcn(inputPointer, inputLength, input.width, input.height, input.format!, Number(input.premultiplied ?? false))
                    : this.exports.process_bgr(inputPointer, inputLength, input.width, input.height, input.stride!)) >>> 0;
            }
            if (!outputPointer) {
                throw new ComputeInputRejectedError('Rust compute rejected the input.');
            }
            // Processing may grow memory: never retain a view across an exported call.
            const memory = this.exports.memory.buffer;
            const header = new DataView(memory, outputPointer, 12);
            outputLength = header.getUint32(0, true);
            const pixelLength = header.getUint32(4, true);
            const colorCount = header.getUint32(8, true);
            const isEdges = input.kind === 'edges';
            if (outputLength > maxComputeOutputBytes || outputLength !== 12 + pixelLength + colorCount * 4
                || outputPointer + outputLength > memory.byteLength
                || (isEdges ? pixelLength < 16 || pixelLength % 4 !== 0 || colorCount !== 0 : pixelLength !== input.width * input.height * 4)
                || ((input.kind === 'bcn' || input.kind === 'rgba8') && colorCount !== 0) || colorCount > input.width * input.height) {
                throw new Error('Invalid Rust compute result.');
            }
            const pixels = new Uint8Array(memory, outputPointer + 12, pixelLength).slice();
            const retireWorker = this.shouldRetireWorker;
            if (isEdges) { return { pixels: new Uint8Array(0), colors: new Uint32Array(0), provinceEdges: pixels, retireWorker }; }
            const colors = new Uint32Array(colorCount);
            const colorView = new DataView(memory, outputPointer + 12 + pixelLength, colorCount * 4);
            for (let index = 0; index < colorCount; index++) {
                colors[index] = colorView.getUint32(index * 4, true);
            }
            return { pixels, colors, retireWorker };
        } finally {
            this.exports.deallocate(inputPointer, inputLength);
            if (outputPointer && outputLength) {
                this.exports.deallocate(outputPointer, outputLength);
            }
        }
    }
}
