import * as vscode from 'vscode';
import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { FocusTreeCreateMeta, TextRange } from "./positioneditcommon";
import { collectFocusPositionFileMetadata } from "./positioneditmetadata";

interface ScalarFieldMeta {
    nodeRange: TextRange;
    valueRange: TextRange;
}

interface FocusNodeMeta {
    focusId: string;
    sourceRange: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    relativePositionId?: ScalarFieldMeta;
    currentRelativePositionId?: string;
    prerequisiteIds: string[];
    prerequisiteFields: FocusReferenceFieldMeta[];
    exclusiveIds: string[];
    exclusiveFields: FocusReferenceFieldMeta[];
    linkInsertAnchorStart?: number;
    firstOffsetStart?: number;
}

interface FocusReferenceFieldMeta {
    range: TextRange;
    focusIds: string[];
    hasOrWrapper: boolean;
    fieldName: string;
}

export interface FocusPositionTextChange {
    range: TextRange;
    text: string;
}

export interface FocusPositionTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface CreateFocusTemplateTextChangeResult {
    changes?: FocusPositionTextChange[];
    placeholderRange?: TextRange;
    error?: string;
}

export interface FocusLinkTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface FocusExclusiveLinkTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface FocusDeleteTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export function buildFocusPositionTextChanges(
    content: string,
    focusId: string,
    targetLocalX: number,
    targetLocalY: number,
): FocusPositionTextChangeResult {
    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
    const matches = collectEditableFocuses(root)
        .map(meta => shiftFocusMeta(meta, bomOffset))
        .filter(meta => meta.focusId === focusId);
    if (matches.length === 0) {
        return { error: `Focus ${focusId} is not editable in the current file.` };
    }

    if (matches.length > 1) {
        return { error: `Focus ${focusId} is ambiguous in the current file.` };
    }

    const focus = matches[0];
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
    if (result.error) {
        return { error: result.error };
    }

    const changes = result.changes ?? [];
    if (changes.length === 0) {
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

export function buildCreateFocusTemplateTextChanges(
    content: string,
    filePath: string,
    treeEditKey: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
): CreateFocusTemplateTextChangeResult {
    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
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
    const change = createFocusTemplateInsertionChange(
        content,
        treeMeta,
        Math.round(targetAbsoluteX),
        Math.round(targetAbsoluteY),
        lineEnding,
        existingFocusIds,
    );

    return {
        changes: [change.change],
        placeholderRange: change.placeholderRange,
    };
}

export function buildCreateFocusTemplateWorkspaceEdit(
    document: vscode.TextDocument,
    filePath: string,
    treeEditKey: string,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
): { edit?: vscode.WorkspaceEdit; placeholderRange?: TextRange; error?: string } {
    const result = buildCreateFocusTemplateTextChanges(
        document.getText(),
        filePath,
        treeEditKey,
        targetAbsoluteX,
        targetAbsoluteY,
    );
    if (result.error) {
        return { error: result.error };
    }

    const change = result.changes?.[0];
    if (!change) {
        return {};
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(change.range.start), document.positionAt(change.range.end)),
        change.text,
    );

    return {
        edit,
        placeholderRange: result.placeholderRange,
    };
}

export function buildFocusLinkTextChanges(
    content: string,
    parentFocusId: string,
    childFocusId: string,
    targetLocalX?: number,
    targetLocalY?: number,
): FocusLinkTextChangeResult {
    if (parentFocusId === childFocusId) {
        return { error: 'A focus cannot be linked to itself.' };
    }

    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
    const matches = collectEditableFocuses(root)
        .map(meta => shiftFocusMeta(meta, bomOffset))
        .filter(meta => meta.focusId === childFocusId);
    if (matches.length === 0) {
        return { error: `Focus ${childFocusId} is not editable in the current file.` };
    }

    if (matches.length > 1) {
        return { error: `Focus ${childFocusId} is ambiguous in the current file.` };
    }

    const child = matches[0];
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [];
    const hasExistingPrerequisiteLink = child.prerequisiteIds.includes(parentFocusId);
    const hasExistingRelativePositionLink = child.currentRelativePositionId === parentFocusId;

    if (hasExistingPrerequisiteLink || hasExistingRelativePositionLink) {
        if (targetLocalX !== undefined && targetLocalY !== undefined) {
            ensureScalarField(changes, content, child.sourceRange, child.x, 'x', `${Math.round(targetLocalX)}`, lineEnding, child.firstOffsetStart);
            ensureScalarField(changes, content, child.sourceRange, child.y, 'y', `${Math.round(targetLocalY)}`, lineEnding, child.firstOffsetStart);
        }
        removeNamedFocusReferences(changes, content, child.prerequisiteFields, parentFocusId, lineEnding);
        if (hasExistingRelativePositionLink && child.relativePositionId) {
            changes.push({
                range: expandRangeToWholeLines(content, child.relativePositionId.nodeRange),
                text: '',
            });
        }

        return {
            changes: dedupeChanges(changes),
        };
    }

    if (targetLocalX !== undefined && targetLocalY !== undefined) {
        ensureScalarField(changes, content, child.sourceRange, child.x, 'x', `${Math.round(targetLocalX)}`, lineEnding, child.firstOffsetStart);
        ensureScalarField(changes, content, child.sourceRange, child.y, 'y', `${Math.round(targetLocalY)}`, lineEnding, child.firstOffsetStart);
    }
    ensurePrerequisiteLink(changes, content, child, parentFocusId, lineEnding);
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
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildFocusLinkTextChanges(document.getText(), parentFocusId, childFocusId, targetLocalX, targetLocalY);
    if (result.error) {
        return { error: result.error };
    }

    const changes = result.changes ?? [];
    if (changes.length === 0) {
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

export function buildFocusExclusiveLinkTextChanges(
    content: string,
    sourceFocusId: string,
    targetFocusId: string,
): FocusExclusiveLinkTextChangeResult {
    if (sourceFocusId === targetFocusId) {
        return { error: 'A focus cannot be linked to itself.' };
    }

    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
    const editableFocuses = collectEditableFocuses(root)
        .map(meta => shiftFocusMeta(meta, bomOffset));
    const sourceMatches = editableFocuses.filter(meta => meta.focusId === sourceFocusId);
    if (sourceMatches.length === 0) {
        return { error: `Focus ${sourceFocusId} is not editable in the current file.` };
    }

    if (sourceMatches.length > 1) {
        return { error: `Focus ${sourceFocusId} is ambiguous in the current file.` };
    }

    const targetMatches = editableFocuses.filter(meta => meta.focusId === targetFocusId);
    if (targetMatches.length === 0) {
        return { error: `Focus ${targetFocusId} is not editable in the current file.` };
    }

    if (targetMatches.length > 1) {
        return { error: `Focus ${targetFocusId} is ambiguous in the current file.` };
    }

    const source = sourceMatches[0];
    const target = targetMatches[0];
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
    if (result.error) {
        return { error: result.error };
    }

    const changes = result.changes ?? [];
    if (changes.length === 0) {
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

export function buildDeleteFocusTextChanges(
    content: string,
    focusId: string,
): FocusDeleteTextChangeResult {
    const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
    const parseContent = bomOffset > 0 ? content.slice(bomOffset) : content;
    const root = parseHoi4File(parseContent);
    const editableFocuses = collectEditableFocuses(root).map(meta => shiftFocusMeta(meta, bomOffset));
    const matches = editableFocuses.filter(meta => meta.focusId === focusId);
    if (matches.length === 0) {
        return { error: `Focus ${focusId} is not editable in the current file.` };
    }

    if (matches.length > 1) {
        return { error: `Focus ${focusId} is ambiguous in the current file.` };
    }

    const deletedFocus = matches[0];
    const lineEnding = detectLineEnding(content);
    const changes: FocusPositionTextChange[] = [{
        range: expandRangeToWholeLines(content, deletedFocus.sourceRange, true),
        text: '',
    }];

    for (const focus of editableFocuses) {
        if (focus.focusId === focusId) {
            continue;
        }

        removeDeletedFocusReferences(changes, content, focus, focusId, lineEnding);
    }

    return {
        changes: dedupeChanges(changes),
    };
}

export function buildDeleteFocusWorkspaceEdit(
    document: vscode.TextDocument,
    focusId: string,
): { edit?: vscode.WorkspaceEdit; error?: string } {
    const result = buildDeleteFocusTextChanges(document.getText(), focusId);
    if (result.error) {
        return { error: result.error };
    }

    const changes = result.changes ?? [];
    if (changes.length === 0) {
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

function createFocusTemplateInsertionChange(
    content: string,
    treeMeta: FocusTreeCreateMeta,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    lineEnding: string,
    existingFocusIds: Set<string>,
): { change: FocusPositionTextChange; placeholderRange: TextRange } {
    const blockName = treeMeta.kind === 'shared'
        ? 'shared_focus'
        : treeMeta.kind === 'joint'
            ? 'joint_focus'
            : 'focus';
    const placeholder = createUniquePlaceholderId(`${treeMeta.focusIdPrefix ?? 'TAG'}_FOCUS_ID`, existingFocusIds);
    const blockText = treeMeta.kind === 'focus'
        ? buildNestedFocusTemplateBlock(content, treeMeta.sourceRange!, blockName, placeholder, targetAbsoluteX, targetAbsoluteY, lineEnding)
        : buildTopLevelFocusTemplateBlock(content, treeMeta.sourceRange!, blockName, placeholder, targetAbsoluteX, targetAbsoluteY, lineEnding);

    const placeholderOffset = blockText.text.indexOf(placeholder);
    return {
        change: {
            range: { start: blockText.insertPosition, end: blockText.insertPosition },
            text: blockText.text,
        },
        placeholderRange: {
            start: blockText.insertPosition + placeholderOffset,
            end: blockText.insertPosition + placeholderOffset + placeholder.length,
        },
    };
}

function buildNestedFocusTemplateBlock(
    content: string,
    blockRange: TextRange,
    blockName: string,
    placeholder: string,
    x: number,
    y: number,
    lineEnding: string,
): { insertPosition: number; text: string } {
    const insertPosition = getBlockClosingLineStart(content, blockRange);
    const { childIndent } = getBlockIndentation(content, blockRange);
    const indentUnit = inferIndentUnit(content, getLineIndent(content, blockRange.start), blockRange);
    const nestedIndent = childIndent + indentUnit;
    const separator = getBlankLineSeparatorBeforeInsert(content, insertPosition, lineEnding);
    const text =
        `${separator}${childIndent}${blockName} = {${lineEnding}` +
        `${nestedIndent}id = ${placeholder}${lineEnding}` +
        `${nestedIndent}icon = GFX${lineEnding}` +
        `${nestedIndent}cost = 1${lineEnding}` +
        `${lineEnding}` +
        `${nestedIndent}x = ${x}${lineEnding}` +
        `${nestedIndent}y = ${y}${lineEnding}` +
        `${lineEnding}` +
        `${nestedIndent}completion_reward = {${lineEnding}` +
        `${nestedIndent}}${lineEnding}` +
        `${childIndent}}${lineEnding}`;
    return {
        insertPosition,
        text,
    };
}

function buildTopLevelFocusTemplateBlock(
    content: string,
    blockRange: TextRange,
    blockName: string,
    placeholder: string,
    x: number,
    y: number,
    lineEnding: string,
): { insertPosition: number; text: string } {
    const insertPosition = blockRange.end;
    const blockIndent = getLineIndent(content, blockRange.start);
    const indentUnit = inferIndentUnit(content, blockIndent, blockRange);
    const childIndent = blockIndent + indentUnit;
    const prefix = getBlankLineSeparatorAtBoundary(content, insertPosition, lineEnding);
    const suffix = insertPosition >= content.length ? lineEnding : '';
    const text =
        `${prefix}${blockName} = {${lineEnding}` +
        `${childIndent}id = ${placeholder}${lineEnding}` +
        `${childIndent}icon = GFX${lineEnding}` +
        `${childIndent}cost = 1${lineEnding}` +
        `${lineEnding}` +
        `${childIndent}x = ${x}${lineEnding}` +
        `${childIndent}y = ${y}${lineEnding}` +
        `${lineEnding}` +
        `${childIndent}completion_reward = {${lineEnding}` +
        `${childIndent}}${lineEnding}` +
        `${blockIndent}}${suffix}`;
    return {
        insertPosition,
        text,
    };
}

function collectEditableFocuses(root: Node): FocusNodeMeta[] {
    if (!Array.isArray(root.value)) {
        return [];
    }

    const result: FocusNodeMeta[] = [];
    for (const child of root.value) {
        const childName = child.name?.toLowerCase();
        if (!childName || !Array.isArray(child.value)) {
            continue;
        }

        if (childName === 'focus_tree') {
            for (const focusNode of child.value.filter(isNamedBlock('focus'))) {
                const meta = collectFocusMeta(focusNode);
                if (meta) {
                    result.push(meta);
                }
            }
            continue;
        }

        if (childName === 'shared_focus' || childName === 'joint_focus') {
            const meta = collectFocusMeta(child);
            if (meta) {
                result.push(meta);
            }
        }
    }

    return result;
}

function collectFocusMeta(node: Node): FocusNodeMeta | undefined {
    const focusId = readStringChildValue(node, 'id');
    if (!focusId) {
        return undefined;
    }

    return {
        focusId,
        sourceRange: createNodeRange(node),
        x: collectScalarField(node, 'x'),
        y: collectScalarField(node, 'y'),
        relativePositionId: collectScalarField(node, 'relative_position_id'),
        currentRelativePositionId: readStringChildValue(node, 'relative_position_id'),
        prerequisiteIds: collectNamedFocusReferenceIds(node, 'prerequisite'),
        prerequisiteFields: collectFocusReferenceFields(node, 'prerequisite'),
        exclusiveIds: collectNamedFocusReferenceIds(node, 'mutually_exclusive'),
        exclusiveFields: collectFocusReferenceFields(node, 'mutually_exclusive'),
        linkInsertAnchorStart: findLinkInsertAnchorStart(node),
        firstOffsetStart: findFirstOffsetStart(node),
    };
}

function shiftFocusMeta(meta: FocusNodeMeta, offset: number): FocusNodeMeta {
    if (offset === 0) {
        return meta;
    }

    return {
        ...meta,
        sourceRange: shiftRange(meta.sourceRange, offset),
        x: meta.x ? shiftScalarField(meta.x, offset) : undefined,
        y: meta.y ? shiftScalarField(meta.y, offset) : undefined,
        relativePositionId: meta.relativePositionId ? shiftScalarField(meta.relativePositionId, offset) : undefined,
        prerequisiteFields: meta.prerequisiteFields.map(field => ({
            ...field,
            range: shiftRange(field.range, offset),
        })),
        exclusiveFields: meta.exclusiveFields.map(field => ({
            ...field,
            range: shiftRange(field.range, offset),
        })),
        firstOffsetStart: meta.firstOffsetStart !== undefined ? meta.firstOffsetStart + offset : undefined,
        linkInsertAnchorStart: meta.linkInsertAnchorStart !== undefined ? meta.linkInsertAnchorStart + offset : undefined,
    };
}

function shiftTreeMeta(meta: FocusTreeCreateMeta, offset: number): FocusTreeCreateMeta {
    if (offset === 0) {
        return meta;
    }

    return {
        ...meta,
        sourceRange: meta.sourceRange ? shiftRange(meta.sourceRange, offset) : undefined,
    };
}

function shiftScalarField(meta: ScalarFieldMeta, offset: number): ScalarFieldMeta {
    return {
        nodeRange: shiftRange(meta.nodeRange, offset),
        valueRange: shiftRange(meta.valueRange, offset),
    };
}

function shiftRange(range: TextRange, offset: number): TextRange {
    return {
        start: range.start + offset,
        end: range.end + offset,
    };
}

function collectScalarField(node: Node, fieldName: string): ScalarFieldMeta | undefined {
    const child = findNamedChild(node, fieldName);
    if (!child || !child.nameToken || !child.valueStartToken || !child.valueEndToken) {
        return undefined;
    }

    return {
        nodeRange: createNodeRange(child),
        valueRange: {
            start: child.valueStartToken.start,
            end: child.valueEndToken.end,
        },
    };
}

function ensureScalarField(
    changes: FocusPositionTextChange[],
    content: string,
    blockRange: TextRange,
    fieldMeta: ScalarFieldMeta | undefined,
    fieldName: string,
    valueText: string,
    lineEnding: string,
    firstOffsetStart?: number,
): void {
    if (fieldMeta) {
        changes.push({
            range: fieldMeta.valueRange,
            text: valueText,
        });
        return;
    }

    const insertPosition = firstOffsetStart !== undefined
        ? getLineStart(content, firstOffsetStart)
        : getBlockClosingLineStart(content, blockRange);
    const { childIndent } = getBlockIndentation(content, blockRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: `${childIndent}${fieldName} = ${valueText}${lineEnding}`,
    });
}

function ensurePrerequisiteLink(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    parentFocusId: string,
    lineEnding: string,
): void {
    if (focus.prerequisiteIds.includes(parentFocusId)) {
        return;
    }

    const insertPosition = getLinkInsertPosition(content, focus);
    const { childIndent } = getBlockIndentation(content, focus.sourceRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: `${childIndent}prerequisite = { focus = ${parentFocusId} }${lineEnding}`,
    });
}

function ensureRelativePositionIdLink(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    parentFocusId: string,
    lineEnding: string,
): void {
    if (focus.relativePositionId) {
        if (focus.currentRelativePositionId === parentFocusId) {
            return;
        }

        changes.push({
            range: focus.relativePositionId.valueRange,
            text: parentFocusId,
        });
        return;
    }

    const insertPosition = getLinkInsertPosition(content, focus);
    const { childIndent } = getBlockIndentation(content, focus.sourceRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: `${childIndent}relative_position_id = ${parentFocusId}${lineEnding}`,
    });
}

function ensureExclusiveLink(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    targetFocusId: string,
    lineEnding: string,
): void {
    if (focus.exclusiveIds.includes(targetFocusId)) {
        return;
    }

    const insertPosition = getLinkInsertPosition(content, focus);
    const { childIndent } = getBlockIndentation(content, focus.sourceRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: `${childIndent}mutually_exclusive = { focus = ${targetFocusId} }${lineEnding}`,
    });
}

function removeDeletedFocusReferences(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    deletedFocusId: string,
    lineEnding: string,
): void {
    removeNamedFocusReferences(changes, content, focus.prerequisiteFields, deletedFocusId, lineEnding);
    removeNamedFocusReferences(changes, content, focus.exclusiveFields, deletedFocusId, lineEnding);

    if (focus.currentRelativePositionId === deletedFocusId && focus.relativePositionId) {
        changes.push({
            range: expandRangeToWholeLines(content, focus.relativePositionId.nodeRange),
            text: '',
        });
    }
}

function dedupeChanges(changes: FocusPositionTextChange[]): FocusPositionTextChange[] {
    const seen = new Map<string, FocusPositionTextChange>();
    for (const change of changes) {
        const key = `${change.range.start}:${change.range.end}`;
        const existing = seen.get(key);
        if (!existing) {
            seen.set(key, { ...change });
            continue;
        }

        if (change.range.start === change.range.end) {
            existing.text += change.text;
        } else {
            seen.set(key, { ...change });
        }
    }

    return Array.from(seen.values()).sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
}

function removeNamedFocusReferences(
    changes: FocusPositionTextChange[],
    content: string,
    fields: FocusReferenceFieldMeta[],
    focusId: string,
    lineEnding: string,
): void {
    for (const field of fields.filter(currentField => currentField.focusIds.includes(focusId))) {
        const remainingIds = field.focusIds.filter(id => id !== focusId);
        const range = expandRangeToWholeLines(content, field.range);
        changes.push({
            range,
            text: remainingIds.length === 0
                ? ''
                : buildFocusReferenceFieldReplacement(content, field.range, field.fieldName, remainingIds, field.hasOrWrapper, lineEnding),
        });
    }
}

function isNamedBlock(expectedName: string) {
    return (node: Node): boolean => node.name?.toLowerCase() === expectedName && Array.isArray(node.value);
}

function findNamedChild(node: Node, expectedName: string): Node | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    return node.value.find(child => child.name?.toLowerCase() === expectedName);
}

function findFirstOffsetStart(node: Node): number | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    const offsetNode = node.value.find(child => child.name?.toLowerCase() === 'offset');
    return offsetNode?.nameToken?.start ?? offsetNode?.valueStartToken?.start ?? undefined;
}

function findLinkInsertAnchorStart(node: Node): number | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    const anchorNode = node.value.find(child => {
        const childName = child.name?.toLowerCase();
        return childName === 'relative_position_id'
            || childName === 'x'
            || childName === 'y'
            || childName === 'offset'
            || childName === 'completion_reward'
            || childName === 'mutually_exclusive'
            || childName === 'allow_branch';
    });
    return anchorNode?.nameToken?.start ?? anchorNode?.valueStartToken?.start ?? undefined;
}

function collectNamedFocusReferenceIds(node: Node, fieldName: string): string[] {
    if (!Array.isArray(node.value)) {
        return [];
    }

    const result = new Set<string>();
    node.value
        .filter(child => child.name?.toLowerCase() === fieldName)
        .forEach(child => collectFocusReferenceIds(child, result));
    return Array.from(result);
}

function collectFocusReferenceFields(node: Node, fieldName: string): FocusReferenceFieldMeta[] {
    if (!Array.isArray(node.value)) {
        return [];
    }

    return node.value
        .filter(child => child.name?.toLowerCase() === fieldName)
        .map(child => {
            const focusIds = new Set<string>();
            collectFocusReferenceIds(child, focusIds);
            return {
                range: createNodeRange(child),
                focusIds: Array.from(focusIds),
                hasOrWrapper: Array.isArray(child.value) && child.value.some(grandChild => grandChild.name?.toLowerCase() === 'or'),
                fieldName,
            };
        });
}

function collectFocusReferenceIds(node: Node, result: Set<string>): void {
    const nodeName = node.name?.toLowerCase();
    if (nodeName === 'focus') {
        const focusId = readNodeStringValue(node);
        if (focusId) {
            result.add(focusId);
        }
    }

    if (!Array.isArray(node.value)) {
        return;
    }

    node.value.forEach(child => collectFocusReferenceIds(child, result));
}

function readStringChildValue(node: Node, fieldName: string): string | undefined {
    const child = findNamedChild(node, fieldName);
    if (!child) {
        return undefined;
    }

    return readNodeStringValue(child);
}

function readNodeStringValue(node: Node): string | undefined {
    if (typeof node.value === 'string') {
        return node.value;
    }

    if (typeof node.value === 'object' && node.value !== null && 'name' in node.value) {
        return node.value.name;
    }

    return undefined;
}

function createNodeRange(node: Node): TextRange {
    return {
        start: node.nameToken?.start ?? node.valueStartToken?.start ?? 0,
        end: node.valueEndToken?.end ?? node.valueStartToken?.end ?? node.nameToken?.end ?? 0,
    };
}

function getLineStart(content: string, index: number): number {
    const lineBreak = content.lastIndexOf('\n', Math.max(0, index - 1));
    return lineBreak === -1 ? 0 : lineBreak + 1;
}

function getPreviousLineStart(content: string, index: number): number {
    if (index <= 0) {
        return 0;
    }

    const currentLineStart = getLineStart(content, index);
    if (currentLineStart <= 0) {
        return 0;
    }

    return getLineStart(content, currentLineStart - 1);
}

function getNextLineStart(content: string, index: number): number {
    const lineBreak = content.indexOf('\n', index);
    return lineBreak === -1 ? content.length : lineBreak + 1;
}

function getBlockClosingLineStart(content: string, blockRange: TextRange): number {
    const closingBraceIndex = Math.max(blockRange.start, blockRange.end - 1);
    return getLineStart(content, closingBraceIndex);
}

function getLinkInsertPosition(content: string, focus: FocusNodeMeta): number {
    return focus.linkInsertAnchorStart !== undefined
        ? getLineStart(content, focus.linkInsertAnchorStart)
        : getBlockClosingLineStart(content, focus.sourceRange);
}

function expandRangeToWholeLines(content: string, range: TextRange, includeLeadingBlankLine: boolean = false): TextRange {
    let start = getLineStart(content, range.start);
    const end = getNextLineStart(content, range.end);

    if (includeLeadingBlankLine && start > 0) {
        const previousLineStart = getPreviousLineStart(content, start);
        const previousLineText = content.slice(previousLineStart, start);
        if (previousLineText.trim() === '') {
            start = previousLineStart;
        }
    }

    return { start, end };
}

function getLineIndent(content: string, index: number): string {
    const lineStart = getLineStart(content, index);
    const nextLineBreak = content.indexOf('\n', lineStart);
    const line = content.slice(lineStart, nextLineBreak === -1 ? content.length : nextLineBreak);
    const match = /^[\t ]*/.exec(line);
    return match?.[0] ?? '';
}

function inferIndentUnit(content: string, blockIndent: string, blockRange: TextRange): string {
    const nextLineStart = content.indexOf('\n', blockRange.start);
    if (nextLineStart !== -1 && nextLineStart + 1 < blockRange.end) {
        const nextIndent = getLineIndent(content, nextLineStart + 1);
        if (nextIndent.startsWith(blockIndent) && nextIndent.length > blockIndent.length) {
            return nextIndent.slice(blockIndent.length);
        }
    }

    return blockIndent.includes('\t') ? '\t' : '    ';
}

function buildFocusReferenceFieldReplacement(
    content: string,
    fieldRange: TextRange,
    fieldName: string,
    remainingIds: string[],
    hasOrWrapper: boolean,
    lineEnding: string,
): string {
    const blockIndent = getLineIndent(content, fieldRange.start);
    const indentUnit = inferIndentUnit(content, blockIndent, fieldRange);
    const childIndent = blockIndent + indentUnit;
    if (hasOrWrapper) {
        const focusIndent = childIndent + indentUnit;
        return `${blockIndent}${fieldName} = {${lineEnding}` +
            `${childIndent}OR = {${lineEnding}` +
            remainingIds.map(id => `${focusIndent}focus = ${id}${lineEnding}`).join('') +
            `${childIndent}}${lineEnding}` +
            `${blockIndent}}${lineEnding}`;
    }

    if (remainingIds.length === 1) {
        return `${blockIndent}${fieldName} = { focus = ${remainingIds[0]} }${lineEnding}`;
    }

    return `${blockIndent}${fieldName} = {${lineEnding}` +
        remainingIds.map(id => `${childIndent}focus = ${id}${lineEnding}`).join('') +
        `${blockIndent}}${lineEnding}`;
}

function getBlockIndentation(content: string, blockRange: TextRange): { childIndent: string } {
    const blockIndent = getLineIndent(content, blockRange.start);
    const closeLineStart = getBlockClosingLineStart(content, blockRange);
    const closingIndentEnd = content.indexOf('}', closeLineStart);
    const closingIndent = content.slice(closeLineStart, closingIndentEnd === -1 ? closeLineStart : closingIndentEnd);
    const indentUnit = inferIndentUnit(content, blockIndent, blockRange);

    return {
        childIndent: (closingIndent || blockIndent) + indentUnit,
    };
}

function detectLineEnding(content: string): string {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function createUniquePlaceholderId(baseId: string, existingFocusIds: Set<string>): string {
    if (!existingFocusIds.has(baseId)) {
        return baseId;
    }

    let index = 2;
    let candidate = `${baseId}_${index}`;
    while (existingFocusIds.has(candidate)) {
        index++;
        candidate = `${baseId}_${index}`;
    }

    return candidate;
}

function getBlankLineSeparatorBeforeInsert(content: string, insertPosition: number, lineEnding: string): string {
    let cursor = Math.max(0, insertPosition);
    while (cursor > 0 && (content[cursor - 1] === '\n' || content[cursor - 1] === '\r')) {
        cursor--;
    }

    const lineStart = getLineStart(content, cursor);
    const previousLine = content.slice(lineStart, cursor).trim();
    return previousLine.length === 0 ? '' : lineEnding;
}

function getBlankLineSeparatorAtBoundary(content: string, insertPosition: number, lineEnding: string): string {
    const previousNeedsSpacing = getBlankLineSeparatorBeforeInsert(content, insertPosition, lineEnding);
    if (previousNeedsSpacing === '') {
        return lineEnding;
    }

    return `${lineEnding}${lineEnding}`;
}
