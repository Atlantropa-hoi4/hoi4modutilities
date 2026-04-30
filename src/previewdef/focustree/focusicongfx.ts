import { uniq } from 'lodash';

export interface FocusIconGfxResolver {
    resolveIndexedFile(gfxName: string): Promise<string | undefined>;
    listInterfaceGfxFiles(): Promise<string[]>;
    readSpriteNames(gfxFile: string): Promise<string[]>;
    readSpriteTextureFiles?(gfxFile: string): Promise<Record<string, string | undefined>>;
    readTextureExpiryToken?(textureFile: string): Promise<string>;
}

export interface FocusIconAssetResolution {
    gfxFiles: string[];
    gfxFileByIconName: Record<string, string>;
    textureFiles: string[];
    textureFileByIconName: Record<string, string>;
    textureExpiryTokenByIconName: Record<string, string>;
    unresolvedIconNames: string[];
    styleSignature: string;
}

export type FocusIconGfxAssets = FocusIconAssetResolution;

export async function resolveFocusIconGfxFiles(
    iconNames: (string | undefined)[],
    resolver: FocusIconGfxResolver,
): Promise<string[]> {
    return (await resolveFocusIconGfxAssets(iconNames, resolver)).gfxFiles;
}

export function createEmptyFocusIconAssetResolution(): FocusIconAssetResolution {
    return createFocusIconAssetResolution({
        gfxFiles: [],
        gfxFileByIconName: {},
        textureFiles: [],
        textureFileByIconName: {},
        textureExpiryTokenByIconName: {},
        unresolvedIconNames: [],
    });
}

export async function resolveFocusIconGfxAssets(
    iconNames: (string | undefined)[],
    resolver: FocusIconGfxResolver,
): Promise<FocusIconAssetResolution> {
    const uniqueIconNames = uniq(iconNames.filter(isResolvableFocusIconName));
    const resolvedFiles = new Set<string>();
    const unresolvedNames = new Set<string>();
    const resolvedIconNamesByFile = new Map<string, Set<string>>();
    const gfxFileByIconName: Record<string, string> = {};

    const addResolvedIcon = (gfxFile: string, iconName: string) => {
        resolvedFiles.add(gfxFile);
        gfxFileByIconName[iconName] = gfxFile;
        const iconNamesForFile = resolvedIconNamesByFile.get(gfxFile) ?? new Set<string>();
        iconNamesForFile.add(iconName);
        resolvedIconNamesByFile.set(gfxFile, iconNamesForFile);
    };

    for (const iconName of uniqueIconNames) {
        const indexedFile = await resolver.resolveIndexedFile(iconName);
        if (indexedFile) {
            addResolvedIcon(indexedFile, iconName);
        } else {
            unresolvedNames.add(iconName);
        }
    }

    if (unresolvedNames.size === 0) {
        const textureResolution = await resolveTextureFiles(resolvedIconNamesByFile, resolver);
        return createFocusIconAssetResolution({
            gfxFiles: Array.from(resolvedFiles),
            gfxFileByIconName,
            textureFiles: textureResolution.textureFiles,
            textureFileByIconName: textureResolution.textureFileByIconName,
            textureExpiryTokenByIconName: textureResolution.textureExpiryTokenByIconName,
            unresolvedIconNames: [],
        });
    }

    const interfaceGfxFiles = await resolver.listInterfaceGfxFiles();
    for (const gfxFile of interfaceGfxFiles) {
        if (unresolvedNames.size === 0) {
            break;
        }

        let spriteNames: Set<string>;
        try {
            spriteNames = new Set(await resolver.readSpriteNames(gfxFile));
        } catch {
            continue;
        }
        let matched = false;
        for (const unresolvedName of Array.from(unresolvedNames)) {
            if (spriteNames.has(unresolvedName)) {
                unresolvedNames.delete(unresolvedName);
                addResolvedIcon(gfxFile, unresolvedName);
                matched = true;
            }
        }

        if (matched) {
            resolvedFiles.add(gfxFile);
        }
    }

    const textureResolution = await resolveTextureFiles(resolvedIconNamesByFile, resolver);
    return createFocusIconAssetResolution({
        gfxFiles: Array.from(resolvedFiles),
        gfxFileByIconName,
        textureFiles: textureResolution.textureFiles,
        textureFileByIconName: textureResolution.textureFileByIconName,
        textureExpiryTokenByIconName: textureResolution.textureExpiryTokenByIconName,
        unresolvedIconNames: Array.from(unresolvedNames),
    });
}

function isResolvableFocusIconName(iconName: string | undefined): iconName is string {
    return !!iconName && iconName.trim().toUpperCase() !== 'GFX';
}

async function resolveTextureFiles(
    resolvedIconNamesByFile: Map<string, Set<string>>,
    resolver: FocusIconGfxResolver,
): Promise<{
    textureFiles: string[];
    textureFileByIconName: Record<string, string>;
    textureExpiryTokenByIconName: Record<string, string>;
}> {
    if (!resolver.readSpriteTextureFiles) {
        return {
            textureFiles: [],
            textureFileByIconName: {},
            textureExpiryTokenByIconName: {},
        };
    }

    const textureFiles = new Set<string>();
    const textureFileByIconName: Record<string, string> = {};
    const textureExpiryTokenByIconName: Record<string, string> = {};
    await Promise.all(Array.from(resolvedIconNamesByFile.entries()).map(async ([gfxFile, iconNames]) => {
        let textureFilesByName: Record<string, string | undefined>;
        try {
            textureFilesByName = await resolver.readSpriteTextureFiles!(gfxFile);
        } catch {
            return;
        }

        for (const iconName of iconNames) {
            const textureFile = textureFilesByName[iconName];
            if (textureFile) {
                const normalizedTextureFile = textureFile.replace(/\\+/g, '/');
                textureFiles.add(normalizedTextureFile);
                textureFileByIconName[iconName] = normalizedTextureFile;
                if (resolver.readTextureExpiryToken) {
                    try {
                        textureExpiryTokenByIconName[iconName] = await resolver.readTextureExpiryToken(normalizedTextureFile);
                    } catch {
                        textureExpiryTokenByIconName[iconName] = '';
                    }
                }
            }
        }
    }));

    return {
        textureFiles: Array.from(textureFiles),
        textureFileByIconName,
        textureExpiryTokenByIconName,
    };
}

function createFocusIconAssetResolution(
    resolution: Omit<FocusIconAssetResolution, 'styleSignature'>,
): FocusIconAssetResolution {
    return {
        ...resolution,
        styleSignature: JSON.stringify({
            gfxFileByIconName: sortedEntries(resolution.gfxFileByIconName),
            textureFileByIconName: sortedEntries(resolution.textureFileByIconName),
            textureExpiryTokenByIconName: sortedEntries(resolution.textureExpiryTokenByIconName),
            unresolvedIconNames: [...resolution.unresolvedIconNames].sort(),
        }),
    };
}

function sortedEntries(value: Record<string, string>): Array<[string, string]> {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}
