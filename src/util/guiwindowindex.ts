import { GuiFile, guiFileSchema, ContainerWindowType } from "../hoiformat/gui";
import { convertNodeToJson, HOIPartial } from "../hoiformat/schema";
import { listFilesFromModOrHOI4, parseAndResolveHoi4FileCached } from "./fileloader";
import { findGuiFiles } from "./guiIndex";
import { GuiFileLoader } from "../previewdef/gui/loader";
import { LoaderSession } from "./loader/loader";

// Finding a `containerwindowtype` by the name a script refers to it by. A focus inlay window and a
// decision category's `scripted_gui` both name a window and leave the reader to find it, and the
// game finds it the same way for both: by finding its definition in the interface tree.
//
// Scripted GUI windows and their sprites can live anywhere under interface/ (e.g.
// interface/GER_inner_circle_scripted_gui.gui, interface/inner_circle.gfx), not just
// interface/scripted_gui, which does not even exist in vanilla. So the whole tree is scanned.
const guiInterfaceFolder = "interface";

export interface ResolvedGuiWindow {
	file: string;
	window: HOIPartial<ContainerWindowType>;
}

export async function listGuiFiles(): Promise<string[]> {
	return listInterfaceFiles(".gui");
}

export async function listGuiGfxFiles(): Promise<string[]> {
	return listInterfaceFiles(".gfx");
}

async function listInterfaceFiles(extension: string): Promise<string[]> {
	try {
		const files = await listFilesFromModOrHOI4(guiInterfaceFolder, { recursively: true });
		return files
			.filter((file) => file.toLowerCase().endsWith(extension))
			.map((file) => `${guiInterfaceFolder}/${file}`.replace(/\/+/g, "/"));
	} catch {
		return [];
	}
}

// The shared persistent name index narrows parsing to files defining the requested windows.
// Callers that already have an explicit ordered file list retain their existing lookup order.
export async function findContainerWindows(
	names: Iterable<string>,
	guiFiles?: string[],
): Promise<Record<string, ResolvedGuiWindow>> {
	const unresolved = new Set(names);
	const windowByName: Record<string, ResolvedGuiWindow> = {};
	if (unresolved.size === 0) {
		return windowByName;
	}

	for (const guiFile of guiFiles ?? (await findGuiFiles(unresolved))) {
		if (unresolved.size === 0) {
			break;
		}
		try {
			const guiNode = await parseAndResolveHoi4FileCached(guiFile);
			const guiFileData = convertNodeToJson<GuiFile>(guiNode, guiFileSchema);
			const windows = collectContainerWindows(guiFileData);
			for (const name of Object.keys(windows)) {
				if (unresolved.has(name) && !(name in windowByName)) {
					const window = windows[name];
					if (window !== undefined) {
						windowByName[name] = { file: guiFile, window };
					}
					unresolved.delete(name);
				}
			}
		} catch {
			continue;
		}
	}

	return windowByName;
}

export interface LoadedGuiWindows {
	windows: Record<string, ResolvedGuiWindow>;
	guiFiles: string[];
	gfxFiles: string[];
	dependencies: string[];
}

// Keep dependency headers and the conventional sibling GFX file when resolving an indexed GUI.
export async function loadContainerWindows(names: Iterable<string>, session: LoaderSession): Promise<LoadedGuiWindows> {
	const unresolved = new Set(names);
	const windows: Record<string, ResolvedGuiWindow> = {};
	const guiFiles = new Set<string>();
	const gfxFiles = new Set<string>();
	const dependencies = new Set<string>();
	const candidates = await findGuiFiles(unresolved);
	session.throwIfCancelled();
	for (const file of candidates) {
		session.throwIfCancelled();
		try {
			const loaded = await session.createOrGetCachedLoader(file, GuiFileLoader).load(session);
			session.throwIfCancelled();
			loaded.dependencies.forEach(dependency => dependencies.add(dependency));
			loaded.result.gfxFiles.forEach(gfxFile => gfxFiles.add(gfxFile));
			for (const guiFile of loaded.result.guiFiles) {
				guiFiles.add(guiFile.file);
				// The index chose the defining file in source order. Referenced GUI files
				// remain dependencies, but must not override that choice while loading it.
				if (guiFile.file !== file) { continue; }
				for (const [name, window] of Object.entries(collectContainerWindows(guiFile.data))) {
					if (unresolved.delete(name)) { windows[name] = { file: guiFile.file, window }; }
				}
			}
		} catch {
			session.throwIfCancelled();
		}
	}
	return { windows, guiFiles: [...guiFiles], gfxFiles: [...gfxFiles], dependencies: [...dependencies] };
}

export function collectContainerWindows(
	guiFile: HOIPartial<GuiFile>,
): Record<string, HOIPartial<ContainerWindowType>> {
	const result: Record<string, HOIPartial<ContainerWindowType>> = {};
	for (const guiTypes of guiFile.guitypes) {
		for (const containerWindow of [...guiTypes.containerwindowtype, ...guiTypes.windowtype]) {
			collectContainerWindowRecursive(containerWindow, result);
		}
	}
	return result;
}

function collectContainerWindowRecursive(
	containerWindow: HOIPartial<ContainerWindowType>,
	result: Record<string, HOIPartial<ContainerWindowType>>,
): void {
	if (containerWindow.name && !(containerWindow.name in result)) {
		result[containerWindow.name] = containerWindow;
	}
	for (const child of [...containerWindow.containerwindowtype, ...containerWindow.windowtype]) {
		collectContainerWindowRecursive(child, result);
	}
}

