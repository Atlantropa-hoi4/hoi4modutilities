import * as vscode from 'vscode';
import { PNG } from 'pngjs';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { getSpriteTypes } from '../../hoiformat/spritetype';
import { readFileFromModOrHOI4, hoiFileExpiryToken, expiryToken, getFileContentSourceGeneration } from '../fileloader';
import { PromiseCache } from '../cache';
import { ddsToPngBufferAsync, tgaToPng } from './converter';
import { AnySpriteType } from '../../hoiformat/spritetype';
import { Sprite, Image, CorneredTileSprite, ProgressBarSprite } from './sprite';
import { localize } from '../i18n';
import { error } from '../debug';
import { DDS } from './dds';
import { UserError } from '../common';
import { getGfxContainerFile } from '../gfxindex';
import { createConcurrencyLimiter, toArrayBuffer } from '../common';
import { incrementPerfCounter, measureAsync } from '../perf';
export { Sprite, Image };

const runImageDecode = createConcurrencyLimiter(3);
let activeImageRequests = 0;

class SpriteCache extends PromiseCache<Sprite | undefined> {
    public async get(key: string = ''): Promise<Sprite | undefined> {
        // Include result-dependent expiry discovery in the guard, but bound retries during edits.
        for (let attempt = 0; ; attempt++) {
            const generation = getFileContentSourceGeneration();
            const sprite = await super.get(key);
            const entry = this._cache.get(key);
            const ownsEntry = entry !== undefined && (await entry.value) === sprite;
            if (ownsEntry) {
                await entry.expiryToken;
            }
            if (generation === getFileContentSourceGeneration()) {
                return sprite;
            }
            if (!entry || (ownsEntry && this._cache.get(key) === entry)) {
                this.remove(key);
                gfxMapCache.remove(key.split('?')[0]);
            }
            if (attempt === 1) {
                return sprite;
            }
        }
    }
}

class GfxMapCache extends PromiseCache<Record<string, AnySpriteType>> {
    private sourceGeneration = getFileContentSourceGeneration();

    public async get(key: string = ''): Promise<Record<string, AnySpriteType>> {
        const generation = getFileContentSourceGeneration();
        if (this.sourceGeneration !== generation) {
            this.sourceGeneration = generation;
            // Recheck tokens only when a map is requested; unchanged maps and cached sprites survive.
            for (const entry of this._cache.values()) {
                entry.lastAccess = Number.NEGATIVE_INFINITY;
            }
        }
        const entry = this._cache.get(key);
        if (entry?.lastAccess === Number.NEGATIVE_INFINITY) {
            // Let an interrupted initial probe/load finish before validating its captured token.
            await entry.value;
            if (this._cache.get(key) === entry) {
                entry.lastAccess = Number.NEGATIVE_INFINITY;
            }
        }
        return super.get(key);
    }
}

const imageCache = new PromiseCache({
    name: 'image',
    expireWhenChange: hoiFileExpiryToken,
    initialExpiryToken: hoiFileExpiryToken,
    factory: getImage,
    life: 10 * 60 * 1000,
    maxBytes: 128 * 1024 * 1024,
    weigher: image => image ? image.pngBuffer.length : 0,
});

const spriteCache = new SpriteCache({
    name: 'sprite',
    expireWhenChange: spriteCacheExpiryToken,
    factory: getSpriteByKey,
    life: 10 * 60 * 1000,
    maxSize: 128,
});

const gfxMapCache = new GfxMapCache({
    name: 'gfxMap',
    expireWhenChange: hoiFileExpiryToken,
    initialExpiryToken: hoiFileExpiryToken,
    factory: loadGfxMap,
    life: 10 * 60 * 1000,
    maxSize: 64,
});

export function getImageByPath(relativePath: string): Promise<Image | undefined> {
    return imageCache.get(relativePath);
}

export async function getSpriteByGfxName(name: string, gfxFilePath: string | string[]): Promise<Sprite | undefined> {
    return measureAsync('image.sprite.lookup', { mode: 'indexed-or-scan', name }, async () => {
        const pathFromIndex = await getGfxContainerFile(name);
        if (pathFromIndex) {
            incrementPerfCounter('image.sprite.indexHit');
            return await spriteCache.get(pathFromIndex + '?' + name);
        } else if (Array.isArray(gfxFilePath)) {
            incrementPerfCounter('image.sprite.resolvedScan', { fileCount: gfxFilePath.length });
            for (const path of gfxFilePath) {
                const result = await spriteCache.get(path + '?' + name);
                if (result !== undefined) {
                    return result;
                }
            }
        } else {
            incrementPerfCounter('image.sprite.singleFile');
            return await spriteCache.get(gfxFilePath + '?' + name);
        }

        return undefined;
    });
}

export async function getSpriteByGfxNameFromResolvedFiles(name: string, gfxFilePaths: readonly string[]): Promise<Sprite | undefined> {
    return measureAsync('image.sprite.lookup', { mode: 'resolved-files', fileCount: gfxFilePaths.length }, async () => {
        for (const gfxFilePath of gfxFilePaths) {
            const result = await spriteCache.get(gfxFilePath + '?' + name);
            if (result !== undefined) {
                return result;
            }
        }

        return undefined;
    });
}

export async function getSpriteTextureFilesByGfxFile(gfxFilePath: string): Promise<Record<string, string | undefined>> {
    const gfxMap = await gfxMapCache.get(gfxFilePath);
    const result: Record<string, string> = {};
    for (const [name, sprite] of Object.entries(gfxMap)) {
        result[name] = sprite.texturefile;
    }
    return result;
}

export async function spriteCacheExpiryToken(key: string, spritePromise: Promise<Sprite | undefined>): Promise<string> {
    const [gfxFilePath] = key.split('?');
    const gfxToken = await hoiFileExpiryToken(gfxFilePath);
    const sprite = await spritePromise;
    if (sprite) {
        if (sprite instanceof ProgressBarSprite) {
            return `${gfxToken}:${await expiryToken(sprite.image.path)}:${await expiryToken(sprite.backgroundImage.path)}`;
        }
        return `${gfxToken}:${await expiryToken(sprite.image.path)}`;
    }
    return gfxToken;
}

function getSpriteByKey(key: string): Promise<Sprite | undefined> {
    const [gfxFilePath, name] = key.split('?');
    return getSpriteByGfxNameImpl(name, gfxFilePath);
}

async function getSpriteByGfxNameImpl(name: string, gfxFilePath: string): Promise<Sprite | undefined> {
    const gfxMap = await gfxMapCache.get(gfxFilePath);
    const sprite = gfxMap[name];

    if (sprite === undefined) {
        return undefined;
    }

    const image = await imageCache.get(sprite.texturefile);
    if (image === undefined) {
        return undefined;
    }

    if ('texturefile2' in sprite) {
        const backgroundImage = await imageCache.get(sprite.texturefile2);
        if (backgroundImage === undefined) {
            return undefined;
        }
        return new ProgressBarSprite(name, image, backgroundImage, sprite.size, sprite.horizontal);
    }

    if ('bordersize' in sprite) {
        return new CorneredTileSprite(name, image, sprite.noofframes, sprite.size, sprite.bordersize);
    }

    return new Sprite(name, image, sprite.noofframes);
}

function getImage(relativePath: string): Promise<Image | undefined> {
    activeImageRequests++;
    return decodeImage(relativePath).finally(() => { activeImageRequests--; });
}

async function decodeImage(relativePath: string): Promise<Image | undefined> {
    return runImageDecode(() => measureAsync('image.decode', { extension: getExtension(relativePath) }, async () => {
        let readFileResult: [Buffer, vscode.Uri] | undefined = undefined;
        try {
            readFileResult = await readFileFromModOrHOI4(relativePath);
        } catch(e) {
            if (!(e instanceof UserError)) {
                error("Failed to get image " + relativePath);
            }
            error(e);

            if (relativePath.length <= 4 || relativePath.endsWith('.dds')) {
                return undefined;
            }

            // in case .png or .tga not exist but .dds exist
            relativePath = relativePath.substr(0, relativePath.length - 4) + '.dds';
        }

        try {
            const [buffer, realPath] = readFileResult ?? await readFileFromModOrHOI4(relativePath);
            let png: PNG;
            let pngBuffer: Buffer;

            relativePath = relativePath.toLowerCase();
            if (relativePath.endsWith('.dds')) {
                const dds = DDS.parse(toArrayBuffer(buffer), 0);
                // Bulk hydration benefits from off-thread PNG work even for tiny raw DDS icons.
                // Single-image requests retain the low-latency inline path.
                const image = await ddsToPngBufferAsync(dds, undefined, activeImageRequests >= 6);
                return new Image(image.pngBuffer, image.width, image.height, realPath);

            } else if (relativePath.endsWith('.tga')) {
                png = tgaToPng(buffer);
                pngBuffer = PNG.sync.write(png);

            } else if (relativePath.endsWith('.png')) {
                pngBuffer = buffer;
                png = PNG.sync.read(buffer);

            } else {
                throw new UserError('Unsupported image type: ' + relativePath);
            }

            return new Image(pngBuffer, png.width, png.height, realPath);

        } catch (e) {
            if (!(e instanceof UserError)) {
                error("Failed to get image " + relativePath);
            }
            error(e);
            return undefined;
        }
    }));
}

async function loadGfxMap(path: string): Promise<Record<string, AnySpriteType>> {
    const gfxMap: Record<string, AnySpriteType> = {};
    await measureAsync('image.gfxMap.load', { path }, async () => {
        try {
            const [buffer, realPath] = await readFileFromModOrHOI4(path);
            const gfx = buffer.toString('utf-8');
            const node = parseHoi4File(gfx, localize('infile', 'In file {0}:\n', realPath));
            const spriteTypes = getSpriteTypes(node);

            spriteTypes.forEach(st => gfxMap[st.name] = st);

        } catch (e) {
            error(e);
        }
    });

    return gfxMap;
}

function getExtension(path: string): string {
    const dotIndex = path.lastIndexOf('.');
    return dotIndex >= 0 ? path.slice(dotIndex + 1).toLowerCase() : '';
}
