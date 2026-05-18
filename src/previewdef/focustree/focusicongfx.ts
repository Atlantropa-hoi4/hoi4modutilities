import { uniq } from 'lodash';

export interface FocusIconGfxResolver {
    resolveIndexedFile(gfxName: string): Promise<string | undefined>;
    listInterfaceGfxFiles(): Promise<string[]>;
    readSpriteNames(gfxFile: string): Promise<string[]>;
    readSpriteTextureFiles?(gfxFile: string): Promise<Record<string, string | undefined>>;
    readTextureExpiryToken?(textureFile: string): Promise<string>;
    priorityGfxFiles?: readonly string[];
    fallbackScanLimit?: number;
    throwIfCancelled?(): void;
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
    const unresolvedNames = new Set<string>(uniqueIconNames);
    const resolvedIconNamesByFile = new Map<string, Set<string>>();
    const gfxFileByIconName: Record<string, string> = {};
    const scannedGfxFiles = new Set<string>();

    const addResolvedIcon = (gfxFile: string, iconName: string) => {
        resolvedFiles.add(gfxFile);
        gfxFileByIconName[iconName] = gfxFile;
        const iconNamesForFile = resolvedIconNamesByFile.get(gfxFile) ?? new Set<string>();
        iconNamesForFile.add(iconName);
        resolvedIconNamesByFile.set(gfxFile, iconNamesForFile);
    };

    const scanGfxFile = async (gfxFile: string): Promise<void> => {
        resolver.throwIfCancelled?.();
        if (unresolvedNames.size === 0) {
            return;
        }

        const normalizedGfxFile = normalizeGfxFileKey(gfxFile);
        if (scannedGfxFiles.has(normalizedGfxFile)) {
            return;
        }

        scannedGfxFiles.add(normalizedGfxFile);
        let spriteNames: Set<string>;
        try {
            spriteNames = new Set(await resolver.readSpriteNames(gfxFile));
            resolver.throwIfCancelled?.();
        } catch {
            return;
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
    };

    for (const gfxFile of resolver.priorityGfxFiles ?? []) {
        await scanGfxFile(gfxFile);
    }

    for (const iconName of Array.from(unresolvedNames)) {
        resolver.throwIfCancelled?.();
        const indexedFile = await resolver.resolveIndexedFile(iconName);
        resolver.throwIfCancelled?.();
        if (indexedFile) {
            unresolvedNames.delete(iconName);
            addResolvedIcon(indexedFile, iconName);
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

    const fallbackGfxFiles = prioritizeFallbackGfxFiles(
        await resolver.listInterfaceGfxFiles(),
        resolver.priorityGfxFiles ?? [],
        resolver.fallbackScanLimit,
    );
    for (const gfxFile of fallbackGfxFiles) {
        if (unresolvedNames.size === 0) {
            break;
        }

        await scanGfxFile(gfxFile);
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

function prioritizeFallbackGfxFiles(
    gfxFiles: readonly string[],
    priorityGfxFiles: readonly string[],
    fallbackScanLimit: number | undefined,
): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const add = (gfxFile: string) => {
        const key = normalizeGfxFileKey(gfxFile);
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        result.push(gfxFile);
    };

    priorityGfxFiles.forEach(add);
    let fallbackScanCount = 0;
    for (const gfxFile of gfxFiles) {
        if (fallbackScanLimit !== undefined && fallbackScanCount >= fallbackScanLimit) {
            break;
        }

        const before = result.length;
        add(gfxFile);
        if (result.length > before) {
            fallbackScanCount += 1;
        }
    }

    return result;
}

function normalizeGfxFileKey(gfxFile: string): string {
    return gfxFile.replace(/\\+/g, '/').toLowerCase();
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
    const textureExpiryTokenByFile = new Map<string, Promise<string>>();
    await Promise.all(Array.from(resolvedIconNamesByFile.entries()).map(async ([gfxFile, iconNames]) => {
        resolver.throwIfCancelled?.();
        let textureFilesByName: Record<string, string | undefined>;
        try {
            textureFilesByName = await resolver.readSpriteTextureFiles!(gfxFile);
            resolver.throwIfCancelled?.();
        } catch {
            return;
        }

        for (const iconName of iconNames) {
            resolver.throwIfCancelled?.();
            const textureFile = textureFilesByName[iconName];
            if (textureFile) {
                const normalizedTextureFile = textureFile.replace(/\\+/g, '/');
                textureFiles.add(normalizedTextureFile);
                textureFileByIconName[iconName] = normalizedTextureFile;
                if (resolver.readTextureExpiryToken) {
                    try {
                        let tokenPromise = textureExpiryTokenByFile.get(normalizedTextureFile);
                        if (!tokenPromise) {
                            tokenPromise = resolver.readTextureExpiryToken(normalizedTextureFile);
                            textureExpiryTokenByFile.set(normalizedTextureFile, tokenPromise);
                        }
                        textureExpiryTokenByIconName[iconName] = await tokenPromise;
                        resolver.throwIfCancelled?.();
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
