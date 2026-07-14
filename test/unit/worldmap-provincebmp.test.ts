import * as assert from 'assert';
import Module = require('module');
import type { Point, ProvinceMap } from '../../src/previewdef/worldmap/definitions';
import type { BMP } from '../../src/util/image/bmp/bmpparser';
import { LoaderSession } from '../../src/util/loader/loadersession';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class EventEmitter<T> {
            public event = (_listener: (value: T) => unknown) => ({ dispose: () => undefined });
            public fire(_value: T): void { }
        }

        return {
            EventEmitter,
            l10n: { t: (_key: string, fallback: string) => fallback },
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({}),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    concatEdgesForTest,
    getProvinceColorsByPositionForTest,
    parseProvinceBmpBuffer,
} = require('../../src/previewdef/worldmap/loader/provincebmp') as typeof import('../../src/previewdef/worldmap/loader/provincebmp');
const {
    Loader,
    mergeInLoadResult,
} = require('../../src/util/loader/loader') as typeof import('../../src/util/loader/loader');
const {
    DefaultMapLoader,
} = require('../../src/previewdef/worldmap/loader/provincemap') as typeof import('../../src/previewdef/worldmap/loader/provincemap');

function point(x: number, y: number): Point {
    return { x, y };
}

describe('world map province bmp edge helpers', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('concatenates adjacent edge segments without scanning the whole list repeatedly', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(1, 0), point(2, 0)],
        ]);

        assert.deepStrictEqual(result, [[point(0, 0), point(2, 0)]]);
    });

    it('concatenates a large reverse chain without quadratic front insertion', () => {
        const edgeCount = 20_000;
        const edges: [Point, Point][] = Array.from(
            { length: edgeCount },
            (_, index) => [point(index + 1, 0), point(index, 0)],
        );

        const result = concatEdgesForTest(edges);

        assert.deepStrictEqual(result, [[point(edgeCount, 0), point(0, 0)]]);
    });

    it('grows both ends without mutating source segments and preserves turns', () => {
        const edges: [Point, Point][] = [
            [point(1, 0), point(2, 0)],
            [point(1, 1), point(1, 0)],
            [point(2, 0), point(2, 1)],
        ];
        const originalEdges = structuredClone(edges);

        const result = concatEdgesForTest(edges);

        assert.deepStrictEqual(result, [[
            point(1, 1),
            point(1, 0),
            point(2, 0),
            point(2, 1),
        ]]);
        assert.deepStrictEqual(edges, originalEdges);
    });

    it('stores province colors in a typed array', () => {
        const width = 256;
        const height = 256;
        const colorByPosition = getProvinceColorsByPositionForTest({
            width,
            height,
            bytesPerRow: width * 3,
            data: new Uint8Array(width * height * 3),
        } as BMP);

        assert.ok(colorByPosition instanceof Uint32Array);
        assert.strictEqual(colorByPosition.length, width * height);
    });

    it('parses a BMP view from its backing buffer without copying it', () => {
        const prefixLength = 13;
        const bmpLength = 58;
        const backing = Buffer.alloc(prefixLength + bmpLength + 7);
        const bmp = backing.subarray(prefixLength, prefixLength + bmpLength);
        bmp[0] = 0x42;
        bmp[1] = 0x4D;
        bmp.writeUInt32LE(54, 10);
        bmp.writeUInt32LE(40, 14);
        bmp.writeUInt32LE(1, 18);
        bmp.writeUInt32LE(1, 22);
        bmp.writeUInt16LE(1, 26);
        bmp.writeUInt16LE(24, 28);
        bmp.set([3, 2, 1, 0], 54);

        const parsed = parseProvinceBmpBuffer(bmp);

        assert.strictEqual(parsed.width, 1);
        assert.strictEqual(parsed.height, 1);
        assert.strictEqual(parsed.bitsPerPixel, 24);
        assert.strictEqual(parsed.data.buffer, backing.buffer);
        assert.strictEqual(parsed.data.byteOffset, bmp.byteOffset + 54);
        assert.deepStrictEqual([...parsed.data], [3, 2, 1, 0]);

        assert.throws(
            () => parseProvinceBmpBuffer(bmp.subarray(0, bmp.length - 1)),
            /BMP pixel data is truncated/,
        );
    });

    it('keeps disconnected edge segments as separate paths', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(5, 0), point(6, 0)],
        ]);

        assert.deepStrictEqual(result, [
            [point(0, 0), point(1, 0)],
            [point(5, 0), point(6, 0)],
        ]);
    });

    it('preserves loop-like paths while compacting straight runs', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(1, 0), point(1, 1)],
            [point(1, 1), point(0, 1)],
            [point(0, 1), point(0, 0)],
        ]);

        assert.strictEqual(result.length, 1);
        assert.deepStrictEqual(result[0][0], result[0][result[0].length - 1]);
        assert.deepStrictEqual(
            new Set(result[0].map(p => `${p.x},${p.y}`)),
            new Set(['0,0', '1,0', '1,1', '0,1']),
        );
    });

    describe('shared loader performance helpers', () => {
        it('releases the cached province color raster after assembling the world map', () => {
            const provinceMap = {
                colorByPosition: new Uint32Array(4),
            } as ProvinceMap;

            DefaultMapLoader.prototype.releaseTransientCache.call({} as any, provinceMap);

            assert.strictEqual('colorByPosition' in provinceMap, false);
        });

        it('caches a negative reload decision for the whole session', async () => {
            class StableLoader extends Loader<number> {
                public reloadChecks = 0;
                public loads = 0;

                protected override async shouldReloadImpl(_session: LoaderSession): Promise<boolean> {
                    this.reloadChecks++;
                    return false;
                }

                protected override async loadImpl(_session: LoaderSession) {
                    this.loads++;
                    return { result: this.loads, dependencies: [] };
                }
            }

            const loader = Object.assign(Object.create(StableLoader.prototype), {
                reloadChecks: 0,
                loads: 0,
                disableTelemetry: true,
                onLoadDoneEmitter: { fire: () => undefined },
            }) as StableLoader;
            await loader.load(new LoaderSession(false));
            const session = new LoaderSession(false);

            await loader.load(session);
            await loader.load(session);

            assert.strictEqual(loader.reloadChecks, 1);
            assert.strictEqual(loader.loads, 1);
        });

        it('merges many load-result arrays while preserving sparse entries', () => {
            const loadResults = Array.from({ length: 20_000 }, (_, value) => ({ values: [value] }));
            const sparse = new Array<number>(2);
            sparse[1] = 20_000;
            loadResults.push({ values: sparse });

            const merged = mergeInLoadResult(loadResults, 'values');

            assert.strictEqual(merged.length, 20_002);
            assert.strictEqual(merged[0], 0);
            assert.strictEqual(merged[19_999], 19_999);
            assert.strictEqual(20_000 in merged, false);
            assert.strictEqual(merged[20_001], 20_000);
        });
    });
});
