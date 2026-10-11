import type { Point, ProvinceEdgeGraph } from '../../previewdef/worldmap/definitions';
import { maxComputeOutputBytes } from './protocol';

export interface ProvinceEdgeAnalysis {
    byColor: Map<number, ProvinceEdgeGraph[]>;
    onePixels: { color: number; x: number; y: number }[];
    crossings: Point[];
}

// Decode an additive ABI-v1 payload, without mutating the loader's current graph.
// Keeping this compact through the worker boundary avoids cloning thousands of Point objects.
export function decodeProvinceEdges(bytes: Uint8Array, width: number, height: number, palette: ReadonlySet<number>): ProvinceEdgeAnalysis {
    if (bytes.byteLength < 16 || bytes.byteLength % 4 || bytes.byteLength > maxComputeOutputBytes) { throw invalid(); }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 0;
    const word = (): number => {
        if (cursor + 4 > view.byteLength) { throw invalid(); }
        const value = view.getUint32(cursor, true);
        cursor += 4;
        return value;
    };
    const count = (minimumWords: number): number => {
        const value = word();
        if (value > (view.byteLength - cursor) / (minimumWords * 4)) { throw invalid(); }
        return value;
    };
    if (word() !== 1) { throw invalid(); }
    const groups = count(8);
    const onePixelCount = count(3);
    const crossingCount = count(2);
    const byColor = new Map<number, ProvinceEdgeGraph[]>();
    const neighbors = new Map<number, Map<number, ProvinceEdgeGraph>>();
    for (let group = 0; group < groups; group++) {
        const color = word();
        const rawNeighbor = word();
        const toColor = rawNeighbor === 0xffffffff ? -1 : rawNeighbor;
        if (!palette.has(color) || (toColor !== -1 && !palette.has(toColor))) { throw invalid(); }
        const paths = count(5);
        if (!paths) { throw invalid(); }
        let neighborMap = neighbors.get(color);
        if (!neighborMap) {
            neighbors.set(color, neighborMap = new Map());
            byColor.set(color, []);
        }
        let edge = neighborMap.get(toColor);
        if (!edge) {
            neighborMap.set(toColor, edge = { toColor, path: [] });
            byColor.get(color)!.push(edge);
        }
        for (let path = 0; path < paths; path++) {
            const points = count(2);
            if (points < 2) { throw invalid(); }
            const vertices: Point[] = [];
            for (let point = 0; point < points; point++) {
                const x = word();
                const y = word();
                if (x > width || y > height) { throw invalid(); }
                vertices.push({ x, y });
            }
            edge.path.push(vertices);
        }
    }
    const onePixels: ProvinceEdgeAnalysis['onePixels'] = [];
    for (let pixel = 0; pixel < onePixelCount; pixel++) {
        const color = word();
        const x = word();
        const y = word();
        if (!palette.has(color) || x >= width || y >= height) { throw invalid(); }
        onePixels.push({ color, x, y });
    }
    const crossings: Point[] = [];
    for (let crossing = 0; crossing < crossingCount; crossing++) {
        const x = word();
        const y = word();
        if (x >= width || y + 1 >= height) { throw invalid(); }
        crossings.push({ x, y });
    }
    if (cursor !== view.byteLength) { throw invalid(); }
    return { byColor, onePixels, crossings };
}

function invalid(): Error { return new Error('Invalid Rust province edge payload.'); }
