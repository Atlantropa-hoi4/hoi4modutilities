import * as vscode from 'vscode';
import { PNG } from 'pngjs';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { getSpriteTypes } from '../../hoiformat/spritetype';
import { readFileFromModOrHOI4, hoiFileExpiryToken, expiryToken } from '../fileloader';
import { PromiseCache } from '../cache';
import { ddsToPng, tgaToPng } from './converter';
import { SpriteType, CorneredTileSpriteType } from '../../hoiformat/spritetype';
import { Sprite, Image, CorneredTileSprite } from './sprite';
import { localize } from '../i18n';
import { error } from '../debug';
import { DDS } from './dds';
import { UserError } from '../common';
import { getGfxContainerFile } from '../gfxindex';
import { toArrayBuffer } from '../common';
import { incrementPerfCounter, measureAsync } from '../perf';
export { Sprite, Image };

const imageCache = new PromiseCache({
    name: 'image',
    expireWhenChange: hoiFileExpiryToken,
    factory: getImage,
    life: 10 * 60 * 1000,
    maxBytes: 128 * 1024 * 1024,
    weigher: image => image ? image.pngBuffer.length : 0,
});

const spriteCache = new PromiseCache({
    name: 'sprite',
    expireWhenChange: spriteCacheExpiryToken,
    factory: getSpriteByKey,
    life: 10 * 60 * 1000,
    maxSize: 128,
});

const gfxMapCache = new PromiseCache({
    name: 'gfxMap',
    expireWhenChange: hoiFileExpiryToken,
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

async function spriteCacheExpiryToken(key: string, spritePromise: Promise<Sprite | undefined>): Promise<string> {
    const [gfxFilePath] = key.split('?');
    const gfxToken = await hoiFileExpiryToken(gfxFilePath);
    const sprite = await spritePromise;
    if (sprite) {
        return `${gfxToken}:${expiryToken(sprite.image.path)}`;
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

    if ('bordersize' in sprite) {
        return new CorneredTileSprite(name, image, sprite.noofframes, sprite.size, sprite.bordersize);
    }

    return new Sprite(name, image, sprite.noofframes);
}

async function getImage(relativePath: string): Promise<Image | undefined> {
    return measureAsync('image.decode', { extension: getExtension(relativePath) }, async () => {
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
                png = ddsToPng(dds);
                pngBuffer = PNG.sync.write(png);

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
    });
}

async function loadGfxMap(path: string): Promise<Record<string, (SpriteType | CorneredTileSpriteType)>> {
    const gfxMap: Record<string, SpriteType> = {};
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
