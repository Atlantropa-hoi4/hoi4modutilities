import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../constants';
import { Node, parseHoi4File } from '../hoiformat/hoiparser';
import { getSpriteTypes } from '../hoiformat/spritetype';
import { localize } from './i18n';
import { getDocumentByUri, getRelativePathInWorkspace, isFile, readDirFiles, readFile } from './vsccommon';

export interface ShineSpriteCandidate {
    name: string;
    texturefile: string;
}

interface ShineUpdatePlan {
    addedEntries: ShineSpriteCandidate[];
    skippedExistingCount: number;
    content: string;
}

interface ResolvedShinePaths {
    sourceUri: vscode.Uri;
    targetUri: vscode.Uri;
}

const goalsInterfaceFolder = 'interface';

export function registerGenerateFocusGfxShineCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(Commands.GenerateFocusGfxShine, generateFocusGfxShine);
}

export function isShineGfxPath(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('_shine.gfx');
}

export function isGoalsLikeGfxPath(filePath: string): boolean {
    const normalized = normalizeRelativePath(filePath);
    const basename = path.posix.basename(normalized).toLowerCase();
    return basename.endsWith('.gfx') && basename.includes('goals');
}

export function isGoalsLikeSourceGfxPath(filePath: string): boolean {
    return isGoalsLikeGfxPath(filePath) && !isShineGfxPath(filePath);
}

export function deriveShineTargetRelativePath(sourceRelativePath: string): string {
    const parsed = path.posix.parse(normalizeRelativePath(sourceRelativePath));
    return path.posix.join(parsed.dir, `${parsed.name}_shine${parsed.ext}`);
}

export function deriveSourceRelativePathFromShine(targetRelativePath: string): string {
    const normalized = normalizeRelativePath(targetRelativePath);
    if (!isShineGfxPath(normalized)) {
        return normalized;
    }

    return normalized.slice(0, -'_shine.gfx'.length) + '.gfx';
}

export function extractShineSpriteCandidates(content: string, fileLabel: string): ShineSpriteCandidate[] {
    const spriteTypes = getSpriteTypes(parseHoi4File(content, localize('infile', 'In file {0}:\n', fileLabel)));
    return spriteTypes
        .filter(sprite => !!sprite.name && !!sprite.texturefile)
        .filter(sprite => !sprite.name.toLowerCase().endsWith('_shine'))
        .map(sprite => ({
            name: sprite.name,
            texturefile: sprite.texturefile,
        }));
}

export function buildShineUpdatePlan(sourceContent: string, targetContent: string | undefined, sourceLabel: string, targetLabel: string): ShineUpdatePlan {
    const sourceEntries = extractShineSpriteCandidates(sourceContent, sourceLabel);
    const existingShineNames = new Set(
        targetContent
            ? extractAllSpriteNames(targetContent, targetLabel)
            : [],
    );
    const addedEntries = sourceEntries.filter(sprite => !existingShineNames.has(`${sprite.name}_shine`));
    const skippedExistingCount = sourceEntries.length - addedEntries.length;

    if (!targetContent) {
        return {
            addedEntries,
            skippedExistingCount,
            content: addedEntries.length > 0 ? buildNewTargetContent(addedEntries) : '',
        };
    }

    return {
        addedEntries,
        skippedExistingCount,
        content: addedEntries.length > 0
            ? appendEntriesToTargetContent(targetContent, addedEntries, targetLabel)
            : targetContent,
    };
}

async function generateFocusGfxShine(): Promise<void> {
    const resolved = await resolveShinePaths();
    if (!resolved) {
        return;
    }

    const sourceDocument = getDocumentByUri(resolved.sourceUri);
    const sourceContent = sourceDocument?.getText() ?? (await readFile(resolved.sourceUri)).toString('utf8');

    let targetContent: string | undefined;
    let targetExists = false;
    let targetDocument = getDocumentByUri(resolved.targetUri);
    if (targetDocument) {
        targetContent = targetDocument.getText();
        targetExists = true;
    } else if (await isFile(resolved.targetUri)) {
        targetDocument = await vscode.workspace.openTextDocument(resolved.targetUri);
        targetContent = targetDocument.getText();
        targetExists = true;
    }

    const sourceLabel = getRelativePathInWorkspace(resolved.sourceUri);
    const targetLabel = getRelativePathInWorkspace(resolved.targetUri);
    const plan = buildShineUpdatePlan(sourceContent, targetContent, sourceLabel, targetLabel);

    if (plan.addedEntries.length === 0) {
        void vscode.window.showInformationMessage(localize(
            'focusgfxshine.nochanges',
            'No new focus shine entries were needed for {0}. Skipped {1} existing entries.',
            targetLabel,
            plan.skippedExistingCount,
        ));
        return;
    }

    let targetDocumentForEdit = targetDocument;
    if (!targetExists) {
        const createEdit = new vscode.WorkspaceEdit();
        createEdit.createFile(resolved.targetUri, { ignoreIfExists: true });
        const created = await vscode.workspace.applyEdit(createEdit);
        if (!created) {
            void vscode.window.showErrorMessage(localize('focusgfxshine.applyfailed', 'VS Code refused the focus GFX shine edit.'));
            return;
        }

        targetDocumentForEdit = await vscode.workspace.openTextDocument(resolved.targetUri);
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        resolved.targetUri,
        new vscode.Range(
            new vscode.Position(0, 0),
            targetExists && targetDocumentForEdit
                ? targetDocumentForEdit.positionAt(targetContent!.length)
                : new vscode.Position(0, 0),
        ),
        plan.content,
    );

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        void vscode.window.showErrorMessage(localize('focusgfxshine.applyfailed', 'VS Code refused the focus GFX shine edit.'));
        return;
    }

    void vscode.window.showInformationMessage(localize(
        'focusgfxshine.success',
        'Added {0} focus shine entries to {1}. Skipped {2} existing entries.',
        plan.addedEntries.length,
        targetLabel,
        plan.skippedExistingCount,
    ));
}

async function resolveShinePaths(): Promise<ResolvedShinePaths | undefined> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeUri);
        if (activeWorkspace && activeUri.path.toLowerCase().endsWith('.gfx')) {
            const relativePath = getRelativePathInWorkspace(activeUri);
            if (isShineGfxPath(relativePath)) {
                const sourceUri = vscode.Uri.joinPath(activeWorkspace.uri, deriveSourceRelativePathFromShine(relativePath));
                if (!await isFile(sourceUri)) {
                    void vscode.window.showErrorMessage(localize(
                        'focusgfxshine.missingsource',
                        'Unable to find the source GFX file for {0}.',
                        relativePath,
                    ));
                    return undefined;
                }

                return { sourceUri, targetUri: activeUri };
            }

            return {
                sourceUri: activeUri,
                targetUri: vscode.Uri.joinPath(activeWorkspace.uri, deriveShineTargetRelativePath(relativePath)),
            };
        }
    }

    const candidates = await findGoalsGfxCandidates();
    if (candidates.length === 0) {
        void vscode.window.showErrorMessage(localize(
            'focusgfxshine.nocandidate',
            'No workspace focus GFX source file was found. Open a workspace .gfx file or add {0}.',
            'an interface/*goals*.gfx file',
        ));
        return undefined;
    }

    const sourceUri = candidates.length === 1 ? candidates[0] : await pickSourceUri(candidates);
    if (!sourceUri) {
        return undefined;
    }

    const sourceWorkspace = vscode.workspace.getWorkspaceFolder(sourceUri);
    if (!sourceWorkspace) {
        void vscode.window.showErrorMessage(localize('focusgfxshine.workspaceonly', 'The selected focus GFX file must be inside the workspace.'));
        return undefined;
    }

    return {
        sourceUri,
        targetUri: vscode.Uri.joinPath(sourceWorkspace.uri, deriveShineTargetRelativePath(getRelativePathInWorkspace(sourceUri))),
    };
}

async function findGoalsGfxCandidates(): Promise<vscode.Uri[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const results = await Promise.all(workspaceFolders.map(async folder => {
        const interfaceFolder = vscode.Uri.joinPath(folder.uri, goalsInterfaceFolder);
        try {
            const files = await readDirFiles(interfaceFolder);
            return files
                .filter(file => isGoalsLikeSourceGfxPath(file))
                .map(file => vscode.Uri.joinPath(interfaceFolder, file));
        } catch {
            return [];
        }
    }));
    return results.flat();
}

async function pickSourceUri(candidates: vscode.Uri[]): Promise<vscode.Uri | undefined> {
    const picked = await vscode.window.showQuickPick(
        candidates.map(candidate => ({
            label: getRelativePathInWorkspace(candidate),
            description: vscode.workspace.getWorkspaceFolder(candidate)?.name,
            uri: candidate,
        })),
        {
            placeHolder: localize('focusgfxshine.picksource', 'Select the source focus GFX file to generate shine entries from.'),
        },
    );

    return picked?.uri;
}

function appendEntriesToTargetContent(targetContent: string, entries: ShineSpriteCandidate[], targetLabel: string): string {
    const parsed = parseHoi4File(targetContent, localize('infile', 'In file {0}:\n', targetLabel));
    const spriteTypesBlock = findFirstTopLevelSpriteTypesBlock(parsed);
    if (!spriteTypesBlock || spriteTypesBlock.valueEndToken === null) {
        return appendSpriteTypesBlock(targetContent, entries);
    }

    const insertion = `${targetContent.slice(0, spriteTypesBlock.valueEndToken.start).replace(/\s*$/, '')}\n\n${entries.map(renderShineSpriteType).join('\n\n')}\n${targetContent.slice(spriteTypesBlock.valueEndToken.start)}`;
    return ensureTrailingNewline(insertion);
}

function appendSpriteTypesBlock(targetContent: string, entries: ShineSpriteCandidate[]): string {
    const trimmedEnd = targetContent.replace(/\s*$/, '');
    const separator = trimmedEnd.length > 0 ? '\n\n' : '';
    return ensureTrailingNewline(`${trimmedEnd}${separator}${buildSpriteTypesBlock(entries)}`);
}

function buildNewTargetContent(entries: ShineSpriteCandidate[]): string {
    return ensureTrailingNewline(buildSpriteTypesBlock(entries));
}

function buildSpriteTypesBlock(entries: ShineSpriteCandidate[]): string {
    return `spriteTypes = {\n${entries.map(renderShineSpriteType).join('\n\n')}\n}`;
}

function renderShineSpriteType(entry: ShineSpriteCandidate): string {
    return [
        '    SpriteType = {',
        `        name = "${entry.name}_shine"`,
        `        texturefile = "${entry.texturefile}"`,
        '        effectFile = "gfx/FX/buttonstate.lua"',
        '        animation = {',
        `            animationmaskfile = "${entry.texturefile}"`,
        '            animationtexturefile = "gfx/interface/goals/shine_overlay.dds"',
        '            animationrotation = -90.0',
        '            animationlooping = no',
        '            animationtime = 0.75',
        '            animationdelay = 0',
        '            animationblendmode = "add"',
        '            animationtype = "scrolling"',
        '            animationrotationoffset = { x = 0.0 y = 0.0 }',
        '            animationtexturescale = { x = 1.0 y = 1.0 }',
        '        }',
        '',
        '        animation = {',
        `            animationmaskfile = "${entry.texturefile}"`,
        '            animationtexturefile = "gfx/interface/goals/shine_overlay.tga"',
        '            animationrotation = 90.0',
        '            animationlooping = no',
        '            animationtime = 0.75',
        '            animationdelay = 0',
        '            animationblendmode = "add"',
        '            animationtype = "scrolling"',
        '            animationrotationoffset = { x = 0.0 y = 0.0 }',
        '            animationtexturescale = { x = 1.0 y = 1.0 }',
        '        }',
        '        legacy_lazy_load = no',
        '    }',
    ].join('\n');
}

function findFirstTopLevelSpriteTypesBlock(root: Node): Node | undefined {
    if (!Array.isArray(root.value)) {
        return undefined;
    }

    return root.value.find(node => node.name?.toLowerCase() === 'spritetypes');
}

function ensureTrailingNewline(content: string): string {
    return content.endsWith('\n') ? content : `${content}\n`;
}

function extractAllSpriteNames(content: string, fileLabel: string): string[] {
    return getSpriteTypes(parseHoi4File(content, localize('infile', 'In file {0}:\n', fileLabel)))
        .filter(sprite => !!sprite.name)
        .map(sprite => sprite.name);
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\+/g, '/');
}
