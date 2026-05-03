import * as path from 'path';
import * as vscode from 'vscode';
import { PNG } from 'pngjs';
import { Commands } from '../constants';
import { forceError, UserError } from './common';
import { localize } from './i18n';
import { dirUri, getRelativePathInWorkspace, isDirectory, mkdirs, readDirFiles, readFile, writeFile } from './vsccommon';

const TGA = require('tga') as typeof import('tga');

export type FlagVariant = 'medium' | 'small';

export interface FlagSize {
    readonly width: number;
    readonly height: number;
}

export interface RgbaImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}

export interface FlagResizeSourcePlan {
    readonly fileName: string;
    readonly targets: readonly FlagVariant[];
}

export interface FlagResizePlan {
    readonly sources: readonly FlagResizeSourcePlan[];
    readonly supportedSourceCount: number;
    readonly unsupportedFileNames: readonly string[];
    readonly skippedMediumCount: number;
    readonly skippedSmallCount: number;
}

export interface FlagResizeFailure {
    readonly fileName: string;
    readonly message: string;
}

export interface FlagResizeResult {
    readonly sourceCount: number;
    readonly unsupportedCount: number;
    readonly generatedMediumCount: number;
    readonly generatedSmallCount: number;
    readonly skippedMediumCount: number;
    readonly skippedSmallCount: number;
    readonly failures: readonly FlagResizeFailure[];
}

const flagSizes: Record<FlagVariant, FlagSize> = {
    medium: { width: 41, height: 26 },
    small: { width: 10, height: 7 },
};

const supportedFlagExtensions = new Set(['.tga', '.png']);
const flagVariantFolders = new Set<FlagVariant>(['medium', 'small']);

export function registerResizeFlagsCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(Commands.ResizeFlags, resizeFlagsCommand);
}

export function isSupportedFlagImageName(fileName: string): boolean {
    return supportedFlagExtensions.has(path.posix.extname(fileName).toLowerCase());
}

export function createFlagResizePlan(
    baseFileNames: readonly string[],
    mediumFileNames: readonly string[],
    smallFileNames: readonly string[],
): FlagResizePlan {
    const mediumNames = toCaseInsensitiveSet(mediumFileNames);
    const smallNames = toCaseInsensitiveSet(smallFileNames);
    const unsupportedFileNames: string[] = [];
    const sources: FlagResizeSourcePlan[] = [];
    let supportedSourceCount = 0;
    let skippedMediumCount = 0;
    let skippedSmallCount = 0;

    for (const fileName of [...baseFileNames].sort((a, b) => a.localeCompare(b))) {
        if (!isSupportedFlagImageName(fileName)) {
            unsupportedFileNames.push(fileName);
            continue;
        }

        supportedSourceCount++;
        const normalizedName = fileName.toLowerCase();
        const targets: FlagVariant[] = [];

        if (mediumNames.has(normalizedName)) {
            skippedMediumCount++;
        } else {
            targets.push('medium');
        }

        if (smallNames.has(normalizedName)) {
            skippedSmallCount++;
        } else {
            targets.push('small');
        }

        if (targets.length > 0) {
            sources.push({ fileName, targets });
        }
    }

    return {
        sources,
        supportedSourceCount,
        unsupportedFileNames,
        skippedMediumCount,
        skippedSmallCount,
    };
}

export function resizeFlagImageBuffer(buffer: Buffer, fileName: string, size: FlagSize): Buffer {
    const resized = resizeRgbaImage(decodeFlagImage(buffer, fileName), size.width, size.height);
    return encodeFlagImage(resized, fileName);
}

export function resizeRgbaImage(source: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
    if (targetWidth <= 0 || targetHeight <= 0) {
        throw new Error(`Invalid target size: ${targetWidth}x${targetHeight}`);
    }

    const targetData = Buffer.alloc(targetWidth * targetHeight * 4);
    const scaleX = source.width / targetWidth;
    const scaleY = source.height / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
        const sourceY = (y + 0.5) * scaleY - 0.5;
        const baseY = Math.floor(sourceY);

        for (let x = 0; x < targetWidth; x++) {
            const sourceX = (x + 0.5) * scaleX - 0.5;
            const baseX = Math.floor(sourceX);
            const accum = [0, 0, 0, 0];
            let weightTotal = 0;

            for (let yy = -1; yy <= 2; yy++) {
                const sampleY = clampInteger(baseY + yy, 0, source.height - 1);
                const weightY = cubicWeight(sourceY - (baseY + yy));

                for (let xx = -1; xx <= 2; xx++) {
                    const sampleX = clampInteger(baseX + xx, 0, source.width - 1);
                    const weight = weightY * cubicWeight(sourceX - (baseX + xx));
                    const sourceOffset = (sampleY * source.width + sampleX) * 4;

                    for (let channel = 0; channel < 4; channel++) {
                        accum[channel] += source.data[sourceOffset + channel] * weight;
                    }
                    weightTotal += weight;
                }
            }

            const targetOffset = (y * targetWidth + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                targetData[targetOffset + channel] = clampByte(Math.round(accum[channel] / weightTotal));
            }
        }
    }

    return {
        width: targetWidth,
        height: targetHeight,
        data: targetData,
    };
}

export async function resizeFlagsInDirectory(flagsDirectory: vscode.Uri): Promise<FlagResizeResult> {
    await mkdirs(vscode.Uri.joinPath(flagsDirectory, 'medium'));
    await mkdirs(vscode.Uri.joinPath(flagsDirectory, 'small'));

    const plan = createFlagResizePlan(
        await readDirFiles(flagsDirectory),
        await readDirFiles(vscode.Uri.joinPath(flagsDirectory, 'medium')),
        await readDirFiles(vscode.Uri.joinPath(flagsDirectory, 'small')),
    );

    let generatedMediumCount = 0;
    let generatedSmallCount = 0;
    const failures: FlagResizeFailure[] = [];

    for (const sourcePlan of plan.sources) {
        let sourceBuffer: Buffer;
        try {
            sourceBuffer = await readFile(vscode.Uri.joinPath(flagsDirectory, sourcePlan.fileName));
        } catch (e) {
            failures.push({ fileName: sourcePlan.fileName, message: forceError(e).message });
            continue;
        }

        for (const target of sourcePlan.targets) {
            try {
                const resized = resizeFlagImageBuffer(sourceBuffer, sourcePlan.fileName, flagSizes[target]);
                await writeFile(vscode.Uri.joinPath(flagsDirectory, target, sourcePlan.fileName), resized);
                if (target === 'medium') {
                    generatedMediumCount++;
                } else {
                    generatedSmallCount++;
                }
            } catch (e) {
                failures.push({ fileName: `${target}/${sourcePlan.fileName}`, message: forceError(e).message });
            }
        }
    }

    return {
        sourceCount: plan.supportedSourceCount,
        unsupportedCount: plan.unsupportedFileNames.length,
        generatedMediumCount,
        generatedSmallCount,
        skippedMediumCount: plan.skippedMediumCount,
        skippedSmallCount: plan.skippedSmallCount,
        failures,
    };
}

async function resizeFlagsCommand(resource?: vscode.Uri): Promise<void> {
    const flagsDirectory = await resolveFlagsDirectory(resource);
    if (!flagsDirectory) {
        return;
    }

    const directoryLabel = getDirectoryLabel(flagsDirectory);
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: localize('flagautoresizer.progress', 'Resize HOI4 flags'),
            cancellable: false,
        },
        () => resizeFlagsInDirectory(flagsDirectory),
    );

    if (result.sourceCount === 0) {
        void vscode.window.showWarningMessage(localize(
            'flagautoresizer.nosources',
            'No supported .tga or .png flag files were found in {0}.',
            directoryLabel,
        ));
        return;
    }

    const message = buildResultMessage(result, directoryLabel);
    if (result.failures.length > 0) {
        void vscode.window.showWarningMessage(message);
    } else {
        void vscode.window.showInformationMessage(message);
    }
}

async function resolveFlagsDirectory(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    const resourceDirectory = resource ? await inferFlagsDirectoryFromResource(resource) : undefined;
    if (resourceDirectory) {
        return resourceDirectory;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeDirectory = activeUri ? await inferFlagsDirectoryFromResource(activeUri) : undefined;
    if (activeDirectory) {
        return activeDirectory;
    }

    const candidates = await findWorkspaceFlagsDirectories();
    if (candidates.length === 1) {
        return candidates[0];
    }

    if (candidates.length > 1) {
        const picked = await vscode.window.showQuickPick(
            candidates.map(uri => ({
                label: getDirectoryLabel(uri),
                description: vscode.workspace.getWorkspaceFolder(uri)?.name,
                uri,
            })),
            {
                placeHolder: localize('flagautoresizer.pickdirectory', 'Select a gfx/flags folder to resize flag images.'),
            },
        );
        return picked?.uri;
    }

    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: localize('flagautoresizer.opendirectory', 'Select flags folder'),
        openLabel: localize('flagautoresizer.opendirectory', 'Select flags folder'),
    });

    return selected?.[0];
}

async function inferFlagsDirectoryFromResource(resource: vscode.Uri): Promise<vscode.Uri | undefined> {
    const resourceDirectory = await isDirectory(resource) ? resource : dirUri(resource);
    const folderName = uriBasename(resourceDirectory).toLowerCase();

    if (flagVariantFolders.has(folderName as FlagVariant)) {
        const parent = dirUri(resourceDirectory);
        return uriBasename(parent).toLowerCase() === 'flags' ? parent : undefined;
    }

    return folderName === 'flags' ? resourceDirectory : undefined;
}

async function findWorkspaceFlagsDirectories(): Promise<vscode.Uri[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const candidates: vscode.Uri[] = [];
    const seen = new Set<string>();

    for (const workspaceFolder of workspaceFolders) {
        const possibleDirectories = [
            workspaceFolder.uri,
            vscode.Uri.joinPath(workspaceFolder.uri, 'gfx', 'flags'),
        ];

        for (const directory of possibleDirectories) {
            if (seen.has(directory.toString())) {
                continue;
            }
            seen.add(directory.toString());

            if (uriBasename(directory).toLowerCase() === 'flags' && await isDirectory(directory)) {
                candidates.push(directory);
            }
        }
    }

    return candidates;
}

function buildResultMessage(result: FlagResizeResult, directoryLabel: string): string {
    const parts = [
        localize(
            'flagautoresizer.generated',
            'Generated {0} medium and {1} small flags in {2}.',
            result.generatedMediumCount,
            result.generatedSmallCount,
            directoryLabel,
        ),
        localize(
            'flagautoresizer.skippedexisting',
            'Skipped {0} existing files.',
            result.skippedMediumCount + result.skippedSmallCount,
        ),
    ];

    if (result.unsupportedCount > 0) {
        parts.push(localize(
            'flagautoresizer.skippedunsupported',
            'Skipped {0} unsupported files.',
            result.unsupportedCount,
        ));
    }

    if (result.failures.length > 0) {
        parts.push(localize(
            'flagautoresizer.failed',
            'Failed {0} files. First failure: {1}',
            result.failures.length,
            `${result.failures[0].fileName}: ${result.failures[0].message}`,
        ));
    }

    return parts.join(' ');
}

function decodeFlagImage(buffer: Buffer, fileName: string): RgbaImage {
    const extension = path.posix.extname(fileName).toLowerCase();
    if (extension === '.png') {
        const png = PNG.sync.read(buffer);
        return {
            width: png.width,
            height: png.height,
            data: png.data,
        };
    }

    if (extension === '.tga') {
        const tga = new TGA(buffer);
        if (!tga.pixels) {
            throw new UserError('Unsupported tga format');
        }

        return {
            width: tga.width,
            height: tga.height,
            data: tga.pixels,
        };
    }

    throw new UserError(`Unsupported image type: ${extension || fileName}`);
}

function encodeFlagImage(image: RgbaImage, fileName: string): Buffer {
    const extension = path.posix.extname(fileName).toLowerCase();
    if (extension === '.png') {
        const png = new PNG({ width: image.width, height: image.height });
        png.data = Buffer.from(image.data);
        return PNG.sync.write(png);
    }

    if (extension === '.tga') {
        return TGA.createTgaBuffer(image.width, image.height, image.data);
    }

    throw new UserError(`Unsupported image type: ${extension || fileName}`);
}

function getDirectoryLabel(uri: vscode.Uri): string {
    return vscode.workspace.getWorkspaceFolder(uri)
        ? getRelativePathInWorkspace(uri)
        : uri.fsPath;
}

function toCaseInsensitiveSet(values: readonly string[]): Set<string> {
    return new Set(values.map(value => value.toLowerCase()));
}

function uriBasename(uri: vscode.Uri): string {
    return path.posix.basename(uri.path);
}

function cubicWeight(distance: number): number {
    const x = Math.abs(distance);
    const a = -0.5;
    if (x <= 1) {
        return (a + 2) * x * x * x - (a + 3) * x * x + 1;
    }
    if (x < 2) {
        return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
    }
    return 0;
}

function clampInteger(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function clampByte(value: number): number {
    return clampInteger(value, 0, 255);
}
