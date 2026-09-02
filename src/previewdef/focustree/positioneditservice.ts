import * as vscode from 'vscode';
import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { TextRange } from "./positioneditcommon";
import { collectFocusPositionFileMetadata } from "./positioneditmetadata";
import {
    areFocusIdSetsEqual,
    collectEditableFocuses,
    findMatchingPrerequisiteField,
    normalizeParentFocusIds,
    shiftContinuousFocusMeta,
    shiftFocusMeta,
    shiftTreeMeta,
} from "./positioneditserviceparse";
import {
    createContinuousFocusInsertionChange,
    createFocusTemplateInsertionChange,
    dedupeChanges,
    detectLineEnding,
    ensureExclusiveLink,
    ensurePrerequisiteLink,
    ensureRelativePositionIdLink,
    ensureScalarField,
    expandRangeToWholeLines,
    removeDeletedFocusReferences,
    removeNamedFocusReferences,
} from "./positioneditservicetext";
import {
    CreateFocusTemplateTextChangeResult,
    FocusDeleteTextChangeResult,
    FocusExclusiveLinkTextChangeResult,
    FocusLinkTextChangeResult,
    FocusNodeMeta,
    FocusPositionTextChange,
    FocusPositionTextChangeResult,
} from "./positioneditservicetypes";

export type {
    CreateFocusTemplateTextChangeResult,
    FocusDeleteTextChangeResult,
    FocusExclusiveLinkTextChangeResult,
    FocusLinkTextChangeResult,
    FocusPositionTextChange,
    FocusPositionTextChangeResult,
} from "./positioneditservicetypes";

export function buildFocusPositionTextChanges(
    content: string,
    focusId: string,
    targetLocalX: number,
    targetLocalY: number,
): FocusPositionTextChangeResult {
    if (!Number.isFinite(targetLocalX) || !Number.isFinite(targetLocalY)) {
        return { error: 'Focus positions must use finite numeric coordinates.' };
    }
    const { editableFocuses } = parseEditableFocusContext(content);
    const focusResult = findUniqueEditableFocus(editableFocuses, focusId);
    if (focusResult.error) {
        return { error: focusResult.error };
    }

    const focus = focusResult.focus!;
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [];

    ensureScalarField(changes, content, focus.sourceRange, focus.x, 'x', `${Math.round(targetLocalX)}`, lineEnding, focus.firstOffsetStart);
    ensureScalarField(changes, content, focus.sourceRange, focus.y, 'y', `${Math.round(targetLocalY)}`, lineEnding, focus.firstOffsetStart);

    return {
        changes: dedupeChanges(changes),
    };
}

export function applyTextChanges(content: string, changes: FocusPositionTextChange[]): string {
    let result = content;
    const ordered = [...changes].sort((a, b) => b.range.start - a.range.start || b.range.end - a.range.end);
    for (const change of ordered) {
        result = result.slice(0, change.range.start) + change.text + result.slice(change.range.end);
    }
    return result;
}

export function buildFocusPositionWorkspaceEdit(
    document: vscode.TextDocument,
    focusId: string,
    targetLocalX: number,
    targetLocalY: number,
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildFocusPositionTextChanges(document.getText(), focusId, targetLocalX, targetLocalY);
    return buildWorkspaceEditResult(document, result.error, result.changes);
}

export function buildContinuousFocusPositionTextChanges(
    content: string,
    filePath: string,
    treeEditKey: string,
    targetX: number,
    targetY: number,
): FocusPositionTextChangeResult {
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
        return { error: 'Continuous focus positions must use finite numeric coordinates.' };
    }
    const { root, bomOffset } = parseEditableFocusContext(content);
    const continuousMeta = collectFocusPositionFileMetadata(root, filePath).continuousTrees[treeEditKey];
    const shiftedMeta = continuousMeta ? shiftContinuousFocusMeta(continuousMeta, bomOffset) : undefined;
    if (!shiftedMeta || !shiftedMeta.editable) {
        return { error: 'The selected focus tree continuous position is not editable in the current file.' };
    }

    if (!shiftedMeta.focusTreeRange) {
        return { error: 'The selected focus tree has no writable continuous position anchor.' };
    }

    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [];
    if (shiftedMeta.sourceRange) {
        ensureScalarField(changes, content, shiftedMeta.sourceRange, shiftedMeta.x, 'x', `${Math.round(targetX)}`, lineEnding);
        ensureScalarField(changes, content, shiftedMeta.sourceRange, shiftedMeta.y, 'y', `${Math.round(targetY)}`, lineEnding);
    } else {
        changes.push(createContinuousFocusInsertionChange(content, shiftedMeta.focusTreeRange, Math.round(targetX), Math.round(targetY), lineEnding));
    }

    return {
        changes: dedupeChanges(changes),
    };
}

export function buildContinuousFocusPositionWorkspaceEdit(
    document: vscode.TextDocument,
    filePath: string,
    treeEditKey: string,
    targetX: number,
    targetY: number,
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildContinuousFocusPositionTextChanges(
        document.getText(),
        filePath,
        treeEditKey,
        targetX,
        targetY,
    );
    return buildWorkspaceEditResult(document, result.error, result.changes);
}

export function buildCreateFocusTemplateTextChanges(
    content: string,
    filePath: string,
    treeEditKey: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    parentFocusId?: string,
    parentFocusIds?: readonly string[],
    targetLocalX?: number,
    targetLocalY?: number,
): CreateFocusTemplateTextChangeResult {
    if (!Number.isFinite(targetAbsoluteX) || !Number.isFinite(targetAbsoluteY)) {
        return { error: 'Focus positions must use finite numeric coordinates.' };
    }
    if ((targetLocalX !== undefined && !Number.isFinite(targetLocalX))
        || (targetLocalY !== undefined && !Number.isFinite(targetLocalY))) {
        return { error: 'Focus positions must use finite numeric coordinates.' };
    }
    const { root, bomOffset } = parseEditableFocusContext(content);
    const metadata = collectFocusPositionFileMetadata(root, filePath);
    const treeMeta = [
        ...metadata.focusTrees,
        ...(metadata.sharedTree ? [metadata.sharedTree] : []),
        ...(metadata.jointTree ? [metadata.jointTree] : []),
    ]
        .map(meta => shiftTreeMeta(meta, bomOffset))
        .find(meta => meta.editKey === treeEditKey);
    if (!treeMeta) {
        return { error: 'The selected focus tree is not editable in the current file.' };
    }

    if (!treeMeta.sourceRange) {
        return { error: 'The selected focus tree has no writable insertion anchor.' };
    }

    const lineEnding = detectLineEnding(content);
    const existingFocusIds = new Set(collectEditableFocuses(root).map(meta => meta.focusId));
    const normalizedParentFocusIds = parentFocusId
        ? Array.from(new Set((parentFocusIds?.length ? parentFocusIds : [parentFocusId]).filter(Boolean)))
        : [];
    const hasParentRelation = !!parentFocusId && normalizedParentFocusIds.length > 0;
    if (hasParentRelation && (targetLocalX === undefined || targetLocalY === undefined)) {
        return { error: 'A parent-linked focus requires local numeric coordinates.' };
    }
    const change = createFocusTemplateInsertionChange(
        content,
        treeMeta,
        Math.round(hasParentRelation && targetLocalX !== undefined ? targetLocalX : targetAbsoluteX),
        Math.round(hasParentRelation && targetLocalY !== undefined ? targetLocalY : targetAbsoluteY),
        lineEnding,
        existingFocusIds,
        hasParentRelation ? parentFocusId : undefined,
        normalizedParentFocusIds,
    );

    return {
        changes: [change.change],
        placeholderFocusId: change.placeholderId,
        placeholderRange: change.placeholderRange,
    };
}

export function buildCreateFocusTemplateWorkspaceEdit(
    document: vscode.TextDocument,
    filePath: string,
    treeEditKey: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    parentFocusId?: string,
    parentFocusIds?: readonly string[],
    targetLocalX?: number,
    targetLocalY?: number,
): { edit?: vscode.WorkspaceEdit; placeholderFocusId?: string; placeholderRange?: TextRange; error?: string } {
    const result = buildCreateFocusTemplateTextChanges(
        document.getText(),
        filePath,
        treeEditKey,
        targetAbsoluteX,
        targetAbsoluteY,
        parentFocusId,
        parentFocusIds,
        targetLocalX,
        targetLocalY,
    );
    const workspaceEditResult = buildWorkspaceEditResult(document, result.error, result.changes);
    return {
        ...workspaceEditResult,
        placeholderFocusId: result.placeholderFocusId,
        placeholderRange: result.placeholderRange,
    };
}

export function buildFocusLinkTextChanges(
    content: string,
    parentFocusId: string,
    childFocusId: string,
    targetLocalX?: number,
    targetLocalY?: number,
    parentFocusIds?: readonly string[],
): FocusLinkTextChangeResult {
    if ((targetLocalX !== undefined && !Number.isFinite(targetLocalX))
        || (targetLocalY !== undefined && !Number.isFinite(targetLocalY))) {
        return { error: 'Focus positions must use finite numeric coordinates.' };
    }
    const normalizedParentFocusIds = normalizeParentFocusIds(parentFocusId, parentFocusIds, childFocusId);
    if (normalizedParentFocusIds.length === 0) {
        return { error: 'A focus cannot be linked to itself.' };
    }

    const { editableFocuses } = parseEditableFocusContext(content);
    const childResult = findUniqueEditableFocus(editableFocuses, childFocusId);
    if (childResult.error) {
        return { error: childResult.error };
    }

    const child = childResult.focus!;
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [];
    const matchingPrerequisiteField = findMatchingPrerequisiteField(child, normalizedParentFocusIds);
    const hasExactPrerequisiteGroup = !!matchingPrerequisiteField
        && areFocusIdSetsEqual(matchingPrerequisiteField.focusIds, normalizedParentFocusIds);

    if (hasExactPrerequisiteGroup) {
        if (targetLocalX !== undefined && targetLocalY !== undefined) {
            ensureScalarField(changes, content, child.sourceRange, child.x, 'x', `${Math.round(targetLocalX)}`, lineEnding, child.firstOffsetStart);
            ensureScalarField(changes, content, child.sourceRange, child.y, 'y', `${Math.round(targetLocalY)}`, lineEnding, child.firstOffsetStart);
        }
        changes.push({
            range: expandRangeToWholeLines(content, matchingPrerequisiteField.range),
            text: '',
        });
        if (child.relativePositionId
            && child.currentRelativePositionId
            && (child.currentRelativePositionId === parentFocusId || normalizedParentFocusIds.includes(child.currentRelativePositionId))) {
            changes.push({
                range: expandRangeToWholeLines(content, child.relativePositionId.nodeRange),
                text: '',
            });
        }

        return {
            changes: dedupeChanges(changes),
        };
    }

    const existingPrerequisiteIds = new Set(child.prerequisiteIds);
    const cyclicParentId = normalizedParentFocusIds.find(candidateParentId =>
        !existingPrerequisiteIds.has(candidateParentId)
        && canReachFocusPrerequisite(editableFocuses, candidateParentId, childFocusId));
    if (cyclicParentId) {
        return { error: `Linking ${cyclicParentId} as a prerequisite of ${childFocusId} would create a focus prerequisite cycle.` };
    }

    if (targetLocalX !== undefined && targetLocalY !== undefined) {
        ensureScalarField(changes, content, child.sourceRange, child.x, 'x', `${Math.round(targetLocalX)}`, lineEnding, child.firstOffsetStart);
        ensureScalarField(changes, content, child.sourceRange, child.y, 'y', `${Math.round(targetLocalY)}`, lineEnding, child.firstOffsetStart);
    }
    ensurePrerequisiteLink(changes, content, child, normalizedParentFocusIds, lineEnding, matchingPrerequisiteField);
    ensureRelativePositionIdLink(changes, content, child, parentFocusId, lineEnding);

    return {
        changes: dedupeChanges(changes),
    };
}

export function buildFocusLinkWorkspaceEdit(
    document: vscode.TextDocument,
    parentFocusId: string,
    childFocusId: string,
    targetLocalX?: number,
    targetLocalY?: number,
    parentFocusIds?: readonly string[],
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildFocusLinkTextChanges(document.getText(), parentFocusId, childFocusId, targetLocalX, targetLocalY, parentFocusIds);
    return buildWorkspaceEditResult(document, result.error, result.changes);
}

export function buildFocusExclusiveLinkTextChanges(
    content: string,
    sourceFocusId: string,
    targetFocusId: string,
): FocusExclusiveLinkTextChangeResult {
    if (sourceFocusId === targetFocusId) {
        return { error: 'A focus cannot be linked to itself.' };
    }

    const { editableFocuses } = parseEditableFocusContext(content);
    const sourceResult = findUniqueEditableFocus(editableFocuses, sourceFocusId);
    if (sourceResult.error) {
        return { error: sourceResult.error };
    }

    const targetResult = findUniqueEditableFocus(editableFocuses, targetFocusId);
    if (targetResult.error) {
        return { error: targetResult.error };
    }

    const source = sourceResult.focus!;
    const target = targetResult.focus!;
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [];
    const hasExistingExclusiveLink = source.exclusiveIds.includes(targetFocusId)
        || target.exclusiveIds.includes(sourceFocusId);
    if (hasExistingExclusiveLink) {
        removeNamedFocusReferences(changes, content, source.exclusiveFields, targetFocusId, lineEnding);
        removeNamedFocusReferences(changes, content, target.exclusiveFields, sourceFocusId, lineEnding);
        return {
            changes: dedupeChanges(changes),
        };
    }

    ensureExclusiveLink(changes, content, source, targetFocusId, lineEnding);
    ensureExclusiveLink(changes, content, target, sourceFocusId, lineEnding);

    return {
        changes: dedupeChanges(changes),
    };
}

export function buildFocusExclusiveLinkWorkspaceEdit(
    document: vscode.TextDocument,
    sourceFocusId: string,
    targetFocusId: string,
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildFocusExclusiveLinkTextChanges(document.getText(), sourceFocusId, targetFocusId);
    return buildWorkspaceEditResult(document, result.error, result.changes);
}

export function buildDeleteFocusTextChanges(
    content: string,
    focusIdOrFocusIds: string | readonly string[],
): FocusDeleteTextChangeResult {
    const { editableFocuses } = parseEditableFocusContext(content);
    const deletedFocusIds = Array.from(new Set(
        (Array.isArray(focusIdOrFocusIds) ? focusIdOrFocusIds : [focusIdOrFocusIds]).filter(Boolean),
    ));
    if (deletedFocusIds.length === 0) {
        return {};
    }

    const deletedFocuses: FocusNodeMeta[] = [];
    for (const focusId of deletedFocusIds) {
        const focusResult = findUniqueEditableFocus(editableFocuses, focusId);
        if (focusResult.error) {
            return { error: focusResult.error };
        }

        deletedFocuses.push(focusResult.focus!);
    }

    const deletedFocusIdSet = new Set(deletedFocusIds);
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = deletedFocuses.map(deletedFocus => ({
        range: expandRangeToWholeLines(content, deletedFocus.sourceRange, true),
        text: '',
    }));

    for (const focus of editableFocuses) {
        if (deletedFocusIdSet.has(focus.focusId)) {
            continue;
        }

        removeDeletedFocusReferences(changes, content, focus, deletedFocusIdSet, lineEnding);
    }

    return {
        changes: dedupeChanges(changes),
    };
}

export function buildDeleteFocusWorkspaceEdit(
    document: vscode.TextDocument,
    focusIdOrFocusIds: string | readonly string[],
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildDeleteFocusTextChanges(document.getText(), focusIdOrFocusIds);
    return buildWorkspaceEditResult(document, result.error, result.changes);
}

interface ParsedEditableFocusContext {
    bomOffset: number;
    root: Node;
    editableFocuses: FocusNodeMeta[];
}

function parseEditableFocusContext(content: string): ParsedEditableFocusContext {
    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
    const editableFocuses = collectEditableFocuses(root).map(meta => shiftFocusMeta(meta, bomOffset));
    return {
        bomOffset,
        root,
        editableFocuses,
    };
}

function findUniqueEditableFocus(
    editableFocuses: FocusNodeMeta[],
    focusId: string,
): { focus?: FocusNodeMeta; error?: string } {
    const matches = editableFocuses.filter(meta => meta.focusId === focusId);
    if (matches.length === 0) {
        return { error: `Focus ${focusId} is not editable in the current file.` };
    }

    if (matches.length > 1) {
        return { error: `Focus ${focusId} is ambiguous in the current file.` };
    }

    return { focus: matches[0] };
}

function canReachFocusPrerequisite(
    focuses: readonly FocusNodeMeta[],
    startFocusId: string,
    targetFocusId: string,
): boolean {
    const focusesById = new Map(focuses.map(focus => [focus.focusId, focus]));
    const pending = [startFocusId];
    const visited = new Set<string>();
    while (pending.length > 0) {
        const currentFocusId = pending.pop()!;
        if (currentFocusId === targetFocusId) {
            return true;
        }
        if (visited.has(currentFocusId)) {
            continue;
        }
        visited.add(currentFocusId);
        focusesById.get(currentFocusId)?.prerequisiteIds.forEach(focusId => pending.push(focusId));
    }
    return false;
}

function buildWorkspaceEditResult(
    document: vscode.TextDocument,
    error: string | undefined,
    changes: FocusPositionTextChange[] | undefined,
): { edit?: vscode.WorkspaceEdit; error?: string } {
    if (error) {
        return { error };
    }

    if (!changes || changes.length === 0) {
        return {};
    }

    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
        edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(change.range.start), document.positionAt(change.range.end)),
            change.text,
        );
    }

    return { edit };
}
