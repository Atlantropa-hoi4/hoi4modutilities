import * as assert from 'assert';
import Module = require('module');

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

const { findRiversInBufferForTest } = require('../../src/previewdef/worldmap/loader/river') as typeof import('../../src/previewdef/worldmap/loader/river');

describe('world map river bitmap traversal', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('finds actual endpoints in a branching river', () => {
        const { rivers, processedPixels } = findRiversInBufferForTest(createRiverBmp([
            [255, 255, 0, 255, 255],
            [255, 255, 3, 255, 255],
            [255, 3, 3, 3, 255],
        ]));

        assert.strictEqual(rivers.length, 1);
        assert.strictEqual(processedPixels, 5);
        assert.deepStrictEqual(rivers[0].boundingBox, { x: 1, y: 0, w: 3, h: 3 });
        assert.deepStrictEqual([...rivers[0].ends].sort((left, right) => left - right), [1, 6, 8]);
        assert.strictEqual(rivers[0].colors[1], 0);
    });

    it('does not invent endpoints in a loop', () => {
        const { rivers, processedPixels } = findRiversInBufferForTest(createRiverBmp([
            [3, 3, 3],
            [3, 255, 3],
            [3, 3, 3],
        ]));

        assert.strictEqual(rivers.length, 1);
        assert.strictEqual(processedPixels, 8);
        assert.deepStrictEqual(rivers[0].ends, []);
        assert.strictEqual(Object.keys(rivers[0].colors).length, 8);
    });

    it('preserves palette values and the complete shared source buffer', () => {
        const bmp = createRiverBmp([
            [0, 3],
            [4, 5],
        ]);
        const shared = Buffer.alloc(bmp.length + 32, 0xA5);
        bmp.copy(shared, 13);
        const source = shared.subarray(13, 13 + bmp.length);
        const before = Buffer.from(shared);

        const { rivers, processedPixels } = findRiversInBufferForTest(source);

        assert.deepStrictEqual(shared, before);
        assert.strictEqual(processedPixels, 4);
        assert.deepStrictEqual(rivers[0].colors, { 0: 0, 1: 3, 2: 4, 3: 5 });

        assert.throws(
            () => findRiversInBufferForTest(source.subarray(0, source.length - 1)),
            /BMP pixel data is truncated/,
        );
    });

    it('processes every pixel in a dense component exactly once', () => {
        const size = 32;
        const rows = Array.from({ length: size }, () => new Array<number>(size).fill(3));

        const { rivers, processedPixels } = findRiversInBufferForTest(createRiverBmp(rows));

        assert.strictEqual(rivers.length, 1);
        assert.strictEqual(processedPixels, size * size);
        assert.strictEqual(Object.keys(rivers[0].colors).length, size * size);
        assert.deepStrictEqual(rivers[0].ends, []);
    });
});

function createRiverBmp(rows: number[][]): Buffer {
    assert.ok(rows.length > 0);
    const width = rows[0].length;
    assert.ok(width > 0);
    assert.ok(rows.every(row => row.length === width));

    const height = rows.length;
    const bytesPerRow = (width + 3) & ~3;
    const dataOffset = 14 + 40 + 256 * 4;
    const imageSize = bytesPerRow * height;
    const result = Buffer.alloc(dataOffset + imageSize);

    result.write('BM', 0, 'ascii');
    result.writeUInt32LE(result.length, 2);
    result.writeUInt32LE(dataOffset, 10);
    result.writeUInt32LE(40, 14);
    result.writeUInt32LE(width, 18);
    result.writeUInt32LE(height, 22);
    result.writeUInt16LE(1, 26);
    result.writeUInt16LE(8, 28);
    result.writeUInt32LE(imageSize, 34);
    result.writeUInt32LE(256, 46);
    result.fill(255, dataOffset);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            result[dataOffset + (height - 1 - y) * bytesPerRow + x] = rows[y][x];
        }
    }

    return result;
}
