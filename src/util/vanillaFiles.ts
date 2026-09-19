import * as vscode from 'vscode';
import { ConfigurationKey, Hoi4FsSchema } from '../constants';
import { isHoi4InstallFile } from './hoi4InstallFile';

const skipVanillaFilesSetting = 'skipVanillaFiles';

// Folders mods usually copy from vanilla, following the Kaiserreich formatter skip list.
const vanillaDerivedPatterns = [
    '**/interface/**',
    '**/gfx/**',
    '**/common/names/**',
    '**/common/occupation_laws/**',
    '**/common/special_projects/**',
    '**/common/technologies/**',
    '**/common/units/*.txt',
    '**/common/units/codenames_operatives/**',
    '**/common/units/critical_parts/**',
    '**/common/units/equipment/**',
    '**/common/units/names/**',
    '**/common/units/names_railway_guns/**',
    '**/common/units/unit_modifiers/**',
    '**/history/states/**',
];

// Formatting and lint fixes leave vanilla files alone so they stay identical to the game's copies.
export function isHoi4VanillaFileSkipped(document: vscode.TextDocument): boolean {
    return isHoi4VanillaInstallFileSkipped(document.uri)
        || (isVanillaFileSkippingEnabled(document.uri) && matchesWorkspaceGlobs(document, vanillaDerivedPatterns));
}

// The read-only install file system can never be edited; install files on disk follow the vanilla toggle.
export function isHoi4VanillaInstallFileSkipped(uri: vscode.Uri): boolean {
    return isHoi4InstallFile(uri)
        && (uri.scheme === Hoi4FsSchema || isVanillaFileSkippingEnabled(uri));
}

export function matchesWorkspaceGlobs(document: vscode.TextDocument, patterns: readonly unknown[]): boolean {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    return patterns.some(pattern => {
        if (typeof pattern !== 'string') {
            return false;
        }

        const normalizedPattern = pattern.trim();
        if (normalizedPattern === '') {
            return false;
        }

        const globPattern = workspaceFolder === undefined
            ? normalizedPattern
            : new vscode.RelativePattern(workspaceFolder, normalizedPattern);
        return vscode.languages.match({ pattern: globPattern }, document) > 0;
    });
}

function isVanillaFileSkippingEnabled(uri: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration(ConfigurationKey, uri).get<unknown>(skipVanillaFilesSetting, true) !== false;
}
