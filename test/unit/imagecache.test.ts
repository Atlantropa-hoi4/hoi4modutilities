import * as assert from 'assert';
import Module = require('module');
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { ddsToPngBufferAsync } from '../../src/util/image/converter';
import { DDPF_RGBA, DDS_MAGIC, HEADER_LENGTH_INT } from '../../src/util/image/dds/typedef';
import { registerRustCompute } from '../../src/util/compute/service';
import { getPerfSnapshot } from '../../src/util/perf';

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
            getFileContentSourceGeneration: () => 0,
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

interface FreshnessState {
    version: number;
    generation: number;
    now: number;
    reads: string[];
    hoiChecks: string[];
    imageChecks: string[];
    onRead?: (file: string) => Promise<void> | void;
    onHoiToken?: (file: string) => Promise<void> | void;
    onImageToken?: () => Promise<void> | void;
}

async function withFreshnessCache(run: (api: typeof import('../../src/util/image/imagecache'), state: FreshnessState) => Promise<void>): Promise<void> {
    const cached = { ...require.cache };
    const previousLoad = nodeModule._load;
    const previousNow = Date.now;
    const imageCachePath = require.resolve('../../src/util/image/imagecache');
    const state: FreshnessState = { version: 1, generation: 0, now: 1_000, reads: [], hoiChecks: [], imageChecks: [] };
    Date.now = () => state.now;
    delete require.cache[imageCachePath];
    nodeModule._load = function(request, parent, isMain) {
        if (parent?.filename === imageCachePath) {
            if (request === 'vscode') { return {}; }
            if (request === '../fileloader') {
                return {
                    getFileContentSourceGeneration: () => state.generation,
                    hoiFileExpiryToken: async (file: string) => {
                        state.hoiChecks.push(file);
                        await state.onHoiToken?.(file);
                        return `${file}@document:1:${state.version}`;
                    },
                    expiryToken: async (uri: { path: string }) => {
                        state.imageChecks.push(uri.path);
                        await state.onImageToken?.();
                        return `${uri.path}:${state.version}`;
                    },
                    readFileFromModOrHOI4: async (file: string) => {
                        state.reads.push(file);
                        const version = state.version;
                        let buffer: Buffer;
                        if (file.endsWith('.gfx')) {
                            buffer = Buffer.from(`spriteTypes = { ${['GFX_test', 'GFX_other', 'GFX_third'].map(name =>
                                `spriteType = { name = "${name}" texturefile = "gfx/texture-${version}.png" noOfFrames = ${version} }`
                            ).join(' ')} }`);
                        } else {
                            const png = new PNG({ width: 1, height: 1 });
                            png.data = Buffer.from([version, 20, 30, 255]);
                            buffer = PNG.sync.write(png);
                        }
                        await state.onRead?.(file);
                        return [buffer, { path: file }];
                    },
                };
            }
            if (request === '../gfxindex') { return { getGfxContainerFile: async () => undefined }; }
            if (request === '../i18n') { return { localize: (_key: string, message: string) => message }; }
            if (request === '../debug') { return { error: () => undefined }; }
        }
        return previousLoad.call(this, request, parent, isMain);
    };
    try {
        const api = require('../../src/util/image/imagecache') as typeof import('../../src/util/image/imagecache');
        nodeModule._load = previousLoad;
        await run(api, state);
    } finally {
        nodeModule._load = previousLoad;
        Date.now = previousNow;
        for (const key of Object.keys(require.cache)) {
            if (!(key in cached)) { delete require.cache[key]; }
        }
        Object.assign(require.cache, cached);
    }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

describe('image cache opened-source freshness', () => {
    it('does not label an old cold GFX map with the version edited during its read', async () => {
        await withFreshnessCache(async (api, state) => {
            const read = deferred<void>();
            const release = deferred<void>();
            state.onHoiToken = () => state.reads.length > 0 ? release.promise : undefined;
            state.onRead = file => {
                if (file.endsWith('.gfx') && state.reads.length === 1) {
                    read.resolve();
                    return release.promise;
                }
            };
            const pending = api.getSpriteTextureFilesByGfxFile('interface/test.gfx');
            await read.promise;
            assert.deepStrictEqual(state.hoiChecks, ['interface/test.gfx'], 'probe must finish before the read starts');
            state.version = 2;
            state.generation++;
            release.resolve();
            assert.strictEqual((await pending).GFX_test, 'gfx/texture-1.png');
            state.now += 201;
            assert.strictEqual((await api.getSpriteTextureFilesByGfxFile('interface/test.gfx')).GFX_test, 'gfx/texture-2.png');
            assert.strictEqual(state.reads.length, 2);
        });
    });

    it('captures image expiry before decoding and refreshes after a controlled version change', async () => {
        await withFreshnessCache(async (api, state) => {
            const read = deferred<void>();
            const release = deferred<void>();
            state.onHoiToken = () => state.reads.length > 0 ? release.promise : undefined;
            state.onRead = () => {
                if (state.reads.length === 1) { read.resolve(); return release.promise; }
            };
            const pending = api.getImageByPath('gfx/opened.png');
            await read.promise;
            assert.deepStrictEqual(state.hoiChecks, ['gfx/opened.png']);
            state.version = 2;
            state.generation++;
            release.resolve();
            const old = await pending;
            assert.ok(old);
            assert.strictEqual(PNG.sync.read(old.pngBuffer).data[0], 1);
            state.now += 201;
            const current = await api.getImageByPath('gfx/opened.png');
            assert.ok(current);
            assert.strictEqual(PNG.sync.read(current.pngBuffer).data[0], 2);
            assert.strictEqual(state.reads.length, 2);
        });
    });

    it('coalesces sprite retries when an old GFX read races a newer result-dependent token', async () => {
        await withFreshnessCache(async (api, state) => {
            const read = deferred<void>();
            const releaseRead = deferred<void>();
            const releaseToken = deferred<void>();
            state.onHoiToken = file => {
                if (file.endsWith('.gfx') && state.hoiChecks.length === 1) { return releaseToken.promise; }
            };
            state.onRead = file => {
                if (file.endsWith('.gfx') && state.reads.length === 1) { read.resolve(); return releaseRead.promise; }
            };
            const requests = Array.from({ length: 32 }, () => api.getSpriteByGfxNameFromResolvedFiles('GFX_test', ['interface/test.gfx']));
            await read.promise;
            state.version = 2;
            state.generation++;
            releaseRead.resolve();
            releaseToken.resolve();
            const sprites = await Promise.all(requests);
            assert.ok(sprites[0]);
            assert.strictEqual(sprites[0].noOfFrames, 2);
            sprites.forEach(sprite => assert.strictEqual(sprite, sprites[0]));
            assert.deepStrictEqual(state.reads, ['interface/test.gfx', 'gfx/texture-1.png', 'interface/test.gfx', 'gfx/texture-2.png']);
            state.now += 201;
            assert.strictEqual(await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx'), sprites[0]);
        });
    });

    it('guards edits during texture dependency expiry discovery after the sprite resolves', async () => {
        await withFreshnessCache(async (api, state) => {
            const token = deferred<void>();
            const release = deferred<void>();
            state.onImageToken = () => {
                if (state.imageChecks.length === 1) { token.resolve(); return release.promise; }
            };
            const pending = api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            await token.promise;
            state.version = 2;
            state.generation++;
            release.resolve();
            const sprite = await pending;
            assert.ok(sprite);
            assert.strictEqual(sprite.noOfFrames, 2);
            assert.strictEqual(sprite.image.path.path, 'gfx/texture-2.png');
        });
    });

    it('rechecks a warm GFX map after an edit before caching a new sprite inside the non-expiring window', async () => {
        await withFreshnessCache(async (api, state) => {
            await api.getSpriteTextureFilesByGfxFile('interface/test.gfx');
            state.version = 2;
            state.generation++;
            const sprite = await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            assert.ok(sprite);
            assert.strictEqual(sprite.noOfFrames, 2);
            assert.strictEqual(sprite.image.path.path, 'gfx/texture-2.png');
        });
    });

    it('revalidates a warm map whose initial load is still pending across the generation change', async () => {
        await withFreshnessCache(async (api, state) => {
            const read = deferred<void>();
            const release = deferred<void>();
            const token = deferred<void>();
            state.onRead = file => {
                if (file.endsWith('.gfx') && state.reads.length === 1) { read.resolve(); return release.promise; }
            };
            const map = api.getSpriteTextureFilesByGfxFile('interface/test.gfx');
            await read.promise;
            state.version = 2;
            state.generation++;
            state.onHoiToken = file => { if (file.endsWith('.gfx')) { token.resolve(); } };
            const pending = api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            await token.promise;
            release.resolve();
            await map;
            const sprite = await pending;
            assert.ok(sprite);
            assert.strictEqual(sprite.noOfFrames, 2);
        });
    });

    it('bounds retries during continuous edits and leaves the last raced sprite uncached', async () => {
        await withFreshnessCache(async (api, state) => {
            state.onRead = file => {
                if (file.endsWith('.png')) { state.version++; state.generation++; }
            };
            const raced = await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            assert.ok(raced);
            assert.strictEqual(raced.noOfFrames, 2);
            assert.strictEqual(state.version, 3, 'only one retry is allowed');
            state.onRead = undefined;
            const current = await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            assert.ok(current);
            assert.strictEqual(current.noOfFrames, 3, 'the raced result must not survive the fast cache window');
        });
    });

    it('preserves cached sprites after a close/reopen generation change and avoids per-sprite extra probes', async () => {
        await withFreshnessCache(async (api, state) => {
            const first = await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx');
            assert.ok(first);
            assert.strictEqual(state.hoiChecks.filter(file => file.endsWith('.gfx')).length, 2);
            const initialChecks = state.hoiChecks.length;
            state.generation++;
            const reopened = await Promise.all(Array.from({ length: 32 }, () => api.getSpriteByGfxName('GFX_test', 'interface/test.gfx')));
            reopened.forEach(sprite => assert.strictEqual(sprite, first));
            assert.strictEqual(state.hoiChecks.length, initialChecks);
            state.now += 201;
            assert.strictEqual(await api.getSpriteByGfxName('GFX_test', 'interface/test.gfx'), first);
            const before = state.hoiChecks.filter(file => file.endsWith('.gfx')).length;
            assert.ok(await api.getSpriteByGfxName('GFX_other', 'interface/test.gfx'));
            assert.strictEqual(state.hoiChecks.filter(file => file.endsWith('.gfx')).length - before, 2, 'one sprite probe and one map revalidation');
            assert.ok(await api.getSpriteByGfxName('GFX_third', 'interface/test.gfx'));
            assert.strictEqual(state.hoiChecks.filter(file => file.endsWith('.gfx')).length - before, 3, 'the next sprite needs only its existing dependency probe');
            assert.strictEqual(state.reads.filter(file => file.endsWith('.gfx')).length, 1);
        });
    });
});

function tinyDds(): Buffer {
    const buffer = new ArrayBuffer(HEADER_LENGTH_INT * 4 + 4);
    const header = new Int32Array(buffer, 0, HEADER_LENGTH_INT);
    header[0] = DDS_MAGIC;
    header[3] = 1;
    header[4] = 1;
    header[20] = DDPF_RGBA;
    header[22] = 32;
    header[23] = 0x000000ff;
    header[24] = 0x0000ff00;
    header[25] = 0x00ff0000;
    header[26] = 0xff000000;
    new Uint8Array(buffer, HEADER_LENGTH_INT * 4).set([10, 20, 30, 40]);
    return Buffer.from(buffer);
}

async function withDecodeCache(run: (api: typeof import('../../src/util/image/imagecache'), flags: boolean[]) => Promise<void>): Promise<void> {
    const cached = { ...require.cache };
    const previousLoad = nodeModule._load;
    const imageCachePath = require.resolve('../../src/util/image/imagecache');
    const flags: boolean[] = [];
    const buffer = tinyDds();
    delete require.cache[imageCachePath];
    nodeModule._load = function(request, parent, isMain) {
        if (parent?.filename === imageCachePath) {
            if (request === 'vscode') { return {}; }
            if (request === '../fileloader') {
                return {
                    expiryToken: async () => 'image-token', hoiFileExpiryToken: async () => 'image-token',
                    getFileContentSourceGeneration: () => 0,
                    readFileFromModOrHOI4: async (file: string) => [file.endsWith('broken.dds') ? Buffer.alloc(0) : buffer, { path: file }],
                };
            }
            if (request === './converter') {
                return { ddsToPngBufferAsync: (dds: Parameters<typeof ddsToPngBufferAsync>[0], signal?: AbortSignal, offloadSmallImage = false) => {
                    flags.push(offloadSmallImage);
                    return ddsToPngBufferAsync(dds, signal, offloadSmallImage);
                } };
            }
            if (request === '../gfxindex') { return { getGfxContainerFile: async () => undefined }; }
            if (request === '../i18n') { return { localize: (_key: string, message: string) => message }; }
            if (request === '../debug') { return { error: () => undefined }; }
        }
        return previousLoad.call(this, request, parent, isMain);
    };
    try {
        const api = require('../../src/util/image/imagecache') as typeof import('../../src/util/image/imagecache');
        nodeModule._load = previousLoad;
        await run(api, flags);
    } finally {
        nodeModule._load = previousLoad;
        for (const key of Object.keys(require.cache)) {
            if (!(key in cached)) { delete require.cache[key]; }
        }
        Object.assign(require.cache, cached);
    }
}

describe('image cache bulk DDS offloading', function() {
    this.timeout(20_000);

    it('keeps single and coalesced tiny requests inline, offloads bulk work, and returns to the single-image policy', async () => {
        const previousBackend = process.env.HOI4MU_COMPUTE_BACKEND;
        delete process.env.HOI4MU_COMPUTE_BACKEND;
        const registration = registerRustCompute(path.resolve(__dirname, '../../..'));
        try {
            await withDecodeCache(async (api, flags) => {
                const png = new PNG({ width: 1, height: 1 });
                png.data = Buffer.from([10, 20, 30, 40]);
                const expected = PNG.sync.write(png);
                const single = await api.getImageByPath('gfx/single.dds');
                assert.ok(single);
                assert.deepStrictEqual(single.pngBuffer, expected);
                assert.deepStrictEqual(flags, [false]);

                flags.length = 0;
                const coalesced = await Promise.all(Array.from({ length: 6 }, () => api.getImageByPath('gfx/shared.dds')));
                assert.ok(coalesced[0]);
                coalesced.forEach(image => assert.strictEqual(image, coalesced[0]));
                assert.deepStrictEqual(flags, [false], 'cache hits must not count as six independent decode requests');

                flags.length = 0;
                const workerCount = () => getPerfSnapshot({ limit: 200 }).entries
                    .filter(entry => entry.label === 'rustcompute.compute' && entry.tags.kind === 'dds' && entry.tags.engine === 'rust-wasm').length;
                const before = workerCount();
                const bulk = await Promise.all(Array.from({ length: 6 }, (_, index) => api.getImageByPath(`gfx/bulk-${index}.dds`)));
                assert.strictEqual(flags.length, 6);
                assert.ok(flags.some(flag => flag), 'bulk hydration must request tiny DDS offloading');
                assert.ok(workerCount() > before, 'bulk policy must reach the registered Rust worker');
                for (const image of bulk) {
                    assert.ok(image);
                    assert.deepStrictEqual(image.pngBuffer, expected);
                    assert.strictEqual(image.width, 1);
                    assert.strictEqual(image.height, 1);
                }

                flags.length = 0;
                const failed = await Promise.all(Array.from({ length: 6 }, (_, index) => api.getImageByPath(`gfx/failure-${index}/broken.dds`)));
                assert.deepStrictEqual(failed, new Array(6).fill(undefined));
                const afterBulk = await api.getImageByPath('gfx/after-bulk.dds');
                assert.ok(afterBulk);
                assert.deepStrictEqual(afterBulk.pngBuffer, expected);
                assert.deepStrictEqual(flags, [false], 'completed or failed requests must not leave the bulk counter elevated');
            });
        } finally {
            registration.dispose();
            if (previousBackend === undefined) { delete process.env.HOI4MU_COMPUTE_BACKEND; }
            else { process.env.HOI4MU_COMPUTE_BACKEND = previousBackend; }
        }
    });
});
