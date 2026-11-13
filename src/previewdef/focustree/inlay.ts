import { ConditionComplexExpr, ConditionItem, extractConditionValue, extractConditionalExprs } from "../../hoiformat/condition";
import { posix } from "node:path";
import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { convertNodeToJson, Position, positionSchema } from "../../hoiformat/schema";
import { getSpriteTypes } from "../../hoiformat/spritetype";
import { countryScope } from "../../hoiformat/scope";
import { hoiFileExpiryToken, listFilesFromModOrHOI4, readFileFromModOrHOI4 } from "../../util/fileloader";
import { PromiseCache } from "../../util/cache";
import { tryGetGfxContainerFile } from "../../util/gfxindex";
import { localize } from "../../util/i18n";
import { loadContainerWindows } from "../../util/guiwindowindex";
import { FileLoader, LoaderSession, LoadResultOD } from "../../util/loader/loader";
import { resolveInlayGfxNames, resolveInlayGuiWindowLookup } from "./inlayshared";
import type {
    FocusInlayGfxOption,
    FocusInlayImageSlot,
    FocusTreeInlay,
    FocusTreeInlayButtonMeta,
    FocusTreeInlayRef,
    FocusWarning,
} from "./schema";

interface ParsedInlayFile {
    inlays: FocusTreeInlay[];
    warnings: FocusWarning[];
}

interface ParsedInlayFileCache extends ParsedInlayFile {
    files: string[];
}

const focusInlayWindowsFolder = "common/focus_inlay_windows";
const interfaceFolder = "interface";

// Standard-folder discovery and explicit headers share file parsing and in-flight reads.
const focusInlayFileCache = new PromiseCache<ParsedInlayFileCache>({
    factory: loadFocusInlayFile,
    expireWhenChange: file => hoiFileExpiryToken(file),
    initialExpiryToken: file => hoiFileExpiryToken(file),
    life: 10 * 60 * 1000,
    nonExpireLife: 0,
    maxSize: 512,
});

const focusInlayWindowsCache = new PromiseCache<ParsedInlayFileCache>({
    factory: buildFocusInlayWindowsCache,
    expireWhenChange: () => getFolderFilesExpiryToken(focusInlayWindowsFolder, ".txt"),
    life: 10 * 60 * 1000,
});

const interfaceGfxFilesCache = new PromiseCache<string[]>({
    factory: () => listFolderFiles(interfaceFolder, ".gfx"),
    expireWhenChange: () => getFolderFilesExpiryToken(interfaceFolder, ".gfx"),
    life: 10 * 60 * 1000,
    name: 'focusTree.interfaceGfxFiles',
});

const interfaceGfxSpriteNamesCache = new PromiseCache<string[]>({
    factory: buildInterfaceGfxSpriteNamesCache,
    expireWhenChange: key => hoiFileExpiryToken(key),
    life: 10 * 60 * 1000,
    name: 'focusTree.interfaceGfxSpriteNames',
});

function createParseWarning(params: {
    code: string;
    text: string;
    source: string;
    relatedFocusIds?: string[];
    navigations?: FocusWarning['navigations'];
    severity?: FocusWarning['severity'];
}): FocusWarning {
    return {
        code: params.code,
        severity: params.severity ?? 'warning',
        kind: 'parse',
        text: params.text,
        source: params.source,
        relatedFocusIds: params.relatedFocusIds,
        navigations: params.navigations,
    };
}

async function listFolderFiles(folder: string, extension: string): Promise<string[]> {
    try {
        const files = await listFilesFromModOrHOI4(folder, { recursively: true });
        return files
            .filter(file => file.toLowerCase().endsWith(extension))
            .map(file => `${folder}/${file}`.replace(/\/+/g, "/"));
    } catch {
        return [];
    }
}

async function getFolderFilesExpiryToken(folder: string, extension: string): Promise<string> {
    const files = await listFolderFiles(folder, extension);
    const tokens = await Promise.all(files.map(file => hoiFileExpiryToken(file)));
    return `${files.join("|")}::${tokens.join("|")}`;
}

function cloneInlayForTree(source: FocusTreeInlay, position: FocusTreeInlay["position"]): FocusTreeInlay {
    return {
        ...source,
        position,
        conditionExprs: [...source.conditionExprs],
        scriptedImages: source.scriptedImages.map(slot => ({
            ...slot,
            gfxOptions: slot.gfxOptions.map(option => ({
                ...option,
            })),
        })),
        scriptedButtons: source.scriptedButtons.map(button => ({
            ...button,
        })),
    };
}

export function normalizeFocusInlayFile(file: string): string {
    return posix.normalize(file.replace(/\\/g, '/'));
}

/** Tracks explicit inlay files through the same expiry and cancellation lifecycle as other dependencies. */
export class FocusInlayFileLoader extends FileLoader<ParsedInlayFileCache> {
    protected async loadFromFile(session: LoaderSession): Promise<LoadResultOD<ParsedInlayFileCache>> {
        session.throwIfCancelled();
        const result = await focusInlayFileCache.get(normalizeFocusInlayFile(this.file));
        session.throwIfCancelled();
        return { result, dependencies: result.files };
    }
}

export async function loadFocusInlayWindows(
    additionalFiles: readonly ParsedInlayFileCache[] = [],
    session?: LoaderSession,
): Promise<ParsedInlayFileCache> {
    session?.throwIfCancelled();
    const standard = await focusInlayWindowsCache.get();
    session?.throwIfCancelled();
    // Explicit headers are ordered overrides, as in the upstream loader's ID map.
    // Unreferenced standard-folder definitions retain their original first-match order.
    return mergeFocusInlayFiles([...additionalFiles].reverse().concat(standard));
}

function mergeFocusInlayFiles(parsedFiles: readonly ParsedInlayFileCache[]): ParsedInlayFileCache {
    const inlays: FocusTreeInlay[] = [];
    const warnings: FocusWarning[] = [];
    const files = new Set<string>();
    const warningKeys = new Set<string>();
    for (const entry of parsedFiles) {
        const newFiles = entry.files.filter(file => !files.has(file));
        if (newFiles.length === 0) { continue; }
        newFiles.forEach(file => files.add(file));
        inlays.push(...entry.inlays.filter(inlay => newFiles.includes(inlay.file)));
        for (const warning of entry.warnings) {
            const key = JSON.stringify([warning.code, warning.source, warning.text, warning.navigations]);
            if (!warningKeys.has(key)) { warningKeys.add(key); warnings.push(warning); }
        }
    }
    return { inlays, warnings, files: [...files] };
}

async function buildFocusInlayWindowsCache(): Promise<ParsedInlayFileCache> {
    const files = await listFolderFiles(focusInlayWindowsFolder, ".txt");
    return mergeFocusInlayFiles(await Promise.all(files.map(file => focusInlayFileCache.get(normalizeFocusInlayFile(file)))));
}

async function loadFocusInlayFile(file: string): Promise<ParsedInlayFileCache> {
    try {
        const [buffer, uri] = await readFileFromModOrHOI4(file);
        const node = parseHoi4File(buffer.toString(), localize("infile", "In file {0}:\n", uri.toString()));
        return { ...parseInlayNode(node, file), files: [file] };
    } catch (e) {
        return { inlays: [], files: [file], warnings: [createParseWarning({
            code: 'inlay-file-parse-failed',
            text: localize("TODO", "Failed to parse inlay window file {0}: {1}", file, e instanceof Error ? e.message : String(e)),
            source: file,
        })] };
    }
}

function parseInlayNode(node: Node, file: string): ParsedInlayFile {
    const inlays: FocusTreeInlay[] = [];
    const warnings: FocusWarning[] = [];
    const duplicateIds: Record<string, FocusTreeInlay | undefined> = {};

    if (!Array.isArray(node.value)) {
        return { inlays, warnings };
    }

    for (const child of node.value) {
        if (!child.name || !Array.isArray(child.value)) {
            continue;
        }

        const inlay = parseSingleInlayNode(child, file);
        if (duplicateIds[inlay.id]) {
            const other = duplicateIds[inlay.id]!;
            warnings.push(createParseWarning({
                code: 'inlay-duplicate-id',
                text: localize("TODO", "There're more than one inlay windows with ID {0} in files: {1}, {2}.", inlay.id, other.file, inlay.file),
                source: inlay.id,
                relatedFocusIds: [inlay.id],
                navigations: [
                    { file: other.file, start: other.token?.start ?? 0, end: other.token?.end ?? 0 },
                    { file: inlay.file, start: inlay.token?.start ?? 0, end: inlay.token?.end ?? 0 },
                ],
            }));
        } else {
            duplicateIds[inlay.id] = inlay;
        }

        inlays.push(inlay);
    }

    return { inlays, warnings };
}

function parseSingleInlayNode(node: Node, file: string): FocusTreeInlay {
    const id = node.name ?? localize("TODO", "<anonymous inlay>");
    const children = Array.isArray(node.value) ? node.value : [];
    const conditionExprs: ConditionItem[] = [];
    const scriptedImages: FocusInlayImageSlot[] = [];
    const scriptedButtons: FocusTreeInlayButtonMeta[] = [];
    let windowName: string | undefined;
    let internal = false;
    let visible: ConditionComplexExpr = true;

    for (const child of children) {
        const childName = child.name?.toLowerCase();
        if (!childName) {
            continue;
        }

        if (childName === "window_name") {
            windowName = convertNodeToJson<string>(child, "string") ?? undefined;
            continue;
        }

        if (childName === "internal") {
            internal = convertNodeToJson<boolean>(child, "boolean") ?? false;
            continue;
        }

        if (childName === "visible") {
            visible = extractConditionValue(child.value, countryScope, conditionExprs).condition;
            continue;
        }

        if (childName === "scripted_images" && Array.isArray(child.value)) {
            for (const slotNode of child.value) {
                if (!slotNode.name || !Array.isArray(slotNode.value)) {
                    continue;
                }

                const gfxOptions: FocusInlayGfxOption[] = slotNode.value
                    .filter(optionNode => !!optionNode.name)
                    .map(optionNode => ({
                        gfxName: optionNode.name ?? "",
                        condition: isAlwaysYes(optionNode) ? true : extractConditionValue(optionNode.value, countryScope, conditionExprs).condition,
                        file,
                        token: optionNode.nameToken ?? undefined,
                    }));
                scriptedImages.push({
                    id: slotNode.name,
                    file,
                    token: slotNode.nameToken ?? undefined,
                    gfxOptions,
                });
            }
            continue;
        }

        if (childName === "scripted_buttons" && Array.isArray(child.value)) {
            for (const buttonNode of child.value) {
                if (!buttonNode.name || !Array.isArray(buttonNode.value)) {
                    continue;
                }

                let available: ConditionComplexExpr | undefined;
                for (const buttonChild of buttonNode.value) {
                    if (buttonChild.name?.toLowerCase() === "available") {
                        available = extractConditionValue(buttonChild.value, countryScope, conditionExprs).condition;
                    }
                }

                scriptedButtons.push({
                    id: buttonNode.name,
                    file,
                    token: buttonNode.nameToken ?? undefined,
                    available,
                });
            }
        }
    }

    return {
        id,
        file,
        token: node.nameToken ?? undefined,
        windowName,
        internal,
        visible,
        scriptedImages,
        scriptedButtons,
        conditionExprs,
        position: { x: 0, y: 0 },
    };
}

function isAlwaysYes(node: Node): boolean {
    if (typeof node.value === "object" && node.value !== null && "name" in node.value) {
        return node.value.name.toLowerCase() === "yes";
    }
    return false;
}

export function resolveInlaysForTree(refs: FocusTreeInlayRef[], allInlays: FocusTreeInlay[]): { inlayWindows: FocusTreeInlay[], inlayConditionExprs: ConditionItem[], warnings: FocusWarning[] } {
    const warnings: FocusWarning[] = [];
    const conditionExprs: ConditionItem[] = [];
    const inlayWindows: FocusTreeInlay[] = [];

    for (const ref of refs) {
        const matched = allInlays.find(inlay => inlay.id === ref.id);
        if (!matched) {
            warnings.push(createParseWarning({
                code: 'inlay-reference-missing',
                text: localize("TODO", "Focus tree references missing inlay window: {0}.", ref.id),
                source: ref.id,
                navigations: ref.token ? [{ file: ref.file, start: ref.token.start, end: ref.token.end }] : undefined,
            }));
            continue;
        }

        const resolved = cloneInlayForTree(matched, ref.position);
        resolved.referenceFile = ref.file;
        resolved.referenceToken = ref.token;
        extractConditionalExprs(resolved.visible, conditionExprs);
        resolved.scriptedImages.forEach(slot => slot.gfxOptions.forEach(option => extractConditionalExprs(option.condition, conditionExprs)));
        resolved.scriptedButtons.forEach(button => button.available && extractConditionalExprs(button.available, conditionExprs));
        inlayWindows.push(resolved);
    }

    return { inlayWindows, inlayConditionExprs: conditionExprs, warnings };
}

export async function resolveInlayGuiWindows(inlays: FocusTreeInlay[], session = new LoaderSession(false)): Promise<{
    guiFiles: string[], gfxFiles: string[], dependencies: string[], warnings: FocusWarning[],
}> {
    const warnings: FocusWarning[] = [];
    if (inlays.length === 0 || !inlays.some(inlay => !!inlay.windowName)) {
        return { guiFiles: [], gfxFiles: [], dependencies: [], warnings };
    }

    const loaded = await loadContainerWindows(inlays.flatMap(inlay => inlay.windowName ? [inlay.windowName] : []), session);
    const resolved = resolveInlayGuiWindowLookup(inlays, loaded.windows);
    return { ...resolved, guiFiles: loaded.guiFiles, gfxFiles: loaded.gfxFiles, dependencies: loaded.dependencies };
}

export async function resolveInlayGfxFiles(inlays: FocusTreeInlay[]): Promise<{ resolvedFiles: string[] }> {
    if (inlays.length === 0) {
        return { resolvedFiles: [] };
    }

    const optionsByName = new Map<string, FocusInlayGfxOption[]>();
    for (const inlay of inlays) {
        for (const slot of inlay.scriptedImages) {
            for (const option of slot.gfxOptions) {
                if (!option.gfxName) {
                    continue;
                }

                const options = optionsByName.get(option.gfxName) ?? [];
                options.push(option);
                optionsByName.set(option.gfxName, options);
            }
        }
    }

    if (optionsByName.size === 0) {
        return { resolvedFiles: [] };
    }

    const resolvedByName = await resolveInlayGfxNames(
        Array.from(optionsByName.keys()),
        {
            resolveIndexedFile: async gfxName => tryGetGfxContainerFile(gfxName),
            listInterfaceGfxFiles: getCachedInterfaceGfxFiles,
            readSpriteNames: getCachedInterfaceGfxSpriteNames,
        },
    );
    const resolvedFiles = new Set<string>();
    for (const [gfxName, options] of optionsByName.entries()) {
        const resolved = resolvedByName[gfxName];
        if (!resolved) {
            continue;
        }

        resolvedFiles.add(resolved);
        for (const option of options) {
            option.gfxFile = resolved;
        }
    }

    return { resolvedFiles: Array.from(resolvedFiles) };
}
async function buildInterfaceGfxSpriteNamesCache(gfxFile: string): Promise<string[]> {
    try {
        const [buffer, uri] = await readFileFromModOrHOI4(gfxFile);
        const spriteTypes = getSpriteTypes(parseHoi4File(
            buffer.toString().replace(/^\uFEFF/, ""),
            localize("infile", "In file {0}:\n", uri.toString()),
        ));
        return spriteTypes.map(spriteType => spriteType.name);
    } catch {
        return [];
    }
}

export async function getCachedInterfaceGfxFiles(): Promise<string[]> {
    return await interfaceGfxFilesCache.get();
}

export async function getCachedInterfaceGfxSpriteNames(gfxFile: string): Promise<string[]> {
    return await interfaceGfxSpriteNamesCache.get(gfxFile);
}

export function addInlayGfxWarnings(inlays: FocusTreeInlay[], warnings: FocusWarning[]) {
    for (const inlay of inlays) {
        for (const slot of inlay.scriptedImages) {
            for (const option of slot.gfxOptions) {
                if (option.gfxFile) {
                    continue;
                }

                warnings.push(createParseWarning({
                    code: 'inlay-gfx-missing',
                    text: localize("TODO", "Can't resolve inlay GFX {0} for slot {1} in inlay {2}.", option.gfxName, slot.id, inlay.id),
                    source: inlay.id,
                    navigations: option.token ? [{ file: option.file, start: option.token.start, end: option.token.end }] : undefined,
                }));
            }
        }
    }
}

export function parseInlayWindowRef(node: Node, file: string): FocusTreeInlayRef | undefined {
    const idNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "id") : undefined;
    const positionNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "position") : undefined;
    const id = idNode ? convertNodeToJson<string>(idNode, "string") : undefined;
    const position = positionNode ? convertNodeToJson<Position>(positionNode, positionSchema) : undefined;
    if (!id) {
        return undefined;
    }

    return {
        id,
        file,
        token: node.nameToken ?? undefined,
        position: {
            x: position?.x?._value ?? 0,
            y: position?.y?._value ?? 0,
        },
    };
}
