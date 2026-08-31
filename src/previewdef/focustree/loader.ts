import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { convertFocusFileNodeToJson, FocusTree, getFocusTree, getGfxNameForSearchFilter } from "./schema";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten } from "lodash";
import { getGfxContainerFile } from "../../util/gfxindex";
import { isSharedFocusIndexEnabled } from "../../util/featureflags";
import { findFileByFocusKey, isSharedFocusIndexReady, tryFindFileByFocusKey } from "../../util/sharedFocusIndex";
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
import { createEmptyFocusIconAssetResolution, FocusIconAssetResolution, resolveFocusIconGfxAssets } from "./focusicongfx";
import { getSpriteTextureFilesByGfxFile } from "../../util/image/imagecache";
import { addMissingFocusIconWarnings } from "./focusiconwarnings";
import { hoiFileExpiryToken } from "../../util/fileloader";

export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
    focusIconGfxFileByName: Record<string, string>;
    focusIconAssetResolution: FocusIconAssetResolution;
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

        session.throwIfCancelled();
        const parsedNode = parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file));
        session.throwIfCancelled();
        const file = convertFocusFileNodeToJson(parsedNode, constants);

        const deferredSharedFocusIds = new Set<string>();
        if (isSharedFocusIndexEnabled()) {
            const dependencyPaths = new Set(dependencies.map(d => d.path));
            const canResolveSharedFocusImmediately = !deferAssetLoad || isSharedFocusIndexReady();
            for (const focusTree of file.focus_tree) {
                for (const sharedFocus of focusTree.shared_focus) {
                    session.throwIfCancelled();
                    if (!sharedFocus) {
                        continue;
                    }
                    if (!canResolveSharedFocusImmediately) {
                        deferredSharedFocusIds.add(sharedFocus);
                        continue;
                    }
                    const filePath = deferAssetLoad
                        ? tryFindFileByFocusKey(sharedFocus)
                        : await findFileByFocusKey(sharedFocus);
                    if (filePath && !dependencyPaths.has(filePath)) {
                        dependencyPaths.add(filePath);
                        dependencies.push({ type: 'focus', path: filePath });
                    }
                }
            }
        }

        const focusTreeDependencies = dependencies.filter(d => d.type === 'focus').map(d => d.path);
        const focusTreeDependencyLoaderType = deferAssetLoad ? DeferredFocusTreeLoader : FocusTreeLoader;
        const focusTreeDepFiles = await this.loaderDependencies.loadMultiple(focusTreeDependencies, session, focusTreeDependencyLoaderType);
        session.throwIfCancelled();
        const focusSpacingDepFiles = await this.loaderDependencies.loadMultiple([focusTreeGuiFile], session, FocusSpacingLoader);
        session.throwIfCancelled();
        const focusSpacing = focusSpacingDepFiles[0]?.result.focusSpacing;

        const importedFocusTrees = focusTreeDepFiles.flatMap(f => f.result.focusTrees);

        const focusTrees = getFocusTree(parsedNode, importedFocusTrees, this.file);
        if (deferredSharedFocusIds.size > 0) {
            for (const focusTree of focusTrees) {
                focusTree.warnings = focusTree.warnings.filter(warning =>
                    warning.code !== 'shared-focus-target-missing' || !deferredSharedFocusIds.has(warning.source));
            }
        }
        focusTrees.push(...importedFocusTrees.filter(tree => tree.kind === 'joint' && !focusTrees.some(localTree => localTree.id === tree.id)));

        const hasInlayRefs = !deferAssetLoad && focusTrees.some(focusTree => focusTree.inlayWindowRefs.length > 0);
        let loadedInlayFiles: string[] = [];
        if (!hasInlayRefs) {
            for (const focusTree of focusTrees) {
                session.throwIfCancelled();
                focusTree.inlayWindows = [];
                focusTree.inlayConditionExprs = [];
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        } else {
            const loadedInlays = await loadFocusInlayWindows();
            session.throwIfCancelled();
            loadedInlayFiles = loadedInlays.inlays.map(inlay => inlay.file);
            for (const focusTree of focusTrees) {
                session.throwIfCancelled();
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
        session.throwIfCancelled();
        if (!deferAssetLoad) {
            for (const focusTree of focusTrees) {
                session.throwIfCancelled();
                focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        }

        const inlayGfxResolution = deferAssetLoad
            ? { resolvedFiles: [] }
            : await resolveInlayGfxFiles(allInlays);
        session.throwIfCancelled();
        if (!deferAssetLoad) {
            for (const focusTree of focusTrees) {
                session.throwIfCancelled();
                addInlayGfxWarnings(focusTree.inlayWindows, focusTree.warnings);
                focusTree.warnings = sortFocusWarnings(focusTree.warnings);
            }
        }

        const focusIconNames = deferAssetLoad
            ? []
            : focusTrees
                .flatMap(ft => Object.values(ft.focuses))
                .flatMap(focus => [
                    ...focus.icon.map(icon => icon.icon),
                    focus.overlay,
                    ...focus.searchFilters.map(getGfxNameForSearchFilter),
                ])
                .filter((icon): icon is string => icon !== undefined);
        const uniqueInlayFiles = Array.from(new Set([
            ...loadedInlayFiles,
            ...allInlays.map(inlay => inlay.file),
        ]));
        const explicitGfxDependencies = uniq([
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(focusTreeDepFiles.map(f => f.result.gfxFiles)),
        ]);
        const iconGfxAssets = deferAssetLoad
            ? createEmptyFocusIconAssetResolution()
            : await resolveFocusIconGfxAssets(focusIconNames, {
                resolveIndexedFile: async gfxName => getGfxContainerFile(gfxName),
                listInterfaceGfxFiles: async () => orderFocusIconFallbackGfxFiles(await getCachedInterfaceGfxFiles()),
                readSpriteNames: getCachedInterfaceGfxSpriteNames,
                readSpriteTextureFiles: getSpriteTextureFilesByGfxFile,
                readTextureExpiryToken: hoiFileExpiryToken,
                priorityGfxFiles: explicitGfxDependencies,
                throwIfCancelled: () => session.throwIfCancelled(),
            });
        session.throwIfCancelled();

        const gfxDependencies = [
            ...explicitGfxDependencies,
            ...iconGfxAssets.gfxFiles,
            ...guiResolution.guiFiles,
            ...inlayGfxResolution.resolvedFiles,
        ];
        const textureDependencies = iconGfxAssets.textureFiles;
        if (!deferAssetLoad && iconGfxAssets.unresolvedIconNames.length > 0) {
            addMissingFocusIconWarnings(focusTrees, iconGfxAssets.unresolvedIconNames);
        }

        return {
            result: {
                focusTrees,
                gfxFiles: uniq([...gfxDependencies, focusesGFX]),
                focusIconGfxFileByName: iconGfxAssets.gfxFileByIconName,
                focusIconAssetResolution: iconGfxAssets,
                focusSpacing,
                deferredAssetLoad: deferAssetLoad,
            },
            dependencies: uniq([
                this.file,
                focusesGFX,
                focusTreeGuiFile,
                ...gfxDependencies,
                ...textureDependencies,
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

class DeferredFocusTreeLoader extends FocusTreeLoader {
    constructor(file: string) {
        super(file, undefined, 'deferred');
    }
}

function orderFocusIconFallbackGfxFiles(gfxFiles: string[]): string[] {
    const score = (file: string): number => {
        const lower = file.toLowerCase();
        if (lower === focusesGFX) {
            return 0;
        }
        if (lower.includes('/goals') || lower.includes('\\goals') || lower.includes('goals')) {
            return 1;
        }
        if (lower.includes('focus') || lower.includes('nationalfocus')) {
            return 2;
        }
        return 3;
    };

    return [...gfxFiles].sort((left, right) => {
        const scoreDelta = score(left) - score(right);
        return scoreDelta || left.localeCompare(right);
    });
}
