import { isComputeInputSupported, maxComputeOutputBytes } from './protocol';
import type { AnyComputeInput, AnyComputeResult, ComputeInput, ComputeResult, ScriptIndexInput, ScriptIndexResult } from './protocol';

interface ComputeExports {
    memory: { buffer: ArrayBuffer };
    abi_version(): number;
    allocate(length: number): number;
    deallocate(pointer: number, length: number): void;
    process_bcn(pointer: number, length: number, width: number, height: number, format: number, premultiplied: number): number;
    process_bgr(pointer: number, length: number, width: number, height: number, stride: number): number;
    process_edges?(pointer: number, length: number, width: number, height: number): number;
    process_rgba8?(pointer: number, length: number, width: number, height: number, pixelStride: number, channelOffsets: number): number;
    process_script_index?(pointer: number, length: number, mode: number): number;
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

    public supports(kind: AnyComputeInput['kind']): boolean {
        switch (kind) {
            case 'bcn': case 'bgr': return true;
            case 'edges': return typeof this.exports.process_edges === 'function';
            case 'rgba8': return typeof this.exports.process_rgba8 === 'function';
            case 'focus-index': case 'gfx-index': return typeof this.exports.process_script_index === 'function';
            default: return false;
        }
    }

    public compute(input: ComputeInput): ComputeResult;
    public compute(input: ScriptIndexInput): ScriptIndexResult;
    public compute(input: AnyComputeInput): AnyComputeResult;
    public compute(input: AnyComputeInput): AnyComputeResult {
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
            if (!('width' in input)) {
                outputPointer = this.exports.process_script_index!(inputPointer, inputLength, input.kind === 'focus-index' ? 0 : 1) >>> 0;
            } else if (input.kind === 'edges') {
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
            if (!('width' in input)) {
                const header = new DataView(memory, outputPointer, 8);
                outputLength = header.getUint32(0, true);
                const count = header.getUint32(4, true);
                if (outputLength < 8 || outputLength > maxComputeOutputBytes || outputPointer + outputLength > memory.byteLength
                    || count > (outputLength - 8) / 4) {
                    throw new Error('Invalid Rust script index result.');
                }
                const data = new DataView(memory, outputPointer, outputLength);
                const entries: string[] = [];
                let offset = 8;
                for (let index = 0; index < count; index++) {
                    if (offset + 4 > outputLength) { throw new Error('Truncated Rust script index result.'); }
                    const length = data.getUint32(offset, true);
                    offset += 4;
                    if (offset + length > outputLength) { throw new Error('Truncated Rust script index entry.'); }
                    entries.push(Buffer.from(memory, outputPointer + offset, length).toString('utf8'));
                    offset += length;
                }
                if (offset !== outputLength) { throw new Error('Trailing Rust script index result.'); }
                return { kind: 'script-index', entries, retireWorker: this.shouldRetireWorker };
            }
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
