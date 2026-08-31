import { UserError } from "../../../util/common";
import { readFileFromModOrHOI4 } from "../../../util/fileloader";
import { localize } from "../../../util/i18n";
import { BMP, parseBmp } from "../../../util/image/bmp/bmpparser";
import { Point, ProgressReporter, ProvinceBmp, ProvinceEdgeGraph, ProvinceGraph, Region, WorldMapWarning, Zone } from "../definitions";
import { FileLoader, LoadResult, LoadResultOD, mergeRegions } from "./common";
import { LoaderSession } from '../../../util/loader/loader';
import { DefinesLoader } from './defines';

export class ProvinceBmpLoader extends FileLoader<ProvinceBmp> {
    private readonly definesLoader = new DefinesLoader();

    public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
        return await super.shouldReloadImpl(session) || await this.definesLoader.shouldReload(session);
    }

    protected async loadFromFile(session: LoaderSession): Promise<LoadResultOD<ProvinceBmp>> {
        const warnings: WorldMapWarning[] = [];
        const defines = await this.definesLoader.load(session);
        return {
            result: await loadProvincesBmp(this.file, e => this.fireOnProgressEvent(e), defines.result.minimumProvinceSize?.value ?? 8, warnings),
            warnings,
            dependencies: [this.file, ...defines.dependencies],
        };
    }

    protected extraMesurements(result: LoadResult<ProvinceBmp>) {
        return {
            ...super.extraMesurements(result),
            width: result.result.width,
            height: result.result.height,
            provinceCount: result.result.provinces.length
        };
    }

    public toString() {
        return `[ProvinceBmpLoader: ${this.file}]`;
    }
}

async function loadProvincesBmp(
    provincesFile: string,
    progressReporter: ProgressReporter,
    minimumProvinceSize: number,
    warnings: WorldMapWarning[],
): Promise<ProvinceBmp> {
    await progressReporter(localize('worldmap.progress.loadingprovincebmp', 'Loading province bmp...',));

    const [provinceMapImageBuffer] = await readFileFromModOrHOI4(provincesFile);
    const provinceMapImage = parseProvinceBmpBuffer(provinceMapImageBuffer);
    
    await progressReporter(localize('worldmap.progress.calculatingregion', 'Calculating province region...'));

    const { colorByPosition, provinces: colorOnlyProvinces, colorToProvince } = getProvincesByPosition(provinceMapImage);
    
    const width = provinceMapImage.width;
    const height = provinceMapImage.height;
    const provincesWithZone = fillProvinceZones(colorOnlyProvinces, colorToProvince, colorByPosition, width, height,
        provincesFile, minimumProvinceSize, warnings);
    
    await progressReporter(localize('worldmap.progress.calculatingedge', 'Calculating province edges...'));
    
    const provinces = fillEdges(provincesWithZone, colorToProvince as Record<number, ColorContainer & ProvinceZoneDef>,
        colorByPosition, width, height, provincesFile, warnings);

    validateProvince(colorByPosition, width, height, provincesFile, warnings);

    return {
        width,
        height,
        colorByPosition,
        colorToProvince: colorToProvince as unknown as Record<number, ProvinceGraph>,
        provinces,
    };
}

type ColorContainer = { color: number, warnings: [] };
function getProvincesByPosition(provinceMapImage: BMP): { colorByPosition: Uint32Array, provinces: ColorContainer[], colorToProvince: Record<number, ColorContainer> } {
    if (provinceMapImage.width % 256 !== 0 || provinceMapImage.height % 256 !== 0) {
        throw new UserError(localize('worldmap.error.multiply256', 'Height and width of map image must be multiply of 256: {0}x{1}.',
            provinceMapImage.width, provinceMapImage.height));
    }

    const colorByPosition = new Uint32Array(provinceMapImage.width * provinceMapImage.height);
    const bitmapData = provinceMapImage.data;
    const provinces: ColorContainer[] = [];
    const colorToProvince: Record<number, ColorContainer> = {};

    for (let y = provinceMapImage.height - 1, sy = 0, dy = (provinceMapImage.height - 1) * provinceMapImage.width;
        y >= 0;
        y--, sy += provinceMapImage.bytesPerRow, dy -= provinceMapImage.width) {
        for (let x = 0, sx = sy, dx = dy; x < provinceMapImage.width; x++, sx += 3, dx++) {
            const color = (bitmapData[sx + 2] << 16) | (bitmapData[sx + 1] << 8) | bitmapData[sx];
            const province = colorToProvince[color];
            if (province === undefined) {
                const newProvince: ColorContainer = { color, warnings: [] };

                provinces.push(newProvince);
                colorToProvince[color] = newProvince;
                colorByPosition[dx] = color;
            } else {
                colorByPosition[dx] = province.color;
            }
        }
    }

    return {
        colorByPosition,
        colorToProvince,
        provinces,
    };
}

export function parseProvinceBmpBuffer(buffer: Uint8Array): BMP {
    return parseBmp(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
}

export function getProvinceColorsByPositionForTest(provinceMapImage: BMP): Uint32Array {
    return getProvincesByPosition(provinceMapImage).colorByPosition;
}

type ProvinceZoneDef = { coverZones: Zone[] } & Region;
function fillProvinceZones<T extends ColorContainer>(
    provincesWithoutCoverZones: (T & Partial<ProvinceZoneDef>)[],
    colorToProvince: Record<number, T & Partial<ProvinceZoneDef>>,
    colorByPosition: Uint32Array,
    width: number,
    height: number,
    file: string,
    minimumProvinceSize: number,
    warnings: WorldMapWarning[],
): (T & ProvinceZoneDef)[] {
    const blockStack: Zone[] = [];
    const blockSize = 256;
    for (let x = 0; x < width; x += blockSize) {
        for (let y = 0; y < height; y += blockSize) {
            blockStack.push({ x, y, w: blockSize, h: blockSize });
        }
    }
    
    for (const province of provincesWithoutCoverZones) {
        province.coverZones = [];
    }

    const provinces = provincesWithoutCoverZones as (T & Partial<ProvinceZoneDef> & { coverZones: Zone[] })[];

    while (blockStack.length > 0) {
        const block = blockStack.pop()!;
        const t = block.y;
        const l = block.x;
        const b = block.y + block.h;
        const r = block.x + block.w;
        const color = colorByPosition[t * width + l];
        let sameColor = true;
        for (let y = t, yi = t * width; y < b; y++, yi += width) {
            for (let x = l, xi = yi + l; x < r; x++, xi++) {
                if (colorByPosition[xi] !== color) {
                    sameColor = false;
                    break;
                }
            }
            if (!sameColor) {
                break;
            }
        }

        if (sameColor) {
            colorToProvince[color].coverZones!.push(block);
        } else {
            const blockSize = block.w >> 1;
            blockStack.push({ ...block, w: blockSize, h: blockSize });
            blockStack.push({ ...block, x: block.x + blockSize, w: blockSize, h: blockSize });
            blockStack.push({ ...block, y: block.y + blockSize, w: blockSize, h: blockSize });
            blockStack.push({ x: block.x + blockSize, y: block.y + blockSize, w: blockSize, h: blockSize });
        }
    }

    for (const provinceWithoutRegion of provinces) {
        const province = Object.assign(provinceWithoutRegion, mergeRegions(provinceWithoutRegion.coverZones, width));
        if (province.mass <= minimumProvinceSize) {
            warnings.push({
                source: [{ type: 'province', color: province.color, id: -1 }],
                relatedFiles: [file],
                text: localize('worldmap.warnings.provincetoosmall',
                    'The province has only {0} pixels around (x={1},y={2}). Should have at least {3}.',
                    province.mass, province.centerOfMass.x, province.centerOfMass.y, minimumProvinceSize),
            });
        }
        if (province.boundingBox.w > width / 2 || province.boundingBox.h > height / 2) {
            warnings.push({
                source: [{ type: 'province', color: province.color, id: -1 }],
                relatedFiles: [file],
                text: localize('worldmap.warnings.provincetoolarge', 'The province is too large: {0}x{1}.', province.boundingBox.w, province.boundingBox.h),
            });
        }
    }

    return provinces as (T & ProvinceZoneDef)[];
}

type EdgeDef = { edges: ProvinceEdgeGraph[] };
function fillEdges<T extends ColorContainer>(
    provincesWithoutEdges: (T & Partial<EdgeDef>)[],
    colorToProvinceWithoutEdges: Record<number, T & Partial<EdgeDef>>,
    colorByPosition: Uint32Array,
    width: number,
    height: number,
    file: string,
    warnings: WorldMapWarning[],
): (T & EdgeDef)[] {
    const accessedPixels = new Uint8Array(colorByPosition.length);

    for (const province of provincesWithoutEdges) {
        province.edges = [];
    }

    const provinces = provincesWithoutEdges as (T & EdgeDef)[];
    const colorToProvince = colorToProvinceWithoutEdges as Record<number, T & EdgeDef>;

    for (let y = 0, yi = 0; y < height; y++, yi += width) {
        for (let x = 0, xi = yi; x < width; x++, xi++) {
            if (accessedPixels[xi]) {
                continue;
            }

            accessedPixels[xi] = 1;
            fillEdgesOfProvince(xi, colorToProvince, colorByPosition, accessedPixels, width, height, file, warnings);
        }
    }

    return provinces as (T & EdgeDef)[];
}

function fillEdgesOfProvince<T extends EdgeDef>(
    index: number,
    colorToProvince: Record<number, T>,
    colorByPosition: Uint32Array,
    accessedPixels: Uint8Array,
    width: number,
    height: number,
    file: string,
    warnings: WorldMapWarning[],
): void {
    const color = colorByPosition[index];
    const { edgePixels, pixelCount } = findEdgePixels(index, accessedPixels, color, colorByPosition, width, height);
    if (pixelCount === 1) {
        warnings.push({
            source: [{ type: 'province', id: -1, color }],
            relatedFiles: [file],
            text: localize('worldmap.warnings.onepixelprovince', 'One-pixel province color found at {0}, {1}.', index % width, Math.floor(index / width)),
        });
    }
    const edgePixelsByAdjecentProvince: Record<number, [Point, Point][]> = {};
    edgePixels.forEach(([p, line]) => {
        let lines = edgePixelsByAdjecentProvince[p];
        if (lines === undefined) {
            edgePixelsByAdjecentProvince[p] = lines = [];
        }
        lines.push(line);
    });

    const province = colorToProvince[color]!;
    for (const [key, value] of Object.entries(edgePixelsByAdjecentProvince)) {
        const numKey = parseInt(key);
        const edgeSetIndex = province.edges.findIndex(e => e.toColor === numKey);
        const edgeSet: ProvinceEdgeGraph = edgeSetIndex !== -1 ? province.edges[edgeSetIndex] : { toColor: numKey, path: [] };
        const concatedEdges = concatEdges(value);
        edgeSet.path.push(...concatedEdges);
        if (edgeSetIndex === -1) {
            province.edges.push(edgeSet);
        }
    }
}

const indicesToOffset: [number, number][][] = [
    [[0, 1], [0, 0]],
    [[0, 0], [1, 0]],
    [[1, 0], [1, 1]],
    [[1, 1], [0, 1]],
];
function findEdgePixels(index: number, accessedPixels: Uint8Array, color: number, colorByPosition: Uint32Array, width: number, height: number) {
    const edgePixels: [number, [Point, Point]][] = [];
    const pixelStack: number[] = [ index ];
    const indices: number[] = new Array(4);
    let pixelCount = 0;

    while (pixelStack.length > 0) {
        const pixelIndex = pixelStack.pop()!;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        pixelCount++;

        indices[0] = x === 0 ? pixelIndex + width - 1 : pixelIndex - 1;
        indices[1] = pixelIndex - width;
        indices[2] = x === width - 1 ? pixelIndex - width + 1 : pixelIndex + 1;
        indices[3] = y === height - 1 ? -1 : pixelIndex + width;

        for (let i = 0; i < 4; i++) {
            const adjecentIndex = indices[i];
            if (adjecentIndex < 0) {
                edgePixels.push([-1, indicesToOffset[i].map(([xOff, yOff]) => ({ x: x + xOff, y: y + yOff })) as [Point, Point]]);
            } else {
                const adjecentColor = colorByPosition[adjecentIndex];
                if (color !== adjecentColor) {
                    edgePixels.push([adjecentColor, indicesToOffset[i].map(([xOff, yOff]) => ({ x: x + xOff, y: y + yOff })) as [Point, Point]]);
                } else if (!accessedPixels[adjecentIndex]) {
                    accessedPixels[adjecentIndex] = 1;
                    pixelStack.push(adjecentIndex);
                }
            }
        }
    }

    return { edgePixels, pixelCount };
}

export function concatEdgesForTest(edges: [Point, Point][]): Point[][] {
    const result: Point[][] = [];
    const accessedEdges = new Array<boolean>(edges.length).fill(false);
    const edgesByStart = buildEdgesByEndpoint(edges, 0);
    const edgesByEnd = buildEdgesByEndpoint(edges, 1);
    for (let i = 0; i < edges.length; i++) {
        if (accessedEdges[i]) {
            continue;
        }

        const initialEdge = edges[i];
        const prependedPoints: Point[] = [];
        const appendedPoints: Point[] = [initialEdge[0], initialEdge[1]];
        let head = initialEdge[0];
        let tail = initialEdge[1];
        accessedEdges[i] = true;

        let foundNew = true;
        while (foundNew) {
            foundNew = false;
            const headTail = findUnaccessedEdge(edgesByEnd, head, accessedEdges);
            if (headTail !== -1) {
                accessedEdges[headTail] = foundNew = true;
                head = edges[headTail][0];
                prependedPoints.push(head);
            }

            const tailHead = findUnaccessedEdge(edgesByStart, tail, accessedEdges);
            if (tailHead !== -1) {
                accessedEdges[tailHead] = foundNew = true;
                tail = edges[tailHead][1];
                appendedPoints.push(tail);
            }
        }

        prependedPoints.reverse();
        const edge = prependedPoints.concat(appendedPoints);

        const newEdge: Point[] = [];
        let lastPoint: Point = edge[0];
        for (const point of edge) {
            if (newEdge.length < 2) {
                newEdge.push(point);
            } else {
                if (point.x === lastPoint.x || point.y === lastPoint.y) {
                    newEdge[newEdge.length - 1] = point;
                } else {
                    lastPoint = newEdge[newEdge.length - 1];
                    newEdge.push(point);
                }
            }
        }

        result.push(newEdge);
    }

    return result;
}

const concatEdges = concatEdgesForTest;

function buildEdgesByEndpoint(edges: [Point, Point][], endpointIndex: 0 | 1): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    edges.forEach((edge, index) => {
        const key = pointKey(edge[endpointIndex]);
        (result[key] ??= []).push(index);
    });
    return result;
}

function findUnaccessedEdge(edgesByEndpoint: Record<string, number[]>, point: Point, accessedEdges: boolean[]): number {
    const candidates = edgesByEndpoint[pointKey(point)];
    if (!candidates) {
        return -1;
    }

    return candidates.find(index => !accessedEdges[index]) ?? -1;
}

function pointKey(point: Point): string {
    return `${point.x},${point.y}`;
}

function validateProvince(colorByPosition: Uint32Array, width: number, height: number, file: string, warnings: WorldMapWarning[]) {
    for (let y = 1, index = width; y < height; y++) {
        for (let x = 0; x < width; x++, index++) {
            const nextXIndex = index + (x === width - 1 ? -width : 0) + 1;
            const bottomLeft = colorByPosition[index];
            const bottomRight = colorByPosition[nextXIndex];
            const topLeft = colorByPosition[index - width];
            const topRight = colorByPosition[nextXIndex - width];
            if (bottomLeft !== bottomRight && bottomLeft !== topLeft && bottomLeft !== topRight &&
                bottomRight !== topLeft && bottomRight !== topRight && topLeft !== topRight) {
                warnings.push({
                    source: [bottomLeft, bottomRight, topLeft, topRight].map(color => ({ color, id: -1, type: 'province' })),
                    relatedFiles: [file],
                    text: localize('worldmap.warnings.xcrossing', 'Map invalid X crossing at: ({0}, {1}).', x, y - 1),
                });
            }
        }
    }
}
