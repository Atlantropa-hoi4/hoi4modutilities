import type { BMP } from './bmpparser';
import { tryRustCompute } from '../../compute/service';
import type { ComputeResult } from '../../compute/protocol';

export interface ProvinceColorContainer {
    color: number;
    warnings: [];
}

export interface ProvinceColors {
    colorByPosition: Uint32Array;
    provinces: ProvinceColorContainer[];
    colorToProvince: Record<number, ProvinceColorContainer>;
}

export function scanProvinceColorsTypescript(image: BMP): ProvinceColors {
    const colorByPosition = new Uint32Array(image.width * image.height);
    const provinces: ProvinceColorContainer[] = [];
    const colorToProvince: Record<number, ProvinceColorContainer> = {};
    for (let y = image.height - 1, sy = 0, dy = (image.height - 1) * image.width;
        y >= 0; y--, sy += image.bytesPerRow, dy -= image.width) {
        for (let x = 0, sx = sy, dx = dy; x < image.width; x++, sx += 3, dx++) {
            const color = (image.data[sx + 2] << 16) | (image.data[sx + 1] << 8) | image.data[sx];
            let province = colorToProvince[color];
            if (province === undefined) {
                province = { color, warnings: [] };
                provinces.push(province);
                colorToProvince[color] = province;
            }
            colorByPosition[dx] = province.color;
        }
    }
    return { colorByPosition, provinces, colorToProvince };
}

export async function scanProvinceColors(image: BMP, signal?: AbortSignal): Promise<ProvinceColors> {
    // Retain the legacy behavior for non-24-bit bitmaps and malformed row layouts.
    const result = image.bitsPerPixel === 24 ? await tryRustCompute({
        kind: 'bgr', bytes: image.data, width: image.width, height: image.height, stride: image.bytesPerRow,
    }, signal) : undefined;
    signal?.throwIfAborted();
    if (!result) {
        return scanProvinceColorsTypescript(image);
    }
    return provinceColorsFromComputeResult(result);
}

export function provinceColorsFromComputeResult(result: ComputeResult): ProvinceColors {
    let colorByPosition: Uint32Array;
    if (new Uint8Array(Uint32Array.of(1).buffer)[0] === 1) {
        colorByPosition = new Uint32Array(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength / 4);
    } else {
        const view = new DataView(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength);
        colorByPosition = Uint32Array.from({ length: result.pixels.byteLength / 4 }, (_, index) => view.getUint32(index * 4, true));
    }
    const provinces: ProvinceColorContainer[] = [];
    const colorToProvince: Record<number, ProvinceColorContainer> = {};
    for (const color of result.colors) {
        const province: ProvinceColorContainer = { color, warnings: [] };
        provinces.push(province);
        colorToProvince[color] = province;
    }
    return { colorByPosition, provinces, colorToProvince };
}
