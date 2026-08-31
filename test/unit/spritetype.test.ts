import * as assert from 'assert';
import Module = require('module');
import { PNG } from 'pngjs';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { getSpriteTypes, ProgressBarType } from '../../src/hoiformat/spritetype';

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

    it('falls back to the first cornered-tile frame at the upper boundary', () => {
        const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
        const originalLoad = nodeModule._load;
        nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
            if (request === 'vscode') {
                return {};
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const { CorneredTileSprite, Image } = require('../../src/util/image/sprite') as typeof import('../../src/util/image/sprite');
        nodeModule._load = originalLoad;

        const png = new PNG({ width: 4, height: 2 });
        png.data.fill(255);
        const image = new Image(PNG.sync.write(png), 4, 2, {} as any);
        const sprite = new CorneredTileSprite('GFX_corner', image, 2, { x: 2, y: 2 }, { x: 0, y: 0 });

        assert.doesNotThrow(() => sprite.getTiles(2));
        assert.strictEqual(sprite.getTiles(2), sprite.getTiles(0));
    });
});
