import { uniq } from 'lodash';

export interface FocusIconGfxResolver {
    resolveIndexedFile(gfxName: string): Promise<string | undefined>;
    listInterfaceGfxFiles(): Promise<string[]>;
    readSpriteNames(gfxFile: string): Promise<string[]>;
    readSpriteTextureFiles?(gfxFile: string): Promise<Record<string, string | undefined>>;
}

export interface FocusIconGfxAssets {
    gfxFiles: string[];
    gfxFileByIconName: Record<string, string>;
    textureFiles: string[];
    unresolvedIconNames: string[];
}

export async function resolveFocusIconGfxFiles(
    iconNames: (string | undefined)[],
    resolver: FocusIconGfxResolver,
): Promise<string[]> {
    return (await resolveFocusIconGfxAssets(iconNames, resolver)).gfxFiles;
}

export async function resolveFocusIconGfxAssets(
    iconNames: (string | undefined)[],
    resolver: FocusIconGfxResolver,
): Promise<FocusIconGfxAssets> {
    const uniqueIconNames = uniq(iconNames.filter((iconName): iconName is string => !!iconName));
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
        return {
            gfxFiles: Array.from(resolvedFiles),
            gfxFileByIconName,
            textureFiles: await resolveTextureFiles(resolvedIconNamesByFile, resolver),
            unresolvedIconNames: [],
        };
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

    return {
        gfxFiles: Array.from(resolvedFiles),
        gfxFileByIconName,
        textureFiles: await resolveTextureFiles(resolvedIconNamesByFile, resolver),
        unresolvedIconNames: Array.from(unresolvedNames),
    };
}

async function resolveTextureFiles(
    resolvedIconNamesByFile: Map<string, Set<string>>,
    resolver: FocusIconGfxResolver,
): Promise<string[]> {
    if (!resolver.readSpriteTextureFiles) {
        return [];
    }

    const textureFiles = new Set<string>();
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
                textureFiles.add(textureFile.replace(/\\+/g, '/'));
            }
        }
    }));

    return Array.from(textureFiles);
}
