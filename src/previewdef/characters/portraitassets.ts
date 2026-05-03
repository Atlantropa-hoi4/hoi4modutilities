import { uniq } from 'lodash';
import { getGfxContainerFile } from '../../util/gfxindex';
import { getFilePathFromModOrHOI4, listFilesFromModOrHOI4 } from '../../util/fileloader';
import {
    getImageByPath,
    getSpriteByGfxNameFromResolvedFiles,
    getSpriteTextureFilesByGfxFile,
    Image,
} from '../../util/image/imagecache';

export interface CharacterPortraitAsset {
    image: Image | undefined;
    dependencies: string[];
}

export type CharacterPortraitAssetResolver = (spriteName: string) => Promise<CharacterPortraitAsset>;

const fallbackPortraitGfxFiles = [
    'interface/portraits.gfx',
    'interface/portraits/portraits.gfx',
    'interface/ideas.gfx',
];

const directPortraitImagePattern = /\.(?:dds|tga|png)$/i;

export function createDefaultCharacterPortraitAssetResolver(): CharacterPortraitAssetResolver {
    return async spriteName => {
        const directImagePath = normalizeCharacterPortraitImagePath(spriteName);
        if (directImagePath) {
            return {
                image: await getImageByPath(directImagePath),
                dependencies: [directImagePath],
            };
        }

        const dependencies = new Set<string>();
        const indexedGfxFile = await getGfxContainerFile(spriteName);
        const gfxFiles = indexedGfxFile
            ? [indexedGfxFile]
            : await getFallbackPortraitGfxFiles();

        for (const gfxFile of gfxFiles) {
            dependencies.add(gfxFile);
            const textureFile = await getSpriteTextureFile(gfxFile, spriteName);
            if (textureFile) {
                dependencies.add(textureFile);
            }
        }

        const sprite = await getSpriteByGfxNameFromResolvedFiles(spriteName, gfxFiles);
        return {
            image: sprite?.frames[0] ?? sprite?.image,
            dependencies: [...dependencies],
        };
    };
}

export function normalizeCharacterPortraitImagePath(value: string): string | undefined {
    const normalized = value.replace(/\\+/g, '/').replace(/^\/+/, '');
    return directPortraitImagePattern.test(normalized) ? normalized : undefined;
}

async function getFallbackPortraitGfxFiles(): Promise<string[]> {
    let portraitFolderFiles: string[] = [];
    try {
        portraitFolderFiles = await listFilesFromModOrHOI4('interface/portraits', { recursively: true });
    } catch {
        portraitFolderFiles = [];
    }

    const candidateFiles = uniq([
        ...fallbackPortraitGfxFiles,
        ...portraitFolderFiles
            .filter(file => file.toLowerCase().endsWith('.gfx'))
            .map(file => `interface/portraits/${file.replace(/\\+/g, '/')}`),
    ]);

    const existingFiles: string[] = [];
    for (const candidateFile of candidateFiles) {
        if (await getFilePathFromModOrHOI4(candidateFile)) {
            existingFiles.push(candidateFile);
        }
    }

    return existingFiles;
}

async function getSpriteTextureFile(gfxFile: string, spriteName: string): Promise<string | undefined> {
    try {
        const textureFilesBySprite = await getSpriteTextureFilesByGfxFile(gfxFile);
        return textureFilesBySprite[spriteName]?.replace(/\\+/g, '/');
    } catch {
        return undefined;
    }
}
