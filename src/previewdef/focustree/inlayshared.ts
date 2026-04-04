import { ContainerWindowType } from "../../hoiformat/gui";
import { HOIPartial } from "../../hoiformat/schema";

export interface InlayGuiLookupWindow {
    file: string;
    window: HOIPartial<ContainerWindowType>;
}

export interface InlayGuiLookupTarget {
    id: string;
    file: string;
    windowName?: string;
    token?: { start: number; end: number };
    guiFile?: string;
    guiWindow?: HOIPartial<ContainerWindowType>;
}

export interface InlayGuiLookupWarning {
    code: string;
    severity: 'warning';
    kind: 'parse';
    text: string;
    source: string;
    navigations?: { file: string, start: number, end: number }[];
}

export interface InlayGfxResolver {
    resolveIndexedFile(gfxName: string): Promise<string | undefined>;
    listInterfaceGfxFiles(): Promise<string[]>;
    readSpriteNames(gfxFile: string): Promise<string[]>;
}

export function resolveInlayGuiWindowLookup<T extends InlayGuiLookupTarget>(
    inlays: T[],
    windowsByName: Record<string, InlayGuiLookupWindow>,
): { guiFiles: string[], warnings: InlayGuiLookupWarning[] } {
    const warnings: InlayGuiLookupWarning[] = [];
    const resolvedGuiFiles = new Set<string>();

    for (const inlay of inlays) {
        if (!inlay.windowName) {
            continue;
        }

        const matched = windowsByName[inlay.windowName];
        if (!matched) {
            warnings.push({
                code: 'inlay-gui-window-missing',
                severity: 'warning',
                kind: 'parse',
                text: `Can't resolve scripted GUI window ${inlay.windowName} for inlay ${inlay.id}.`,
                source: inlay.id,
                navigations: inlay.token ? [{ file: inlay.file, start: inlay.token.start, end: inlay.token.end }] : undefined,
            });
            continue;
        }

        inlay.guiFile = matched.file;
        inlay.guiWindow = matched.window;
        resolvedGuiFiles.add(matched.file);
    }

    return { guiFiles: Array.from(resolvedGuiFiles), warnings };
}

export async function resolveInlayGfxNames(
    gfxNames: (string | undefined)[],
    resolver: InlayGfxResolver,
): Promise<Record<string, string>> {
    const uniqueNames = Array.from(new Set(gfxNames.filter((gfxName): gfxName is string => !!gfxName)));
    const resolvedByName: Record<string, string> = {};
    const unresolvedNames = new Set<string>();

    for (const gfxName of uniqueNames) {
        const indexedFile = await resolver.resolveIndexedFile(gfxName);
        if (indexedFile) {
            resolvedByName[gfxName] = indexedFile;
        } else {
            unresolvedNames.add(gfxName);
        }
    }

    if (unresolvedNames.size === 0) {
        return resolvedByName;
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

        for (const unresolvedName of Array.from(unresolvedNames)) {
            if (!spriteNames.has(unresolvedName)) {
                continue;
            }

            resolvedByName[unresolvedName] = gfxFile;
            unresolvedNames.delete(unresolvedName);
        }
    }

    return resolvedByName;
}
