import { Node, parseHoi4File } from '../../hoiformat/hoiparser';
import { getGridBoxItemPosition } from '../../util/hoi4gui/gridboxcommon';
import { TechnologyEditRenderContext, TechnologyGridEditLayout, TechnologyPositionEdit, TextRange } from './editcommon';
import {
    TechnologyFileMetadata,
    TechnologyFolderSourceMeta,
    TechnologyReferenceMeta,
    TechnologySourceMeta,
    collectTechnologyFileMetadata,
} from './editmetadata';

export interface TechnologyTextChange {
    range: TextRange;
    text: string;
}

export type TechnologyEditOptions = TechnologyEditRenderContext;

export interface TechnologyTextChangeResult {
    changes?: TechnologyTextChange[];
    error?: string;
    referenceCount?: number;
}

interface ParsedTechnologyContext {
    root: Node;
    metadata: TechnologyFileMetadata;
}

interface ValidatedTechnologyPositionTarget {
    technology: TechnologySourceMeta;
    folder: TechnologyFolderSourceMeta;
    layout: TechnologyGridEditLayout;
    treeRoot: string;
    x: number;
    y: number;
}

export function buildTechnologyPositionTextChanges(
    content: string,
    filePath: string,
    folderName: string,
    edits: readonly TechnologyPositionEdit[],
    options: TechnologyEditOptions,
): TechnologyTextChangeResult {
    if (edits.length === 0) {
        return {};
    }
    const context = parseTechnologyContext(content, filePath);
    const changes: TechnologyTextChange[] = [];
    const seen = new Set<string>();
    const targets: ValidatedTechnologyPositionTarget[] = [];

    for (const requestedEdit of edits) {
        if (!Number.isFinite(requestedEdit.x) || !Number.isFinite(requestedEdit.y)) {
            return { error: 'Technology positions must use finite numeric coordinates.' };
        }
        if (seen.has(requestedEdit.editKey)) {
            return { error: `Technology position ${requestedEdit.editKey} was requested more than once.` };
        }
        seen.add(requestedEdit.editKey);
        const technologyResult = findUniqueTechnology(context.metadata, requestedEdit.technologyId);
        if (technologyResult.error) {
            return { error: technologyResult.error };
        }
        const technology = technologyResult.technology!;
        const folder = technology.folders.find(candidate => candidate.editKey === requestedEdit.editKey);
        if (!folder || folder.name !== folderName || !folder.editable) {
            return { error: `Technology ${requestedEdit.technologyId} does not have an editable position for the selected folder.` };
        }
        const grid = findTechnologyGrid(options, folderName, requestedEdit.technologyId);
        if (grid.error) {
            return { error: grid.error };
        }
        const x = Math.round(requestedEdit.x);
        const y = Math.round(requestedEdit.y);
        if (!isTechnologyPositionWithinGrid(grid.layout!, x, y)) {
            return { error: `Technology ${requestedEdit.technologyId} position (${x}, ${y}) is outside the selected GUI grid.` };
        }
        targets.push({ technology, folder, layout: grid.layout!, treeRoot: grid.treeRoot!, x, y });
    }

    const collisionError = validateTechnologyPositionCollisions(context.metadata, folderName, targets, options);
    if (collisionError) {
        return { error: collisionError };
    }
    for (const target of targets) {
        changes.push(...buildFolderPositionChanges(content, target.folder, target.x, target.y));
    }
    return { changes: dedupeChanges(changes) };
}

export function buildTechnologyPathTextChanges(
    content: string,
    filePath: string,
    sourceTechnologyId: string,
    targetTechnologyId: string,
    folder: string,
    options: TechnologyEditOptions,
): TechnologyTextChangeResult {
    if (sourceTechnologyId === targetTechnologyId) {
        return { error: 'A technology cannot lead to itself.' };
    }
    const context = parseTechnologyContext(content, filePath);
    const sourceResult = findUniqueTechnology(context.metadata, sourceTechnologyId);
    const targetResult = findUniqueTechnology(context.metadata, targetTechnologyId);
    if (sourceResult.error || targetResult.error) {
        return { error: sourceResult.error ?? targetResult.error };
    }
    const source = sourceResult.technology!;
    const target = targetResult.technology!;
    if (!hasFolder(source, folder) || !hasFolder(target, folder)) {
        return { error: 'Path links can only be edited between technologies visible in the selected folder.' };
    }

    const existing = source.paths.filter(reference => reference.id === targetTechnologyId);
    if (existing.length > 0) {
        const orphanError = getOrphanError(
            context.metadata.technologies,
            [targetTechnologyId],
            new Set(),
            new Set([edgeKey(sourceTechnologyId, targetTechnologyId)]),
            options,
        );
        if (orphanError) {
            return { error: orphanError };
        }
        return { changes: removeReferenceChanges(content, existing), referenceCount: existing.length };
    }

    if (canReach(context.metadata.technologies, targetTechnologyId, sourceTechnologyId)) {
        return { error: `Linking ${sourceTechnologyId} to ${targetTechnologyId} would create a technology path cycle.` };
    }
    return {
        changes: [insertTechnologyField(content, source, `path = { leads_to_tech = ${targetTechnologyId} }`)],
    };
}

export function buildTechnologyXorTextChanges(
    content: string,
    filePath: string,
    sourceTechnologyId: string,
    targetTechnologyId: string,
    folder: string,
): TechnologyTextChangeResult {
    if (sourceTechnologyId === targetTechnologyId) {
        return { error: 'A technology cannot be mutually exclusive with itself.' };
    }
    const context = parseTechnologyContext(content, filePath);
    const sourceResult = findUniqueTechnology(context.metadata, sourceTechnologyId);
    const targetResult = findUniqueTechnology(context.metadata, targetTechnologyId);
    if (sourceResult.error || targetResult.error) {
        return { error: sourceResult.error ?? targetResult.error };
    }
    const source = sourceResult.technology!;
    const target = targetResult.technology!;
    if (!hasFolder(source, folder) || !hasFolder(target, folder)) {
        return { error: 'XOR links can only be edited between technologies visible in the selected folder.' };
    }
    const hasCommonParent = context.metadata.technologies.some(parent =>
        hasFolder(parent, folder)
        && parent.paths.some(reference => reference.id === sourceTechnologyId)
        && parent.paths.some(reference => reference.id === targetTechnologyId));
    if (!hasCommonParent) {
        return { error: 'XOR technologies must share a parent in the selected folder.' };
    }

    const sourceReferences = source.xors.filter(reference => reference.id === targetTechnologyId);
    const targetReferences = target.xors.filter(reference => reference.id === sourceTechnologyId);
    if (sourceReferences.length > 0 && targetReferences.length > 0) {
        return {
            changes: dedupeChanges([
                ...removeReferenceChanges(content, sourceReferences),
                ...removeReferenceChanges(content, targetReferences),
            ]),
            referenceCount: sourceReferences.length + targetReferences.length,
        };
    }

    const changes: TechnologyTextChange[] = [];
    if (sourceReferences.length === 0) {
        changes.push(insertTechnologyField(content, source, `xor = ${targetTechnologyId}`));
    }
    if (targetReferences.length === 0) {
        changes.push(insertTechnologyField(content, target, `xor = ${sourceTechnologyId}`));
    }
    return { changes };
}

export function buildCreateChildTechnologyTextChanges(
    content: string,
    filePath: string,
    parentTechnologyId: string,
    technologyId: string,
    folder: string,
    x: number,
    y: number,
    options: TechnologyEditOptions,
): TechnologyTextChangeResult {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { error: 'Technology positions must use finite numeric coordinates.' };
    }
    if (!isValidTechnologyId(technologyId)) {
        return { error: 'Technology ID must be a non-empty Clausewitz symbol without whitespace or syntax characters.' };
    }
    const context = parseTechnologyContext(content, filePath);
    if (context.metadata.technologies.some(technology => technology.id === technologyId)) {
        return { error: `Technology ${technologyId} already exists in the current file.` };
    }
    const parentResult = findUniqueTechnology(context.metadata, parentTechnologyId);
    if (parentResult.error) {
        return { error: parentResult.error };
    }
    const parent = parentResult.technology!;
    if (!hasFolder(parent, folder)) {
        return { error: `Technology ${parentTechnologyId} is not in folder ${folder}.` };
    }
    const grid = findTechnologyGrid(options, folder, parentTechnologyId);
    if (grid.error) {
        return { error: grid.error };
    }
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    if (!isTechnologyPositionWithinGrid(grid.layout!, roundedX, roundedY)) {
        return { error: `Technology ${technologyId} position (${roundedX}, ${roundedY}) is outside the selected GUI grid.` };
    }
    const occupied = getOccupiedTechnologyPositions(context.metadata, folder, options);
    if (occupied.has(positionKey(grid.treeRoot!, roundedX, roundedY))) {
        return { error: `Technology position (${roundedX}, ${roundedY}) is already occupied in the selected tree.` };
    }

    return {
        changes: [
            insertTechnologyField(content, parent, `path = { leads_to_tech = ${technologyId} }`),
            createTechnologyBlockInsertion(
                content,
                parent,
                technologyId,
                folder,
                roundedX,
                roundedY,
            ),
        ],
    };
}

export function buildDeleteTechnologiesTextChanges(
    content: string,
    filePath: string,
    technologyIds: readonly string[],
    options: TechnologyEditOptions,
): TechnologyTextChangeResult {
    const ids = Array.from(new Set(technologyIds.filter(Boolean)));
    if (ids.length === 0) {
        return {};
    }
    const context = parseTechnologyContext(content, filePath);
    const deleted = new Set(ids);
    const targets: TechnologySourceMeta[] = [];
    for (const id of ids) {
        const result = findUniqueTechnology(context.metadata, id);
        if (result.error) {
            return { error: result.error };
        }
        targets.push(result.technology!);
    }

    const orphanCandidates = new Set<string>();
    for (const technology of targets) {
        technology.paths.forEach(reference => {
            if (!deleted.has(reference.id)) {
                orphanCandidates.add(reference.id);
            }
        });
    }
    const orphanError = getOrphanError(
        context.metadata.technologies,
        Array.from(orphanCandidates),
        deleted,
        new Set(),
        options,
    );
    if (orphanError) {
        return { error: orphanError };
    }

    const changes: TechnologyTextChange[] = targets.map(technology => ({
        range: expandNodeRemovalRange(content, technology.sourceRange, true),
        text: '',
    }));
    let referenceCount = 0;
    for (const technology of context.metadata.technologies) {
        if (deleted.has(technology.id)) {
            continue;
        }
        const references = [...technology.paths, ...technology.xors, ...technology.subTechnologies]
            .filter(reference => deleted.has(reference.id));
        referenceCount += references.length;
        changes.push(...removeReferenceChanges(content, references));
    }

    return { changes: dedupeChanges(changes), referenceCount };
}

export function isValidTechnologyId(value: string): boolean {
    return value.length > 0 && !/[\s#={}<>!,;"]/u.test(value);
}

export function applyTechnologyTextChanges(content: string, changes: readonly TechnologyTextChange[]): string {
    let result = content;
    const ordered = [...changes].sort((left, right) => right.range.start - left.range.start || right.range.end - left.range.end);
    for (const change of ordered) {
        result = result.slice(0, change.range.start) + change.text + result.slice(change.range.end);
    }
    return result;
}

function parseTechnologyContext(content: string, filePath: string): ParsedTechnologyContext {
    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const root = parseHoi4File(bomOffset ? content.slice(bomOffset) : content);
    return {
        root,
        metadata: collectTechnologyFileMetadata(root, filePath, bomOffset),
    };
}

function findUniqueTechnology(
    metadata: TechnologyFileMetadata,
    technologyId: string,
): { technology?: TechnologySourceMeta; error?: string } {
    const matches = metadata.technologies.filter(technology => technology.id === technologyId);
    if (matches.length === 0) {
        return { error: `Technology ${technologyId} is not editable in the current file.` };
    }
    if (matches.length > 1) {
        return { error: `Technology ${technologyId} is ambiguous in the current file.` };
    }
    return { technology: matches[0] };
}

function buildFolderPositionChanges(
    content: string,
    folder: TechnologyFolderSourceMeta,
    x: number,
    y: number,
): TechnologyTextChange[] {
    if (!folder.positionRange) {
        return [insertBlockField(content, folder.sourceRange, `position = { x = ${x} y = ${y} }`)];
    }
    const changes: TechnologyTextChange[] = [];
    if (folder.x && folder.xValue !== x) {
        changes.push({ range: folder.x.valueRange, text: `${x}` });
    }
    if (folder.y && folder.yValue !== y) {
        changes.push({ range: folder.y.valueRange, text: `${y}` });
    }
    const missingFields = [
        ...(!folder.x ? [`x = ${x}`] : []),
        ...(!folder.y ? [`y = ${y}`] : []),
    ];
    if (missingFields.length > 0) {
        changes.push(insertBlockField(content, folder.positionRange, missingFields.join(' ')));
    }
    return changes;
}

function insertTechnologyField(content: string, technology: TechnologySourceMeta, fieldText: string): TechnologyTextChange {
    return insertBlockField(content, technology.sourceRange, fieldText);
}

function insertBlockField(content: string, blockRange: TextRange, fieldText: string): TechnologyTextChange {
    const closeBrace = Math.max(blockRange.start, blockRange.end - 1);
    const closeLineStart = getLineStart(content, closeBrace);
    if (content.slice(closeLineStart, closeBrace).trim().length > 0) {
        return { range: { start: closeBrace, end: closeBrace }, text: ` ${fieldText}` };
    }
    return {
        range: { start: closeLineStart, end: closeLineStart },
        text: `${getChildIndent(content, blockRange)}${fieldText}${detectLineEnding(content)}`,
    };
}

function createTechnologyBlockInsertion(
    content: string,
    parent: TechnologySourceMeta,
    technologyId: string,
    folder: string,
    x: number,
    y: number,
): TechnologyTextChange {
    const lineEnding = detectLineEnding(content);
    const closeBrace = Math.max(parent.technologiesRange.start, parent.technologiesRange.end - 1);
    const insertPosition = getLineStart(content, closeBrace);
    const technologyIndent = getLineIndent(content, parent.sourceRange.start);
    const indentUnit = inferIndentUnit(content, technologyIndent, parent.sourceRange);
    const childIndent = technologyIndent + indentUnit;
    const nestedIndent = childIndent + indentUnit;
    if (content.slice(insertPosition, closeBrace).trim().length > 0) {
        return {
            range: { start: closeBrace, end: closeBrace },
            text: ` ${technologyId} = { folder = { name = ${folder} position = { x = ${x} y = ${y} } } }`,
        };
    }
    const separator = getBlankLineSeparatorBeforeInsert(content, insertPosition, lineEnding);
    const text = `${separator}${technologyIndent}${technologyId} = {${lineEnding}`
        + `${childIndent}folder = {${lineEnding}`
        + `${nestedIndent}name = ${folder}${lineEnding}`
        + `${nestedIndent}position = { x = ${x} y = ${y} }${lineEnding}`
        + `${childIndent}}${lineEnding}`
        + `${technologyIndent}}${lineEnding}`;
    return { range: { start: insertPosition, end: insertPosition }, text };
}

function removeReferenceChanges(content: string, references: readonly TechnologyReferenceMeta[]): TechnologyTextChange[] {
    return dedupeChanges(references.map(reference => ({
        range: reference.removeContainer && reference.containerRange
            ? expandNodeRemovalRange(content, reference.containerRange)
            : expandNodeRemovalRange(content, reference.nodeRange),
        text: '',
    })));
}

function findTechnologyGrid(
    options: TechnologyEditOptions,
    folder: string,
    technologyId: string,
): { treeRoot?: string; layout?: TechnologyGridEditLayout; error?: string } {
    const matches = Object.entries(options.gridLayoutsByFolder[folder] ?? {})
        .filter(([, layout]) => Object.prototype.hasOwnProperty.call(layout.positionsByTechnologyId, technologyId));
    if (matches.length === 0) {
        return { error: `Technology ${technologyId} is not assigned to an editable GUI grid in folder ${folder}.` };
    }
    if (matches.length > 1) {
        return { error: `Technology ${technologyId} is assigned to more than one GUI grid in folder ${folder}.` };
    }
    return { treeRoot: matches[0][0], layout: matches[0][1] };
}

function isTechnologyPositionWithinGrid(layout: TechnologyGridEditLayout, x: number, y: number): boolean {
    if (layout.gridSize.width <= 0 || layout.gridSize.height <= 0
        || layout.slotSize.width <= 0 || layout.slotSize.height <= 0) {
        return false;
    }
    const position = getGridBoxItemPosition(x, y, layout.format, layout.slotSize, layout.gridSize);
    return Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && position.x >= 0
        && position.y >= 0
        && position.x + layout.slotSize.width <= layout.gridSize.width
        && position.y + layout.slotSize.height <= layout.gridSize.height;
}

function validateTechnologyPositionCollisions(
    metadata: TechnologyFileMetadata,
    folder: string,
    targets: readonly ValidatedTechnologyPositionTarget[],
    options: TechnologyEditOptions,
): string | undefined {
    const movingTechnologyIds = new Set(targets.map(target => target.technology.id));
    const occupied = getOccupiedTechnologyPositions(metadata, folder, options, movingTechnologyIds);
    const targetKeys = new Set<string>();
    for (const target of targets) {
        const key = positionKey(target.treeRoot, target.x, target.y);
        if (occupied.has(key) || targetKeys.has(key)) {
            return `Technology position (${target.x}, ${target.y}) is already occupied in the selected tree.`;
        }
        targetKeys.add(key);
    }
    return undefined;
}

function getOccupiedTechnologyPositions(
    metadata: TechnologyFileMetadata,
    folder: string,
    options: TechnologyEditOptions,
    excludedTechnologyIds: ReadonlySet<string> = new Set(),
): Set<string> {
    const occupied = new Set<string>();
    const technologiesById = new Map<string, TechnologySourceMeta[]>();
    for (const technology of metadata.technologies) {
        const values = technologiesById.get(technology.id) ?? [];
        values.push(technology);
        technologiesById.set(technology.id, values);
    }

    for (const [treeRoot, layout] of Object.entries(options.gridLayoutsByFolder[folder] ?? {})) {
        for (const [technologyId, renderedPosition] of Object.entries(layout.positionsByTechnologyId)) {
            if (excludedTechnologyIds.has(technologyId)) {
                continue;
            }
            const matches = technologiesById.get(technologyId) ?? [];
            const folderMeta = matches.length === 1
                ? matches[0].folders.find(candidate => candidate.name === folder)
                : undefined;
            const x = folderMeta?.xValue ?? renderedPosition.x;
            const y = folderMeta?.yValue ?? renderedPosition.y;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                occupied.add(positionKey(treeRoot, Math.round(x), Math.round(y)));
            }
        }
    }
    return occupied;
}

function positionKey(treeRoot: string, x: number, y: number): string {
    return `${treeRoot}\u0000${x}\u0000${y}`;
}

function getOrphanError(
    technologies: readonly TechnologySourceMeta[],
    candidateIds: readonly string[],
    deletedIds: ReadonlySet<string>,
    removedEdges: ReadonlySet<string>,
    options: TechnologyEditOptions,
): string | undefined {
    const byId = new Map(technologies.filter(technology => !deletedIds.has(technology.id)).map(technology => [technology.id, technology]));
    for (const candidateId of candidateIds) {
        const technology = byId.get(candidateId);
        if (!technology) {
            continue;
        }
        for (const folder of new Set(technology.folders.map(item => item.name))) {
            const hasIncoming = Array.from(byId.values()).some(parent =>
                hasFolder(parent, folder)
                && parent.paths.some(reference => reference.id === candidateId && !removedEdges.has(edgeKey(parent.id, candidateId))));
            const hasGridbox = options.availableTreeRootsByFolder[folder]?.includes(candidateId) ?? false;
            if (!hasIncoming && !hasGridbox) {
                return `Technology ${candidateId} would become a root without a ${candidateId}_tree GUI gridbox in folder ${folder}.`;
            }
        }
    }
    return undefined;
}

function canReach(technologies: readonly TechnologySourceMeta[], startId: string, targetId: string): boolean {
    const byId = new Map(technologies.map(technology => [technology.id, technology]));
    const pending = [startId];
    const visited = new Set<string>();
    while (pending.length > 0) {
        const current = pending.pop()!;
        if (current === targetId) {
            return true;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);
        byId.get(current)?.paths.forEach(reference => pending.push(reference.id));
    }
    return false;
}

function hasFolder(technology: TechnologySourceMeta, folder: string): boolean {
    return technology.folders.some(candidate => candidate.name === folder);
}

function edgeKey(sourceId: string, targetId: string): string {
    return `${sourceId}\u0000${targetId}`;
}

function expandRangeToWholeLines(content: string, range: TextRange, includeFollowingBlankLine = false): TextRange {
    const start = getLineStart(content, range.start);
    let end = getLineEnd(content, range.end);
    if (end < content.length) {
        end += content.startsWith('\r\n', end) ? 2 : 1;
    }
    if (includeFollowingBlankLine) {
        const followingEnd = getLineEnd(content, end);
        if (content.slice(end, followingEnd).trim().length === 0) {
            end = followingEnd < content.length
                ? followingEnd + (content.startsWith('\r\n', followingEnd) ? 2 : 1)
                : followingEnd;
        }
    }
    return { start, end };
}

function expandNodeRemovalRange(content: string, range: TextRange, includeFollowingBlankLine = false): TextRange {
    const lineStart = getLineStart(content, range.start);
    const lineEnd = getLineEnd(content, range.end);
    const before = content.slice(lineStart, range.start);
    const after = content.slice(range.end, lineEnd);
    if (before.trim().length === 0 && after.trim().length === 0) {
        return expandRangeToWholeLines(content, range, includeFollowingBlankLine);
    }
    let start = range.start;
    let end = range.end;
    while (end < lineEnd && /\s/.test(content[end])) {
        end += 1;
    }
    if (end === range.end) {
        while (start > lineStart && /\s/.test(content[start - 1])) {
            start -= 1;
        }
    }
    return { start, end };
}

function dedupeChanges(changes: readonly TechnologyTextChange[]): TechnologyTextChange[] {
    const result: TechnologyTextChange[] = [];
    const keys = new Set<string>();
    for (const change of changes) {
        const key = `${change.range.start}:${change.range.end}:${change.text}`;
        if (!keys.has(key)) {
            keys.add(key);
            result.push(change);
        }
    }
    return result;
}

function detectLineEnding(content: string): string {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function getLineStart(content: string, offset: number): number {
    const index = content.lastIndexOf('\n', Math.max(0, offset - 1));
    return index === -1 ? 0 : index + 1;
}

function getLineEnd(content: string, offset: number): number {
    const index = content.indexOf('\n', offset);
    return index === -1 ? content.length : (index > 0 && content[index - 1] === '\r' ? index - 1 : index);
}

function getLineIndent(content: string, offset: number): string {
    const start = getLineStart(content, offset);
    return /^\s*/.exec(content.slice(start, getLineEnd(content, start)))?.[0] ?? '';
}

function getChildIndent(content: string, blockRange: TextRange): string {
    const blockIndent = getLineIndent(content, blockRange.start);
    const bodyStart = content.indexOf('\n', blockRange.start);
    if (bodyStart !== -1 && bodyStart < blockRange.end) {
        for (let cursor = bodyStart + 1; cursor < blockRange.end;) {
            const end = getLineEnd(content, cursor);
            const line = content.slice(cursor, end);
            if (line.trim() && !line.trimStart().startsWith('}')) {
                const indent = /^\s*/.exec(line)?.[0] ?? '';
                if (indent.length > blockIndent.length) {
                    return indent;
                }
            }
            cursor = end + (content.startsWith('\r\n', end) ? 2 : 1);
        }
    }
    return blockIndent + inferIndentUnit(content, blockIndent, blockRange);
}

function inferIndentUnit(content: string, parentIndent: string, blockRange: TextRange): string {
    const body = content.slice(blockRange.start, blockRange.end);
    const lines = body.split(/\r?\n/).slice(1);
    for (const line of lines) {
        const indent = /^\s*/.exec(line)?.[0] ?? '';
        if (line.trim() && indent.length > parentIndent.length) {
            return indent.slice(parentIndent.length);
        }
    }
    return parentIndent.includes('\t') ? '\t' : '    ';
}

function getBlankLineSeparatorBeforeInsert(content: string, position: number, lineEnding: string): string {
    const prefix = content.slice(0, position);
    if (prefix.endsWith(lineEnding + lineEnding)) {
        return '';
    }
    return lineEnding;
}
