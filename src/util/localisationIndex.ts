import * as vscode from 'vscode';
import { debounceByInput, mapWithConcurrency } from './common';
import { isLocalisationIndexEnabled } from './featureflags';
import {
    getFilePathFromMod,
    getSelectedModRootFolders,
    listFilesFromModOrHOI4,
    readFileFromModOrHOI4,
    refreshFileContentSource,
} from './fileloader';
import { localize } from './i18n';
import { Logger } from "./logger";
import { YAMLException } from "js-yaml";
import { IndexService } from '../services/indexService';
import { getConfiguration } from './vsccommon';
import { parseLocalisationFileContent } from './localisationparser';
import { LatestGeneration, LatestUpdateCoordinator } from './latestUpdate';
import { ConfigurationKey } from '../constants';
import { getRelativePathWithinRoot } from './nodecommon';
import { onDidChangeSelectedModSource } from './modfile';

export { parseLocalisationFile, parseLocalisationFileContent, preprocessYamlContent } from './localisationparser';

type LocalisationData = Record<string, Record<string, string>>;

interface LocalisationIndexSnapshot {
    index: LocalisationData;
    fileIndexes?: Record<string, LocalisationData>;
}

interface ResolveLocalisedTextOptions {
    allowAvailableWorkspaceLanguageFallback?: boolean;
}

const supportedLocalisationLangPattern = 'l_english|l_braz_por|l_german|l_french|l_spanish|l_korean|l_polish|l_russian|l_japanese|l_simp_chinese';
const localisationIndexFilePattern = new RegExp(`(?:^|[ _-])(${supportedLocalisationLangPattern})\\.yml$`, 'i');
const localisationIndexBuildConcurrency = 8;

let globalLocalisationIndex: LocalisationData = {};
let workspaceLocalisationIndex: LocalisationData = {};
let workspaceLocalisationFileIndexes: Record<string, LocalisationData> = {};
const workspaceLocalisationUpdates = new LatestUpdateCoordinator<string>();
const localisationIndexService = new IndexService<LocalisationIndexSnapshot>({
    global: {
        build: estimatedSize => buildGlobalLocalisationIndex(estimatedSize),
        commit: snapshot => {
            globalLocalisationIndex = snapshot.index;
        },
        reset: () => {
            globalLocalisationIndex = {};
        },
        statusMessage: 'Building Localisation index...',
        telemetryEvent: 'localisationIndex',
    },
    workspace: {
        build: estimatedSize => buildWorkspaceLocalisationIndex(estimatedSize),
        commit: snapshot => {
            workspaceLocalisationUpdates.invalidateAll();
            workspaceLocalisationIndex = snapshot.index;
            workspaceLocalisationFileIndexes = snapshot.fileIndexes ?? {};
        },
        reset: () => {
            workspaceLocalisationUpdates.invalidateAll();
            workspaceLocalisationIndex = {};
            workspaceLocalisationFileIndexes = {};
        },
        statusMessage: 'Building workspace Localisation index...',
        telemetryEvent: 'localisationIndex.workspace',
    },
});

// Mapping of language ISO codes to yml file language suffixes
const localeMapping: Record<string, string> = {
    'en': 'l_english',
    'pt-br': 'l_braz_por',
    'de': 'l_german',
    'fr': 'l_french',
    'es': 'l_spanish',
    'ko': 'l_korean',
    'pl': 'l_polish',
    'ru': 'l_russian',
    'ja': 'l_japanese',
    'zh-cn': 'l_simp_chinese',
};

// Mapping of language profiles to language ISO codes
const localeISOMapping: Record<string, string> = {
    ['Brazilian Portuguese']: 'pt-br',
    English: 'en',
    French: 'fr',
    German: 'de',
    Korean: 'ko',
    Japanese: 'ja',
    Polish: 'pl',
    Russian: 'ru',
    ['Simplified Chinese']: 'zh-cn',
    Spanish: 'es',
};

export function registerLocalisationIndex(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    if (isLocalisationIndexEnabled()) {
        let modRootWatchers: vscode.Disposable[] = [];
        const modRootWatcherGeneration = new LatestGeneration();
        const disposeModRootWatchers = () => {
            modRootWatchers.forEach(watcher => watcher.dispose());
            modRootWatchers = [];
        };
        const rebuildModRootWatchers = async () => {
            const isCurrent = modRootWatcherGeneration.next();
            disposeModRootWatchers();
            const roots = await getSelectedModRootFolders();
            if (!isCurrent()) {
                return;
            }
            modRootWatchers = roots.map(root => createLocalisationIndexFileWatcher(
                new vscode.RelativePattern(root, 'localisation/**/*.yml'),
                root,
                isCurrent,
            ));
        };
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
        disposables.push(createLocalisationIndexFileWatcher('localisation/**/*.yml'));
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void rebuildModRootWatchers(); }));
        disposables.push(onDidChangeSelectedModSource(() => {
            rebuildActiveLocalisationIndex('workspace');
            void rebuildModRootWatchers();
        }));
        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            onChangeIndexConfiguration(e);
        }));
        disposables.push(new vscode.Disposable(() => {
            modRootWatcherGeneration.invalidate();
            disposeModRootWatchers();
        }));
        void rebuildModRootWatchers();
    }

    return vscode.Disposable.from(...disposables);
}

export async function getLocalisedTextQuick(localisationKey: string | undefined): Promise<string | undefined> {
    const previewLocalisation = getConfiguration().previewLocalisation;
    if (previewLocalisation) {
        return getLocalisedText(localisationKey, localeISOMapping[previewLocalisation] ?? vscode.env.language, {
            allowAvailableWorkspaceLanguageFallback: false,
        });
    }
    return getLocalisedText(localisationKey, vscode.env.language);
}

export function getLocalisedTextQuickIfReady(localisationKey: string | undefined): string | undefined {
    const resolveText = createLocalisedTextQuickIfReadyResolver();
    return resolveText ? resolveText(localisationKey) : localisationKey;
}

export function createLocalisedTextQuickIfReadyResolver(
    getCurrentConfiguration: typeof getConfiguration = getConfiguration,
): (localisationKey: string | undefined) => string | undefined {
    const configuration = getCurrentConfiguration();
    if (!isLocalisationIndexEnabled(configuration.featureFlags)) {
        return localisationKey => localisationKey;
    }

    const previewLocalisation = configuration.previewLocalisation;
    if (previewLocalisation) {
        const language = localeISOMapping[previewLocalisation] ?? vscode.env.language;
        const options = { allowAvailableWorkspaceLanguageFallback: false };
        return localisationKey => resolveLocalisedTextFromIndex(
            localisationKey,
            language,
            globalLocalisationIndex,
            workspaceLocalisationIndex,
            options,
        );
    }

    const language = vscode.env.language;
    return localisationKey => resolveLocalisedTextFromIndex(
        localisationKey,
        language,
        globalLocalisationIndex,
        workspaceLocalisationIndex,
    );
}

export async function getLocalisedText(
    localisationKey: string | undefined,
    language: string,
    options?: ResolveLocalisedTextOptions,
): Promise<string | undefined> {
    if (!localisationKey) {
        return localisationKey;
    }

    if (!isLocalisationIndexEnabled()) {
        return localisationKey ?? '';
    }

    await Promise.all([ensureGlobalLocalisationIndex(), ensureWorkspaceLocalisationIndex()]);

    return resolveLocalisedTextFromIndex(localisationKey, language, globalLocalisationIndex, workspaceLocalisationIndex, options);
}

export function getLocalisedTextIfReady(
    localisationKey: string | undefined,
    language: string,
    options?: ResolveLocalisedTextOptions,
): string | undefined {
    if (!localisationKey) {
        return localisationKey;
    }

    if (!isLocalisationIndexEnabled()) {
        return localisationKey ?? '';
    }

    return resolveLocalisedTextFromIndex(localisationKey, language, globalLocalisationIndex, workspaceLocalisationIndex, options);
}

export function resolveLocalisedTextFromIndex(
    localisationKey: string | undefined,
    language: string,
    globalIndex: LocalisationData,
    workspaceIndex: LocalisationData,
    options: ResolveLocalisedTextOptions = {},
): string | undefined {
    if (!localisationKey) {
        return localisationKey;
    }

    const langKey = localeMapping[language.toLowerCase()] || 'l_english';
    const defaultLangKey = 'l_english';
    const allowAvailableWorkspaceLanguageFallback = options.allowAvailableWorkspaceLanguageFallback ?? true;

    return workspaceIndex[langKey]?.[localisationKey]
        ?? globalIndex[langKey]?.[localisationKey]
        ?? workspaceIndex[defaultLangKey]?.[localisationKey]
        ?? globalIndex[defaultLangKey]?.[localisationKey]
        ?? (allowAvailableWorkspaceLanguageFallback
            ? resolveLocalisedTextFromAvailableWorkspaceLanguage(localisationKey, workspaceIndex, [langKey, defaultLangKey])
            : undefined)
        ?? localisationKey;
}

function resolveLocalisedTextFromAvailableWorkspaceLanguage(
    localisationKey: string,
    workspaceIndex: LocalisationData,
    skippedLangKeys: string[],
): string | undefined {
    const skipped = new Set(skippedLangKeys);
    for (const langKey of Object.keys(workspaceIndex).sort()) {
        if (skipped.has(langKey)) {
            continue;
        }

        const text = workspaceIndex[langKey]?.[localisationKey];
        if (text !== undefined) {
            return text;
        }
    }

    return undefined;
}

async function buildGlobalLocalisationIndex(estimatedSize: [number]): Promise<LocalisationIndexSnapshot> {
    const baseOptions = { mod: false, hoi4: true, dlc: false, recursively: true };
    const dlcOptions = { mod: false, hoi4: false, dlc: true, recursively: true };
    const [baseFiles, dlcFiles] = await Promise.all([
        listFilesFromModOrHOI4('localisation', baseOptions),
        listFilesFromModOrHOI4('localisation', dlcOptions),
    ]);
    const loadFileIndexes = (files: string[], options: typeof baseOptions) => mapWithConcurrency(
        files.filter(isLocalisationIndexFilePath),
        localisationIndexBuildConcurrency,
        async f => {
            const fileIndex: LocalisationData = {};
            await fillLocalisationItems('localisation/' + f, fileIndex, options, estimatedSize);
            return fileIndex;
        },
    );
    const [baseFileIndexes, dlcFileIndexes] = await Promise.all([
        loadFileIndexes(baseFiles, baseOptions),
        loadFileIndexes(dlcFiles, dlcOptions),
    ]);
    const rebuilt = mergeLocalisationIndexes([...baseFileIndexes, ...dlcFileIndexes]);
    return { index: rebuilt };
}

async function buildWorkspaceLocalisationIndex(estimatedSize: [number]): Promise<LocalisationIndexSnapshot> {
    const options = { mod: true, hoi4: false, dlc: false, recursively: true };
    const localisationFiles = (await listFilesFromModOrHOI4('localisation', options))
        .filter(isLocalisationIndexFilePath);
    const fileIndexes = await mapWithConcurrency(localisationFiles, localisationIndexBuildConcurrency, async f => {
        const relativePath = 'localisation/' + f;
        const fileIndex: LocalisationData = {};
        await fillLocalisationItems(relativePath, fileIndex, options, estimatedSize);
        return [relativePath, fileIndex] as const;
    });
    const rebuiltFileIndexes = Object.fromEntries(fileIndexes);
    return {
        index: rebuildLocalisationIndexFromFileIndexes(rebuiltFileIndexes),
        fileIndexes: rebuiltFileIndexes,
    };
}

function ensureGlobalLocalisationIndex(): Promise<void> {
    return ensureGlobalLocalisationIndexImpl(true);
}

function ensureGlobalLocalisationIndexImpl(showStatusBar: boolean): Promise<void> {
    return localisationIndexService.ensure('global', { showStatusBar });
}

function ensureWorkspaceLocalisationIndex(): Promise<void> {
    return ensureWorkspaceLocalisationIndexImpl(true);
}

function ensureWorkspaceLocalisationIndexImpl(showStatusBar: boolean): Promise<void> {
    return localisationIndexService.ensure('workspace', { showStatusBar });
}

export async function prewarmLocalisationIndex(): Promise<void> {
    if (!isLocalisationIndexEnabled()) {
        return;
    }

    await whenLocalisationIndexReady({ showStatusBar: false });
}

export function isLocalisationIndexReady(): boolean {
    return !isLocalisationIndexEnabled()
        || (localisationIndexService.isReady('global') && localisationIndexService.isReady('workspace'));
}

export async function whenLocalisationIndexReady(options?: { showStatusBar?: boolean }): Promise<void> {
    if (!isLocalisationIndexEnabled()) {
        return;
    }

    const showStatusBar = options?.showStatusBar ?? true;
    await Promise.all([
        ensureGlobalLocalisationIndexImpl(showStatusBar),
        ensureWorkspaceLocalisationIndexImpl(showStatusBar),
    ]);
}

async function fillLocalisationItems(localisationFile: string, localisationIndex: LocalisationData, options: {
    mod?: boolean,
    hoi4?: boolean,
    dlc?: boolean
}, estimatedSize?: [number]): Promise<void> {
    try {
        const [fileBuffer] = await readFileFromModOrHOI4(localisationFile, options);
        const localisations = parseLocalisationFileContent(fileBuffer.toString());
        for (const langKey in localisations) {
            if (!localisationIndex[langKey]) {
                localisationIndex[langKey] = {};
            }

            Object.assign(localisationIndex[langKey], localisations[langKey]);

            if (estimatedSize) {
                estimatedSize[0] += Object.keys(localisations[langKey]).reduce((sum, key) => sum + key.length + localisations[langKey][key].length, 0);
            }
        }
    } catch (e) {
        console.error(e);

        const baseMessage = options.hoi4
            ? localize('localisationIndex.vanilla', '[Vanilla]')
            : localize('localisationIndex.mod', '[mod]');

        const failureMessage = localize('localisationIndex.parseFailure', 'parsing failed! Please check if the file has issues!');

        if (e instanceof YAMLException) {
            Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}\n${e.message}`);
        } else {
            Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}`);
        }
    }
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
    if (!localisationIndexService.isActive('workspace')) {
        return;
    }
    rebuildActiveLocalisationIndex('workspace');
}

function onChangeIndexConfiguration(e: vscode.ConfigurationChangeEvent): void {
    if (e.affectsConfiguration(`${ConfigurationKey}.installPath`)
        || e.affectsConfiguration(`${ConfigurationKey}.loadDlcContents`)) {
        rebuildActiveLocalisationIndex('global');
    }
}

function rebuildActiveLocalisationIndex(targetId: 'global' | 'workspace'): void {
    localisationIndexService.rebuildIfActive(targetId, { showStatusBar: false });
}

function prepareWorkspaceLocalisationIncrementalUpdate(): boolean {
    if (localisationIndexService.isReady('workspace')) {
        return true;
    }
    rebuildActiveLocalisationIndex('workspace');
    return false;
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    const file = e.document.uri;
    if (!getWorkspaceLocalisationIndexRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceLocalisationIncrementalUpdate()) {
        return;
    }
    onChangeTextDocumentImpl(file);
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        if (prepareWorkspaceLocalisationIncrementalUpdate()) {
            replaceWorkspaceLocalisationIndex(file);
        }
    },
    file => file.toString(),
    1000,
    { trailing: true }
);

function onCloseTextDocument(document: vscode.TextDocument) {
    const file = document.uri;
    if (!getWorkspaceLocalisationIndexRelativePath(file)) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceLocalisationIncrementalUpdate()) {
        return;
    }
    replaceWorkspaceLocalisationIndex(file);
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    const files = e.files.filter(file => getWorkspaceLocalisationIndexRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceLocalisationIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceLocalisationIndex(file);
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    const files = e.files.filter(file => getWorkspaceLocalisationIndexRelativePath(file) !== undefined);
    if (files.length === 0) {
        return;
    }
    refreshFileContentSource();
    if (!prepareWorkspaceLocalisationIncrementalUpdate()) {
        return;
    }
    for (const file of files) {
        replaceWorkspaceLocalisationIndex(file);
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}

function createLocalisationIndexFileWatcher(
    pattern: vscode.GlobPattern,
    root?: vscode.Uri,
    isCurrent: () => boolean = () => true,
): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = (file: vscode.Uri) => {
        if (!isCurrent() || !getWorkspaceLocalisationIndexRelativePath(file, root)) {
            return;
        }
        refreshFileContentSource();
        if (prepareWorkspaceLocalisationIncrementalUpdate()) {
            replaceWorkspaceLocalisationIndex(file, root);
        }
    };
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(onChange),
        watcher.onDidCreate(onChange),
        watcher.onDidDelete(onChange),
    );
}

function replaceWorkspaceLocalisationIndex(file: vscode.Uri, root?: vscode.Uri): void {
    const relative = getWorkspaceLocalisationIndexRelativePath(file, root);
    if (!relative) {
        return;
    }

    void workspaceLocalisationUpdates.update(relative, async () => {
        const fileIndex: LocalisationData = {};
        if (!await getFilePathFromMod(relative)) {
            return undefined;
        }
        await fillLocalisationItems(relative, fileIndex, { mod: true, hoi4: false, dlc: false });
        return fileIndex;
    }, fileIndex => {
        workspaceLocalisationIndex = applyLocalisationFileIndexUpdate(
            workspaceLocalisationFileIndexes,
            relative,
            fileIndex,
        );
    });
}

function getWorkspaceLocalisationIndexRelativePath(file: vscode.Uri, root?: vscode.Uri): string | undefined {
    const baseUri = root ?? vscode.workspace.getWorkspaceFolder(file)?.uri;
    if (!baseUri) {
        return undefined;
    }

    const relative = getRelativePathWithinRoot(baseUri.path, file.path, 'localisation');
    return relative
        && isLocalisationIndexFilePath(relative)
        ? relative
        : undefined;
}

export function applyLocalisationFileIndexUpdate(
    fileIndexes: Record<string, LocalisationData>,
    relative: string,
    fileIndex: LocalisationData | undefined,
): LocalisationData {
    fileIndexes[relative] = fileIndex ?? {};
    return rebuildLocalisationIndexFromFileIndexes(fileIndexes);
}

export function rebuildLocalisationIndexFromFileIndexes(fileIndexes: Record<string, LocalisationData>): LocalisationData {
    return mergeLocalisationIndexes(Object.values(fileIndexes));
}

export function mergeLocalisationIndexes(indexes: readonly LocalisationData[]): LocalisationData {
    const result: LocalisationData = {};
    for (const fileIndex of indexes) {
        for (const [langKey, entries] of Object.entries(fileIndex)) {
            result[langKey] = result[langKey] ?? {};
            Object.assign(result[langKey], entries);
        }
    }

    return result;
}

export function isLocalisationIndexFilePath(filePath: string): boolean {
    return localisationIndexFilePattern.test(filePath);
}

export function getLocalisationIndexLangKeyFromPath(filePath: string): string {
    const match = filePath.match(localisationIndexFilePattern);
    return match ? match[1].toLowerCase() : 'l_english';
}
