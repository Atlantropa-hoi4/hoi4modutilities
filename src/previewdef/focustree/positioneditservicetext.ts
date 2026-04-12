import { FocusTreeCreateMeta, TextRange } from "./positioneditcommon";
import { FocusNodeMeta, FocusPositionTextChange, FocusReferenceFieldMeta } from "./positioneditservicetypes";

export function ensureScalarField(
    changes: FocusPositionTextChange[],
    content: string,
    blockRange: TextRange,
    fieldMeta: FocusNodeMeta['x'] | undefined,
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

export function ensurePrerequisiteLink(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    parentFocusIds: readonly string[],
    lineEnding: string,
    matchingField?: FocusReferenceFieldMeta,
): void {
    if (matchingField) {
        const mergedIds = Array.from(new Set([...matchingField.focusIds, ...parentFocusIds]));
        if (mergedIds.length === matchingField.focusIds.length) {
            return;
        }

        changes.push({
            range: expandRangeToWholeLines(content, matchingField.range),
            text: buildFocusReferenceFieldReplacement(content, matchingField.range, matchingField.fieldName, mergedIds, matchingField.hasOrWrapper, lineEnding),
        });
        return;
    }

    const insertPosition = getLinkInsertPosition(content, focus);
    const { childIndent } = getBlockIndentation(content, focus.sourceRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: buildInsertedFocusReferenceField(childIndent, 'prerequisite', parentFocusIds, lineEnding),
    });
}

export function ensureRelativePositionIdLink(
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

export function ensureExclusiveLink(
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

export function removeDeletedFocusReferences(
    changes: FocusPositionTextChange[],
    content: string,
    focus: FocusNodeMeta,
    deletedFocusIds: string | ReadonlySet<string>,
    lineEnding: string,
): void {
    const deletedFocusIdSet = typeof deletedFocusIds === 'string'
        ? new Set([deletedFocusIds])
        : deletedFocusIds;
    removeNamedFocusReferencesForSet(changes, content, focus.prerequisiteFields, deletedFocusIdSet, lineEnding);
    removeNamedFocusReferencesForSet(changes, content, focus.exclusiveFields, deletedFocusIdSet, lineEnding);

    if (focus.currentRelativePositionId && deletedFocusIdSet.has(focus.currentRelativePositionId) && focus.relativePositionId) {
        changes.push({
            range: expandRangeToWholeLines(content, focus.relativePositionId.nodeRange),
            text: '',
        });
    }
}

export function removeNamedFocusReferences(
    changes: FocusPositionTextChange[],
    content: string,
    fields: FocusReferenceFieldMeta[],
    focusId: string,
    lineEnding: string,
): void {
    removeNamedFocusReferencesForSet(changes, content, fields, new Set([focusId]), lineEnding);
}

export function dedupeChanges(changes: FocusPositionTextChange[]): FocusPositionTextChange[] {
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

export function expandRangeToWholeLines(content: string, range: TextRange, includeLeadingBlankLine: boolean = false): TextRange {
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

export function detectLineEnding(content: string): string {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

export function createFocusTemplateInsertionChange(
    content: string,
    treeMeta: FocusTreeCreateMeta,
    targetAbsoluteX: number,
    targetAbsoluteY: number,
    lineEnding: string,
    existingFocusIds: Set<string>,
): { change: FocusPositionTextChange; placeholderId: string; placeholderRange: TextRange } {
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
        placeholderId: placeholder,
        placeholderRange: {
            start: blockText.insertPosition + placeholderOffset,
            end: blockText.insertPosition + placeholderOffset + placeholder.length,
        },
    };
}

export function createContinuousFocusInsertionChange(
    content: string,
    focusTreeRange: TextRange,
    x: number,
    y: number,
    lineEnding: string,
): FocusPositionTextChange {
    const insertPosition = getBlockClosingLineStart(content, focusTreeRange);
    const { childIndent } = getBlockIndentation(content, focusTreeRange);
    const indentUnit = inferIndentUnit(content, getLineIndent(content, focusTreeRange.start), focusTreeRange);
    const nestedIndent = childIndent + indentUnit;
    const separator = getBlankLineSeparatorBeforeInsert(content, insertPosition, lineEnding);
    return {
        range: { start: insertPosition, end: insertPosition },
        text:
            `${separator}${childIndent}continuous_focus_position = {${lineEnding}` +
            `${nestedIndent}x = ${x}${lineEnding}` +
            `${nestedIndent}y = ${y}${lineEnding}` +
            `${childIndent}}${lineEnding}`,
    };
}

function removeNamedFocusReferencesForSet(
    changes: FocusPositionTextChange[],
    content: string,
    fields: FocusReferenceFieldMeta[],
    focusIds: ReadonlySet<string>,
    lineEnding: string,
): void {
    for (const field of fields.filter(currentField => currentField.focusIds.some(id => focusIds.has(id)))) {
        const remainingIds = field.focusIds.filter(id => !focusIds.has(id));
        const range = expandRangeToWholeLines(content, field.range);
        changes.push({
            range,
            text: remainingIds.length === 0
                ? ''
                : buildFocusReferenceFieldReplacement(content, field.range, field.fieldName, remainingIds, field.hasOrWrapper, lineEnding),
        });
    }
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

function inferIndentUnitFromIndent(indent: string): string {
    const tabMatch = /(\t+)$/.exec(indent);
    if (tabMatch?.[1]) {
        return '\t';
    }

    const spaceMatch = /( +)$/.exec(indent);
    if (spaceMatch?.[1]) {
        return spaceMatch[1];
    }

    return '    ';
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

function buildInsertedFocusReferenceField(
    childIndent: string,
    fieldName: string,
    focusIds: readonly string[],
    lineEnding: string,
): string {
    if (focusIds.length === 1) {
        return `${childIndent}${fieldName} = { focus = ${focusIds[0]} }${lineEnding}`;
    }

    const indentUnit = inferIndentUnitFromIndent(childIndent);
    const focusIndent = childIndent + indentUnit;
    return `${childIndent}${fieldName} = {${lineEnding}` +
        focusIds.map(id => `${focusIndent}focus = ${id}${lineEnding}`).join('') +
        `${childIndent}}${lineEnding}`;
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
