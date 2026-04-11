import { ConditionComplexExpr, ConditionItem, extractConditionValue, extractConditionalExprs } from "../../hoiformat/condition";
import { ContainerWindowType, GuiFile, guiFileSchema } from "../../hoiformat/gui";
import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { convertNodeToJson, HOIPartial, Position, positionSchema } from "../../hoiformat/schema";
import { getSpriteTypes } from "../../hoiformat/spritetype";
import { countryScope } from "../../hoiformat/scope";
import { hoiFileExpiryToken, listFilesFromModOrHOI4, readFileFromModOrHOI4 } from "../../util/fileloader";
import { PromiseCache } from "../../util/cache";
import { tryGetGfxContainerFile } from "../../util/gfxindex";
import { localize } from "../../util/i18n";
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

interface ScriptedGuiWindowsCache {
    guiFiles: string[];
    windowsByName: Record<string, { file: string; window: HOIPartial<ContainerWindowType> }>;
}

interface InterfaceGfxCache {
    gfxFiles: string[];
    spriteNamesByFile: Record<string, string[]>;
}

const focusInlayWindowsFolder = "common/focus_inlay_windows";
const interfaceGuiFolder = "interface";
const interfaceFolder = "interface";

const focusInlayWindowsCache = new PromiseCache<ParsedInlayFileCache>({
    factory: buildFocusInlayWindowsCache,
    expireWhenChange: () => getFolderFilesExpiryToken(focusInlayWindowsFolder, ".txt"),
    life: 10 * 60 * 1000,
});

const scriptedGuiWindowsCache = new PromiseCache<ScriptedGuiWindowsCache>({
    factory: buildScriptedGuiWindowsCache,
    expireWhenChange: () => getFolderFilesExpiryToken(interfaceGuiFolder, ".gui"),
    life: 10 * 60 * 1000,
});

const interfaceGfxCache = new PromiseCache<InterfaceGfxCache>({
    factory: buildInterfaceGfxCache,
    expireWhenChange: () => getFolderFilesExpiryToken(interfaceFolder, ".gfx"),
    life: 10 * 60 * 1000,
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

export async function loadFocusInlayWindows(): Promise<ParsedInlayFile> {
    return await focusInlayWindowsCache.get();
}

async function buildFocusInlayWindowsCache(): Promise<ParsedInlayFileCache> {
    const files = await listFolderFiles(focusInlayWindowsFolder, ".txt");
    const inlays: FocusTreeInlay[] = [];
    const warnings: FocusWarning[] = [];

    for (const relativePath of files) {
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(relativePath);
            const node = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize("infile", "In file {0}:\n", uri.toString()));
            const parsed = parseInlayNode(node, relativePath);
            inlays.push(...parsed.inlays);
            warnings.push(...parsed.warnings);
        } catch (e) {
            warnings.push(createParseWarning({
                code: 'inlay-file-parse-failed',
                text: localize("TODO", "Failed to parse inlay window file {0}: {1}", relativePath, e instanceof Error ? e.message : String(e)),
                source: relativePath,
            }));
        }
    }

    return { inlays, warnings, files };
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
        extractConditionalExprs(resolved.visible, conditionExprs);
        resolved.scriptedImages.forEach(slot => slot.gfxOptions.forEach(option => extractConditionalExprs(option.condition, conditionExprs)));
        resolved.scriptedButtons.forEach(button => button.available && extractConditionalExprs(button.available, conditionExprs));
        inlayWindows.push(resolved);
    }

    return { inlayWindows, inlayConditionExprs: conditionExprs, warnings };
}

export async function resolveInlayGuiWindows(inlays: FocusTreeInlay[]): Promise<{ guiFiles: string[], warnings: FocusWarning[] }> {
    const warnings: FocusWarning[] = [];
    if (inlays.length === 0 || !inlays.some(inlay => !!inlay.windowName)) {
        return { guiFiles: [], warnings };
    }

    const guiWindows = await scriptedGuiWindowsCache.get();
    return resolveInlayGuiWindowLookup(inlays, guiWindows.windowsByName);
}

async function listGuiFiles(): Promise<string[]> {
    return await listFolderFiles(interfaceGuiFolder, ".gui");
}

async function buildScriptedGuiWindowsCache(): Promise<ScriptedGuiWindowsCache> {
    const guiFiles = await listGuiFiles();
    const windowsByName: ScriptedGuiWindowsCache["windowsByName"] = {};

    for (const guiFile of guiFiles) {
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(guiFile);
            const guiNode = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize("infile", "In file {0}:\n", uri.toString()));
            const guiFileData = convertNodeToJson<GuiFile>(guiNode, guiFileSchema);
            for (const [windowName, window] of Object.entries(collectContainerWindows(guiFileData))) {
                if (!(windowName in windowsByName)) {
                    windowsByName[windowName] = { file: guiFile, window };
                }
            }
        } catch {
            // Ignore malformed GUI files here; the GUI preview already reports them in its own flow.
        }
    }

    return { guiFiles, windowsByName };
}

function collectContainerWindows(guiFile: HOIPartial<GuiFile>): Record<string, HOIPartial<ContainerWindowType>> {
    const result: Record<string, HOIPartial<ContainerWindowType>> = {};
    for (const guiTypes of guiFile.guitypes) {
        for (const containerWindow of [...guiTypes.containerwindowtype, ...guiTypes.windowtype]) {
            collectContainerWindowRecursive(containerWindow, result);
        }
    }
    return result;
}

function collectContainerWindowRecursive(containerWindow: HOIPartial<ContainerWindowType>, result: Record<string, HOIPartial<ContainerWindowType>>) {
    if (containerWindow.name && !(containerWindow.name in result)) {
        result[containerWindow.name] = containerWindow;
    }

    for (const child of [...containerWindow.containerwindowtype, ...containerWindow.windowtype]) {
        collectContainerWindowRecursive(child, result);
    }
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
async function buildInterfaceGfxCache(): Promise<InterfaceGfxCache> {
    const gfxFiles = await listFolderFiles(interfaceFolder, ".gfx");
    const spriteNamesByFile: Record<string, string[]> = {};

    for (const candidateFile of gfxFiles) {
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(candidateFile);
            const spriteTypes = getSpriteTypes(parseHoi4File(
                buffer.toString().replace(/^\uFEFF/, ""),
                localize("infile", "In file {0}:\n", uri.toString()),
            ));
            const spriteNames = spriteTypes.map(spriteType => spriteType.name);
            spriteNamesByFile[candidateFile] = spriteNames;
        } catch {
            // Ignore unreadable GFX files in the fallback scan.
        }
    }

    return { gfxFiles, spriteNamesByFile };
}

export async function getCachedInterfaceGfxFiles(): Promise<string[]> {
    return (await interfaceGfxCache.get()).gfxFiles;
}

export async function getCachedInterfaceGfxSpriteNames(gfxFile: string): Promise<string[]> {
    return (await interfaceGfxCache.get()).spriteNamesByFile[gfxFile] ?? [];
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
