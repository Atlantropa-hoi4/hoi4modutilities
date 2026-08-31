import * as vscode from 'vscode';
import * as path from 'path';
import { localize } from './i18n';
import { UserError } from './common';
import { isSamePath } from './nodecommon';
import { ConfigurationKey } from '../constants';
import { normalizeFileOrUriString } from './pathinput';

export type PreviewLocalisation = 'Brazilian Portuguese' | 'English' | 'French' | 'German' | 'Japanese' | 'Korean' | 'Polish' | 'Russian' | 'Simplified Chinese' | 'Spanish';

interface Hoi4ModUtilitiesConfigurationValues {
    readonly installPath: string;
    readonly loadDlcContents: boolean;
    readonly modFile: string;
    readonly featureFlags: string[];
    readonly previewLocalisation: PreviewLocalisation;
}

export type Hoi4ModUtilitiesConfiguration = vscode.WorkspaceConfiguration & Hoi4ModUtilitiesConfigurationValues;

const defaultConfigurationValues: Hoi4ModUtilitiesConfigurationValues = {
    installPath: '',
    loadDlcContents: true,
    modFile: '',
    featureFlags: [],
    previewLocalisation: 'English',
};

const fallbackWorkspaceConfiguration: vscode.WorkspaceConfiguration = {
    get: <T>(_section: string, defaultValue?: T) => defaultValue as T,
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
};

export function getConfiguration(): Hoi4ModUtilitiesConfiguration {
    const getWorkspaceConfiguration = vscode.workspace?.getConfiguration;
    if (typeof getWorkspaceConfiguration !== 'function') {
        return {
            ...fallbackWorkspaceConfiguration,
            ...defaultConfigurationValues,
            featureFlags: [...defaultConfigurationValues.featureFlags],
        } as Hoi4ModUtilitiesConfiguration;
    }

    const configuration = getWorkspaceConfiguration(ConfigurationKey) as Partial<Hoi4ModUtilitiesConfiguration> | undefined;
    const configurationValues = getConfigurationValues(configuration);
    return {
        ...fallbackWorkspaceConfiguration,
        ...configuration,
        ...configurationValues,
    } as Hoi4ModUtilitiesConfiguration;
}

function getConfigurationValues(configuration: Partial<Hoi4ModUtilitiesConfiguration> | undefined): Hoi4ModUtilitiesConfigurationValues {
    const featureFlags = getConfigurationValue(configuration, 'featureFlags');
    return {
        installPath: getConfigurationValue(configuration, 'installPath'),
        loadDlcContents: getConfigurationValue(configuration, 'loadDlcContents'),
        modFile: getConfigurationValue(configuration, 'modFile'),
        featureFlags: Array.isArray(featureFlags) ? [...featureFlags] : [...defaultConfigurationValues.featureFlags],
        previewLocalisation: getConfigurationValue(configuration, 'previewLocalisation'),
    };
}

function getConfigurationValue<K extends keyof Hoi4ModUtilitiesConfigurationValues>(
    configuration: Partial<Hoi4ModUtilitiesConfiguration> | undefined,
    key: K,
): Hoi4ModUtilitiesConfigurationValues[K] {
    const defaultValue = defaultConfigurationValues[key];
    if (configuration && typeof configuration.get === 'function') {
        return configuration.get(key, defaultValue);
    }

    const value = configuration?.[key];
    return value === undefined ? defaultValue : value;
}

export function getDocumentByUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}

export function getRelativePathInWorkspace(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        return path.relative(folder.uri.path, uri.path).replace(/\\/g, '/');
    } else {
        ensureFileScheme(uri);
        return uri.fsPath;
    }
}

export function isFileScheme(uri: vscode.Uri) {
    return uri.scheme === 'file';
}

export function ensureFileScheme(uri: vscode.Uri) {
    if (!isFileScheme(uri)) {
        throw new UserError(localize('filenotondisk', 'File is not on disk: {0}.', uri.toString()));
    }
}

export function isSameUri(uriA: vscode.Uri, uriB: vscode.Uri) {
    return (isFileScheme(uriA) && isFileScheme(uriB) && isSamePath(uriA.fsPath, uriB.fsPath)) || uriA.toString() === uriB.toString();
}

export async function getLastModifiedAsync(path: vscode.Uri): Promise<number> {
    return (await vscode.workspace.fs.stat(path)).mtime;
}

export async function readDir(dir: vscode.Uri): Promise<string[]> {
    return (await vscode.workspace.fs.readDirectory(dir)).map(f => f[0]);
}

export async function readDirFiles(dir: vscode.Uri): Promise<string[]> {
    return (await vscode.workspace.fs.readDirectory(dir)).filter(f => f[1] === vscode.FileType.File).map(f => f[0]);
}

export async function readDirFilesRecursively(dir: vscode.Uri): Promise<string[]> {
    const result: string[] = [];
    await readDirFilesRecursivelyImpl(dir, '', result);
    return result;
}

async function readDirFilesRecursivelyImpl(dir: vscode.Uri, prefix: string, result: string[]): Promise<void> {
    const items = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of items) {
        if (type === vscode.FileType.File) {
            result.push(prefix + name);
        } else if (type === vscode.FileType.Directory) {
            await readDirFilesRecursivelyImpl(vscode.Uri.joinPath(dir, name), prefix + name + '/', result);
        }
    }
}

export async function readFile(path: vscode.Uri): Promise<Buffer> {
    return Buffer.from(await vscode.workspace.fs.readFile(path));
}

export async function writeFile(path: vscode.Uri, buffer: Buffer): Promise<void> {
    return await vscode.workspace.fs.writeFile(path, buffer);
}

export async function mkdirs(path: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(path);
}

export async function isFile(path: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.File;
    } catch (e) {
        return false;
    }
}

export async function isDirectory(path: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.Directory;
    } catch (e) {
        return false;
    }
}

export function dirUri(uri: vscode.Uri): vscode.Uri {
    const updatedPath = path.dirname(uri.path);
    return uri.with({ path: updatedPath });
}

export function basename(uri: vscode.Uri, ext?: string): string {
    return path.basename(uri.path, ext);
}

export function fileOrUriStringToUri(path: string): vscode.Uri | undefined {
    const normalizedPath = normalizeFileOrUriString(path);
    if (normalizedPath === '') {
        return undefined;
    }

    try {
        if (/^[a-zA-Z]:[\\/]/.test(normalizedPath) || /^\\\\/.test(normalizedPath)) {
            return vscode.Uri.file(normalizedPath);
        }

        if (normalizedPath.indexOf(':') > 2) { // try to avoid prefix like "D:\"
            return vscode.Uri.parse(normalizedPath);
        }

        return vscode.Uri.file(normalizedPath);
    } catch (e) {
        return undefined;
    }
}

export function uriToFilePathWhenPossible(uri: vscode.Uri): string {
    if (isFileScheme(uri)) {
        return uri.fsPath;
    }

    return uri.toString();
}

const languageYmlDict: Record<PreviewLocalisation, string> = {
    ['Brazilian Portuguese']: 'l_braz_por',
    English: 'l_english',
    French: 'l_french',
    German: 'l_german',
    Japanese: 'l_japanese',
    Korean: 'l_korean',
    Polish: 'l_polish',
    Russian: 'l_russian',
    ['Simplified Chinese']: 'l_simp_chinese',
    Spanish: 'l_spanish',
};

export function getLanguageIdInYml(): string {
    return languageYmlDict[getConfiguration().previewLocalisation] ?? languageYmlDict['English'];
}

export async function showQuickPickAnyString(
    items: string[] | Thenable<string[]>,
    validate?: (value: string) => boolean,
    placeholder?: string,
): Promise<string | undefined> {
    const resolvedItems = await items;
    return new Promise<string | undefined>(resolve => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = resolvedItems.map(label => ({ label }));
        quickPick.placeholder = placeholder;
        quickPick.onDidAccept(() => {
            const selection = quickPick.selectedItems[0];
            const value = selection ? selection.label : quickPick.value;
            if (!validate || validate(value)) {
                resolve(value);
                quickPick.hide();
            }
        });
        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });
        quickPick.show();
    });
}
