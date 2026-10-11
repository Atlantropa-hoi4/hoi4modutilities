import { CompressFormat, CompressedPixelFormat, PixelValueType } from '../src/util/image/dds/pixelformat';
import { Surface } from '../src/util/image/dds/surface';
import type { BMP } from '../src/util/image/bmp/bmpparser';

export function compressedSurface(width: number, height: number, format: CompressFormat, premultiplied = false, seed = 42): Surface {
    const length = Math.ceil(width / 4) * Math.ceil(height / 4) * (format === CompressFormat.bc1 ? 8 : 16);
    const backing = new Uint8Array(length + 13);
    const bytes = backing.subarray(7, 7 + length);
    let state = seed >>> 0;
    for (let index = 0; index < length; index++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        bytes[index] = state >>> 24;
    }
    const pixelFormat: CompressedPixelFormat = {
        compressed: true, compressFormat: format, alphaPremultiplied: premultiplied, valueType: PixelValueType.uint,
    };
    return new Surface(backing.buffer, bytes.byteOffset, bytes.byteLength, 'Fixture', width, height, pixelFormat);
}

export function provinceBitmap(width: number, height: number, colorCount = 127): BMP {
    const stride = Math.ceil(width * 3 / 4) * 4;
    const backing = new Uint8Array(stride * height + 19);
    const data = backing.subarray(11, 11 + stride * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const color = ((Math.floor(x / 8) + Math.floor(y / 8) * Math.ceil(width / 8)) % colorCount) * 7919 & 0xffffff;
            const offset = y * stride + x * 3;
            data[offset] = color;
            data[offset + 1] = color >>> 8;
            data[offset + 2] = color >>> 16;
        }
        data.fill(0xee, y * stride + width * 3, (y + 1) * stride);
    }
    return { width, height, bitsPerPixel: 24, bytesPerRow: stride, data };
}
