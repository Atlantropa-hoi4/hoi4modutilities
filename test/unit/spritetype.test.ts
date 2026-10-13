import * as assert from 'assert';
import Module = require('module');
import { PNG } from 'pngjs';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { getSpriteTypes, ProgressBarType } from '../../src/hoiformat/spritetype';
import type * as SpriteModule from '../../src/util/image/sprite';
import type { Uri } from 'vscode';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    return request === 'vscode' ? {} : originalLoad.call(this, request, parent, isMain);
};
const { CorneredTileSprite, Image, Sprite } = require('../../src/util/image/sprite') as typeof SpriteModule;
nodeModule._load = originalLoad;
// These image fixtures retain URI identity but never resolve a filesystem path.
const imageUri = { path: '/fixture/strip.png' } as unknown as Uri;

describe('sprite types', () => {
    it('parses horizontal and inferred vertical progress bar sprites', () => {
        const sprites = getSpriteTypes(parseHoi4File(`
            spriteTypes = {
                progressBarType = {
                    name = "GFX_horizontal_progress"
                    textureFile1 = "gfx/interface/progress.dds"
                    textureFile2 = "gfx/interface/progress_bg.dds"
                    size = { x = 120 y = 16 }
                    horizontal = yes
                }
                progressBarType = {
                    name = "GFX_vertical_progress"
                    textureFile1 = "gfx/interface/progress_vertical.dds"
                    textureFile2 = "gfx/interface/progress_vertical_bg.dds"
                    size = { x = 12 y = 80 }
                }
            }
        `));

        assert.strictEqual(sprites.length, 2);
        assert.deepStrictEqual(sprites.map(sprite => {
            const progress = sprite as ProgressBarType;
            return [progress.name, progress.texturefile, progress.texturefile2, progress.size, progress.horizontal];
        }), [
            ['GFX_horizontal_progress', 'gfx/interface/progress.dds', 'gfx/interface/progress_bg.dds', { x: 120, y: 16 }, true],
            ['GFX_vertical_progress', 'gfx/interface/progress_vertical.dds', 'gfx/interface/progress_vertical_bg.dds', { x: 12, y: 80 }, false],
        ]);
    });

    it('encodes only requested frames and preserves distinct pixels and cached results', async () => {
        const png = new PNG({ width: 64, height: 2 });
        for (let y = 0; y < png.height; y++) {
            for (let x = 0; x < png.width; x++) {
                const offset = (y * png.width + x) * 4;
                png.data.set([Math.floor(x / 2), 100, 200, 255], offset);
            }
        }
        const image = new Image(PNG.sync.write(png), 64, 2, imageUri);
        const sprite = new Sprite('GFX_strip', image, 32);
        const originalWrite = PNG.sync.write;
        let encodedFrames = 0;
        PNG.sync.write = (...args) => {
            encodedFrames++;
            return originalWrite(...args);
        };
        try {
            const first = sprite.getFrame(0)!;
            assert.strictEqual(encodedFrames, 1);
            assert.deepStrictEqual(Array.from(PNG.sync.read(first.pngBuffer).data.subarray(0, 4)), [0, 100, 200, 255]);
            assert.strictEqual(sprite.getFrame(0), first);
            assert.strictEqual(sprite.getFrame(32), undefined);
            assert.strictEqual(sprite.getFrame(-1), undefined);
            assert.strictEqual(sprite.getFrame(1.5), undefined);
            assert.strictEqual(encodedFrames, 1);

            await Promise.resolve();
            const last = sprite.getFrame(31)!;
            assert.strictEqual(encodedFrames, 2);
            assert.deepStrictEqual(Array.from(PNG.sync.read(last.pngBuffer).data.subarray(0, 4)), [31, 100, 200, 255]);
            assert.strictEqual(sprite.getFrame(0), first);
            assert.strictEqual(new Sprite('GFX_single', image, 1).getFrame(0), image);
            assert.strictEqual(encodedFrames, 2);
        } finally {
            PNG.sync.write = originalWrite;
        }
    });

    it('uses the first cornered-tile frame outside the valid range without changing tile pixels', () => {
        const png = new PNG({ width: 4, height: 2 });
        for (let offset = 0; offset < png.data.length; offset += 4) {
            const x = (offset / 4) % png.width;
            png.data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], offset);
        }
        const sprite = new CorneredTileSprite('GFX_corner', new Image(PNG.sync.write(png), 4, 2, imageUri),
            2, { x: 2, y: 2 }, { x: 0, y: 0 });
        assert.deepStrictEqual(Array.from(PNG.sync.read(sprite.getTiles(1)[4].pngBuffer).data.subarray(0, 4)), [0, 0, 255, 255]);
        const firstTiles = sprite.getTiles(0);
        assert.deepStrictEqual(Array.from(PNG.sync.read(firstTiles[4].pngBuffer).data.subarray(0, 4)), [255, 0, 0, 255]);
        assert.strictEqual(sprite.getTiles(2), firstTiles);
        assert.strictEqual(sprite.getTiles(-1), firstTiles);
    });
});
