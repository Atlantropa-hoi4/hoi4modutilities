import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { convertFocusFileNodeToJson, FocusTree, getFocusTree } from "./schema";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten } from "lodash";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { sharedFocusIndex } from "../../util/featureflags";
import { findFileByFocusKey } from "../../util/sharedFocusIndex";
import { addInlayGfxWarnings, loadFocusInlayWindows, resolveInlayGfxFiles, resolveInlayGuiWindows, resolveInlaysForTree } from "./inlay";
import { sortFocusWarnings } from "./focuslint";
import { FocusSpacingLoader } from "./focusspacing";
import { NumberPosition } from "../../util/common";

export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
    focusSpacing?: NumberPosition;
}

const focusesGFX = 'interface/goals.gfx';
const focusTreeGuiFile = 'interface/nationalfocusview.gui';

export class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    public createSnapshotLoader(contentProvider: () => Promise<string>): FocusTreeLoader {
        const loader = new FocusTreeLoader(this.file, contentProvider);
        this.copyDependencyLoadersTo(loader);
        return loader;
    }

    public adoptDependencyLoadersFrom(source: FocusTreeLoader): void {
        this.replaceDependencyLoadersFrom(source);
    }

    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<FocusTreeLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }

        const constants = {};

        const parsedNode = parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file));
        const file = convertFocusFileNodeToJson(parsedNode, constants);

        if (sharedFocusIndex) {
            const dependencyPaths = new Set(dependencies.map(d => d.path));
            for (const focusTree of file.focus_tree) {
                for (const sharedFocus of focusTree.shared_focus) {
                    if (!sharedFocus) {
                        continue;
                    }
                    const filePath = await findFileByFocusKey(sharedFocus);
                    if (filePath && !dependencyPaths.has(filePath)) {
                        dependencyPaths.add(filePath);
                        dependencies.push({ type: 'focus', path: filePath });
                    }
                }
            }
        }

        const focusTreeDependencies = dependencies.filter(d => d.type === 'focus').map(d => d.path);
        const focusTreeDepFiles = await this.loaderDependencies.loadMultiple(focusTreeDependencies, session, FocusTreeLoader);
        const focusSpacingDepFiles = await this.loaderDependencies.loadMultiple([focusTreeGuiFile], session, FocusSpacingLoader);
        const focusSpacing = focusSpacingDepFiles[0]?.result.focusSpacing;

        const importedFocusTrees = focusTreeDepFiles.flatMap(f => f.result.focusTrees);

        const focusTrees = getFocusTree(parsedNode, importedFocusTrees, this.file);
        focusTrees.push(...importedFocusTrees.filter(tree => tree.kind === 'joint' && !focusTrees.some(localTree => localTree.id === tree.id)));

        const loadedInlays = await loadFocusInlayWindows();
        for (const focusTree of focusTrees) {
            const resolved = resolveInlaysForTree(focusTree.inlayWindowRefs, loadedInlays.inlays);
            focusTree.inlayWindows = resolved.inlayWindows;
            focusTree.inlayConditionExprs = resolved.inlayConditionExprs;
            if (focusTree.inlayWindowRefs.length > 0) {
                focusTree.warnings.push(...loadedInlays.warnings);
            }
            focusTree.warnings.push(...resolved.warnings);
            focusTree.warnings = sortFocusWarnings(focusTree.warnings);
        }

        const allInlays = focusTrees.flatMap(ft => ft.inlayWindows);
        const guiResolution = await resolveInlayGuiWindows(allInlays);
        for (const focusTree of focusTrees) {
            focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
            focusTree.warnings = sortFocusWarnings(focusTree.warnings);
        }

        const inlayGfxResolution = await resolveInlayGfxFiles(allInlays);
        for (const focusTree of focusTrees) {
            addInlayGfxWarnings(focusTree.inlayWindows, focusTree.warnings);
            focusTree.warnings = sortFocusWarnings(focusTree.warnings);
        }

        const focusIconNames = focusTrees
            .flatMap(ft => Object.values(ft.focuses))
            .flatMap(focus => focus.icon)
            .map(icon => icon.icon)
            .filter((icon): icon is string => icon !== undefined);
        const uniqueInlayFiles = Array.from(new Set(allInlays.map(inlay => inlay.file)));
        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(focusTreeDepFiles.map(f => f.result.gfxFiles)),
            ...await getGfxContainerFiles(focusIconNames),
            ...guiResolution.guiFiles,
            ...inlayGfxResolution.resolvedFiles,
        ];

        return {
            result: {
                focusTrees,
                gfxFiles: uniq([...gfxDependencies, focusesGFX]),
                focusSpacing,
            },
            dependencies: uniq([
                this.file,
                focusesGFX,
                focusTreeGuiFile,
                ...gfxDependencies,
                ...uniqueInlayFiles,
                ...focusTreeDependencies,
                ...mergeInLoadResult(focusSpacingDepFiles, 'dependencies'),
                ...mergeInLoadResult(focusTreeDepFiles, 'dependencies')
            ]),
        };
    }

    public toString() {
        return `[FocusTreeLoader ${this.file}]`;
    }
}
