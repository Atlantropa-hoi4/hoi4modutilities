import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {};
    }

    if (request === '../fileloader') {
        return {
            expiryToken: async () => 'image-token',
            hoiFileExpiryToken: async () => 'gfx-token',
            readFileFromModOrHOI4: async () => {
                throw new Error('not used');
            },
        };
    }

    if (request === '../gfxindex') {
        return {
            getGfxContainerFile: async () => undefined,
        };
    }

    if (request === '../i18n') {
        return {
            localize: (_key: string, message: string) => message,
        };
    }

    if (request === '../debug') {
        return {
            error: () => undefined,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/image/imagecache')];
const {
    spriteCacheExpiryToken,
} = require('../../src/util/image/imagecache') as typeof import('../../src/util/image/imagecache');
nodeModule._load = originalLoad;

describe('image cache', () => {
    it('includes the resolved image expiry token in a cached sprite token', async () => {
        const sprite = {
            image: {
                path: {},
            },
        } as any;

        assert.strictEqual(await spriteCacheExpiryToken('interface/test.gfx?sprite', Promise.resolve(sprite)), 'gfx-token:image-token');
    });

    it('includes both progress bar textures in the cache expiry token', async () => {
        const spriteModule = require('../../src/util/image/sprite') as typeof import('../../src/util/image/sprite');
        const sprite = new spriteModule.ProgressBarSprite(
            'GFX_progress',
            { path: {} } as any,
            { path: {} } as any,
            { x: 100, y: 20 },
            true,
        );

        assert.strictEqual(
            await spriteCacheExpiryToken('interface/test.gfx?sprite', Promise.resolve(sprite)),
            'gfx-token:image-token:image-token',
        );
    });
});
