import { DDS } from "./dds";
import { PNG } from "pngjs";
import { UserError } from '../common';
import { tryRustCompute } from '../compute/service';
import { measureSync } from '../perf';
const TGA = require('tga') as typeof import('tga');

export function ddsToPng(dds: DDS): PNG {
    const img = dds.images[0];

    const png = new PNG({ width: img.width, height: img.height });
    const imgbuffer = img.getFullRgba();
    png.data = Buffer.from(imgbuffer);

    return png;
}

export interface EncodedImage {
    width: number;
    height: number;
    pngBuffer: Buffer;
}

export async function ddsToPngBufferAsync(dds: DDS, signal?: AbortSignal, offloadSmallImage: boolean = false): Promise<EncodedImage> {
    const image = dds.images[0];
    const result = await tryRustCompute({
        kind: 'dds', bytes: image.getPixelData(), width: image.width, height: image.height,
        pixelFormat: image.pixelFormat, offloadSmallImage,
    }, signal);
    signal?.throwIfAborted();
    if (result?.pngBytes) {
        return {
            width: image.width, height: image.height,
            pngBuffer: Buffer.from(result.pngBytes.buffer, result.pngBytes.byteOffset, result.pngBytes.byteLength),
        };
    }
    return measureSync('image.dds.typescript', { width: image.width, height: image.height }, () => {
        const png = ddsToPng(dds);
        return { width: png.width, height: png.height, pngBuffer: PNG.sync.write(png) };
    });
}

export function tgaToPng(buffer: Buffer): PNG {
    const tga = new TGA(buffer);
    const png = new PNG({ width: tga.width, height: tga.height });
    if (!tga.pixels) {
        throw new UserError('Unspported tga format');
    }

    png.data = Buffer.from(tga.pixels);

    return png;
}
