import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { convertFocusFileNodeToJson, FocusTree, getFocusTree } from "./schema";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten } from "lodash";
import { tryGetGfxContainerFile } from "../../util/gfxindex";
import { sharedFocusIndex } from "../../util/featureflags";
import { findFileByFocusKey } from "../../util/sharedFocusIndex";
import {
    addInlayGfxWarnings,
    getCachedInterfaceGfxFiles,
    getCachedInterfaceGfxSpriteNames,
    loadFocusInlayWindows,
    resolveInlayGfxFiles,
    resolveInlayGuiWindows,
    resolveInlaysForTree,
} from "./inlay";
import { sortFocusWarnings } from "./focuslint";
import { FocusSpacingLoader } from "./focusspacing";
import { NumberPosition } from "../../util/common";
import { resolveFocusIconGfxFiles } from "./focusicongfx";

export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
    focusSpacing?: NumberPosition;
    deferredAssetLoad?: boolean;
}

export type FocusTreeAssetLoadMode = 'full' | 'deferred';

const focusesGFX = 'interface/goals.gfx';
const focusTreeGuiFile = 'interface/nationalfocusview.gui';

export class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    constructor(
        file: string,
        contentProvider?: () => Promise<string>,
        private assetLoadMode: FocusTreeAssetLoadMode = 'full',
    ) {
        super(file, contentProvider);
    }

    public createSnapshotLoader(
        contentProvider: () => Promise<string>,
        assetLoadMode: FocusTreeAssetLoadMode = this.assetLoadMode,
    ): FocusTreeLoader {
        const loader = new FocusTreeLoader(this.file, contentProvider, assetLoadMode);
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

        const deferAssetLoad = this.assetLoadMode === 'deferred';

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

        const hasInlayRefs = !deferAssetLoad && focusTrees.some(focusTree => focusTree.inlayWindowRefs.length > 0);
        let loadedInlayFiles: string[] = [];
        if (!hasInlayRefs) {
            for (const focusTree of focusTrees) {
                focusTree.inlayWindows = [];
                focusTree.inlayConditionExprs = [];
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        } else {
            const loadedInlays = await loadFocusInlayWindows();
            loadedInlayFiles = loadedInlays.inlays.map(inlay => inlay.file);
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
        }

        const allInlays = focusTrees.flatMap(ft => ft.inlayWindows);
        const guiResolution = deferAssetLoad
            ? { guiFiles: [], warnings: [] as ReturnType<typeof sortFocusWarnings> }
            : await resolveInlayGuiWindows(allInlays);
        if (!deferAssetLoad) {
            for (const focusTree of focusTrees) {
                focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        }

        const inlayGfxResolution = deferAssetLoad
            ? { resolvedFiles: [] }
            : await resolveInlayGfxFiles(allInlays);
        if (!deferAssetLoad) {
            for (const focusTree of focusTrees) {
                addInlayGfxWarnings(focusTree.inlayWindows, focusTree.warnings);
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        }

        const focusIconNames = deferAssetLoad
            ? []
            : focusTrees
                .flatMap(ft => Object.values(ft.focuses))
                .flatMap(focus => focus.icon)
                .map(icon => icon.icon)
                .filter((icon): icon is string => icon !== undefined);
        const uniqueInlayFiles = Array.from(new Set([
            ...loadedInlayFiles,
            ...allInlays.map(inlay => inlay.file),
        ]));
        const iconGfxFiles = await resolveFocusIconGfxFiles(focusIconNames, {
            resolveIndexedFile: async gfxName => tryGetGfxContainerFile(gfxName),
            listInterfaceGfxFiles: getCachedInterfaceGfxFiles,
            readSpriteNames: getCachedInterfaceGfxSpriteNames,
        });

        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(focusTreeDepFiles.map(f => f.result.gfxFiles)),
            ...iconGfxFiles,
            ...guiResolution.guiFiles,
            ...inlayGfxResolution.resolvedFiles,
        ];

        return {
            result: {
                focusTrees,
                gfxFiles: uniq([...gfxDependencies, focusesGFX]),
                focusSpacing,
                deferredAssetLoad: deferAssetLoad,
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
