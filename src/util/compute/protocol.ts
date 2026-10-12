import type { PixelFormat } from '../image/dds/pixelformat';

export interface ComputeInput {
    kind: 'bcn' | 'bgr' | 'dds' | 'edges' | 'rgba8';
    offloadSmallImage?: boolean;
    pixelFormat?: PixelFormat;
    bytes: Uint8Array;
    width: number;
    height: number;
    format?: number;
    premultiplied?: boolean;
    stride?: number;
}

export interface ComputeResult {
    kind?: 'image';
    pixels: Uint8Array;
    colors: Uint32Array;
    pngBytes?: Uint8Array;
    provinceEdges?: Uint8Array;
    engine?: 'rust-wasm' | 'typescript-worker';
    retireWorker?: boolean;
}

export interface ScriptIndexInput {
    kind: 'focus-index' | 'gfx-index';
    bytes: Uint8Array;
}

export interface ScriptIndexResult {
    kind: 'script-index';
    entries: string[];
    engine?: 'rust-wasm';
    retireWorker?: boolean;
}

export type AnyComputeInput = ComputeInput | ScriptIndexInput;
export type AnyComputeResult = ComputeResult | ScriptIndexResult;
export type ComputeRequest = AnyComputeInput & { id: number };

export interface ComputeReply<T extends AnyComputeResult = ComputeResult> {
    id: number;
    result?: T;
    error?: string;
    errorKind?: 'input' | 'rejected' | 'infrastructure';
    userError?: boolean;
    retireWorker?: boolean;
    durationMs: number;
    computeMs?: number;
}

export const maxComputeInputBytes = 128 * 1024 * 1024;
export const maxComputeOutputBytes = 256 * 1024 * 1024;
export const minimumComputePixels = 256 * 1024;

function validDimensions(width: number, height: number): boolean {
    return [width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff)
        && width * height * 4 + 12 <= maxComputeOutputBytes;
}

export function isComputeInputSupported(input: AnyComputeInput): boolean {
    const { bytes } = input;
    if (bytes.byteLength > maxComputeInputBytes) { return false; }
    if (!('width' in input)) { return bytes.byteLength > 0; }
    const { width, height } = input;
    if (!validDimensions(width, height)) { return false; }
    if (input.kind === 'dds') {
        return input.pixelFormat !== undefined && bytes.byteLength > 0;
    }
    if (input.kind === 'edges') { return bytes.byteLength === width * height * 4; }
    if (input.kind === 'rgba8') {
        const offsets = input.stride ?? -1;
        const pixelStride = input.format ?? 0;
        return [3, 4].includes(pixelStride) && bytes.byteLength >= width * height * pixelStride
            && Number.isSafeInteger(offsets) && offsets >= 0 && offsets <= 0xffffffff
            && [0, 8, 16].every(shift => ((offsets >>> shift) & 255) < pixelStride)
            && ((offsets >>> 24) === 255 || (offsets >>> 24) < pixelStride);
    }
    if (input.kind === 'bcn') {
        return [1, 2, 3].includes(input.format ?? 0)
            && bytes.byteLength === Math.ceil(width / 4) * Math.ceil(height / 4) * (input.format === 1 ? 8 : 16);
    }
    const stride = input.stride ?? 0;
    return input.kind === 'bgr' && Number.isSafeInteger(stride) && stride >= width * 3 && stride <= 0xffffffff
        && bytes.byteLength >= stride * height;
}
