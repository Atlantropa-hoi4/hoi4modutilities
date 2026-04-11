import { uniq } from 'lodash';

export interface FocusIconGfxResolver {
    resolveIndexedFile(gfxName: string): Promise<string | undefined>;
    listInterfaceGfxFiles(): Promise<string[]>;
    readSpriteNames(gfxFile: string): Promise<string[]>;
}

export async function resolveFocusIconGfxFiles(
    iconNames: (string | undefined)[],
    resolver: FocusIconGfxResolver,
): Promise<string[]> {
    const uniqueIconNames = uniq(iconNames.filter((iconName): iconName is string => !!iconName));
    const resolvedFiles = new Set<string>();
    const unresolvedNames = new Set<string>();

    for (const iconName of uniqueIconNames) {
        const indexedFile = await resolver.resolveIndexedFile(iconName);
        if (indexedFile) {
            resolvedFiles.add(indexedFile);
        } else {
            unresolvedNames.add(iconName);
        }
    }

    if (unresolvedNames.size === 0) {
        return Array.from(resolvedFiles);
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
                matched = true;
            }
        }

        if (matched) {
            resolvedFiles.add(gfxFile);
        }
    }

    return Array.from(resolvedFiles);
}
