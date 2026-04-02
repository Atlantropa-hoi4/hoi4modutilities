import * as vscode from 'vscode';
import { Node, Token, parseHoi4File } from "../../hoiformat/hoiparser";
import { FocusLayoutDraft, TextRange, createLayoutEditKey } from "./layouteditcommon";

interface ScalarFieldMeta {
    name: string;
    nodeRange: TextRange;
    valueRange: TextRange;
}

interface OffsetNodeMeta {
    editKey: string;
    nodeRange: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    hasTrigger: boolean;
}

interface FocusNodeMeta {
    editKey: string;
    focusId: string;
    nodeRange: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    relativePositionId?: ScalarFieldMeta;
    offsets: OffsetNodeMeta[];
}

interface PointBlockMeta {
    editKey: string;
    label: string;
    parentNodeRange: TextRange;
    positionNodeRange?: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
}

interface FocusLayoutDocumentMeta {
    focuses: Record<string, FocusNodeMeta | undefined>;
    continuousByKey: Record<string, PointBlockMeta | undefined>;
    inlayRefs: Record<string, PointBlockMeta | undefined>;
}

export interface FocusLayoutTextChange {
    range: TextRange;
    text: string;
}

export function buildFocusLayoutTextChanges(content: string, filePath: string, draft: FocusLayoutDraft): FocusLayoutTextChange[] {
    const root = parseHoi4File(content.replace(/^\uFEFF/, ''));
    const metadata = collectDocumentMeta(root, filePath);
    const changes: FocusLayoutTextChange[] = [];
    const lineEnding = detectLineEnding(content);

    for (const focusDraft of Object.values(draft.focuses)) {
        if (!focusDraft.editable || focusDraft.sourceFile !== filePath) {
            continue;
        }

        const meta = metadata.focuses[focusDraft.editKey];
        if (!meta) {
            continue;
        }

        ensureScalarField(changes, content, meta.nodeRange, meta.x, 'x', formatInteger(focusDraft.x), lineEnding, { beforeOffsets: meta.offsets });
        ensureScalarField(changes, content, meta.nodeRange, meta.y, 'y', formatInteger(focusDraft.y), lineEnding, { beforeOffsets: meta.offsets });

        if (focusDraft.relativePositionId === null || focusDraft.relativePositionId === '') {
            if (meta.relativePositionId) {
                changes.push({
                    range: expandNodeRemovalRange(content, meta.relativePositionId.nodeRange),
                    text: '',
                });
            }
        } else {
            ensureScalarField(changes, content, meta.nodeRange, meta.relativePositionId, 'relative_position_id', focusDraft.relativePositionId, lineEnding, { beforeOffsets: meta.offsets });
        }

        const draftOffsetsByKey = new Map(focusDraft.offsets.filter(offset => !offset.isNew).map(offset => [offset.editKey, offset]));
        for (const existingOffset of meta.offsets) {
            const updatedOffset = draftOffsetsByKey.get(existingOffset.editKey);
            if (!updatedOffset) {
                changes.push({
                    range: expandNodeRemovalRange(content, existingOffset.nodeRange),
                    text: '',
                });
                continue;
            }

            ensureScalarField(changes, content, existingOffset.nodeRange, existingOffset.x, 'x', formatInteger(updatedOffset.x), lineEnding);
            ensureScalarField(changes, content, existingOffset.nodeRange, existingOffset.y, 'y', formatInteger(updatedOffset.y), lineEnding);
        }

        const newOffsets = focusDraft.offsets.filter(offset => offset.isNew);
        if (newOffsets.length > 0) {
            const insertPosition = getBlockClosingLineStart(content, meta.nodeRange);
            const { childIndent, indentUnit } = getBlockIndentation(content, meta.nodeRange);
            const grandChildIndent = childIndent + indentUnit;
            const text = newOffsets.map(offset => {
                return `${childIndent}offset = {${lineEnding}` +
                    `${grandChildIndent}x = ${formatInteger(offset.x)}${lineEnding}` +
                    `${grandChildIndent}y = ${formatInteger(offset.y)}${lineEnding}` +
                    `${childIndent}}${lineEnding}`;
            }).join('');
            changes.push({
                range: { start: insertPosition, end: insertPosition },
                text,
            });
        }
    }

    for (const continuousDraft of Object.values(draft.continuous)) {
        if (!continuousDraft.editable || continuousDraft.sourceFile !== filePath) {
            continue;
        }

        const meta = metadata.continuousByKey[continuousDraft.editKey];
        if (!meta) {
            continue;
        }

        ensurePointPosition(changes, content, meta, continuousDraft.x, continuousDraft.y, lineEnding);
    }

    for (const inlayDraft of Object.values(draft.inlayRefs)) {
        if (!inlayDraft.editable || inlayDraft.sourceFile !== filePath) {
            continue;
        }

        const meta = metadata.inlayRefs[inlayDraft.editKey];
        if (!meta) {
            continue;
        }

        ensurePointPosition(changes, content, meta, inlayDraft.x, inlayDraft.y, lineEnding);
    }

    return dedupeChanges(changes);
}

export function applyTextChanges(content: string, changes: FocusLayoutTextChange[]): string {
    let result = content;
    const ordered = [...changes].sort((a, b) => b.range.start - a.range.start || b.range.end - a.range.end);
    for (const change of ordered) {
        result = result.slice(0, change.range.start) + change.text + result.slice(change.range.end);
    }
    return result;
}

export function buildFocusLayoutWorkspaceEdit(document: vscode.TextDocument, draft: FocusLayoutDraft, filePath: string): vscode.WorkspaceEdit | undefined {
    const changes = buildFocusLayoutTextChanges(document.getText(), filePath, draft);
    if (changes.length === 0) {
        return undefined;
    }

    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
        edit.replace(document.uri, new vscode.Range(document.positionAt(change.range.start), document.positionAt(change.range.end)), change.text);
    }
    return edit;
}

function ensurePointPosition(
    changes: FocusLayoutTextChange[],
    content: string,
    meta: PointBlockMeta,
    x: number,
    y: number,
    lineEnding: string,
): void {
    if (meta.positionNodeRange) {
        ensureScalarField(changes, content, meta.positionNodeRange, meta.x, 'x', formatInteger(x), lineEnding);
        ensureScalarField(changes, content, meta.positionNodeRange, meta.y, 'y', formatInteger(y), lineEnding);
        return;
    }

    const insertPosition = getBlockClosingLineStart(content, meta.parentNodeRange);
    const { childIndent, indentUnit } = getBlockIndentation(content, meta.parentNodeRange);
    const grandChildIndent = childIndent + indentUnit;
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text:
            `${childIndent}position = {${lineEnding}` +
            `${grandChildIndent}x = ${formatInteger(x)}${lineEnding}` +
            `${grandChildIndent}y = ${formatInteger(y)}${lineEnding}` +
            `${childIndent}}${lineEnding}`,
    });
}

function ensureScalarField(
    changes: FocusLayoutTextChange[],
    content: string,
    blockRange: TextRange,
    fieldMeta: ScalarFieldMeta | undefined,
    fieldName: string,
    valueText: string,
    lineEnding: string,
    options: { beforeOffsets?: OffsetNodeMeta[] } = {},
): void {
    if (fieldMeta) {
        changes.push({
            range: fieldMeta.valueRange,
            text: valueText,
        });
        return;
    }

    const insertPosition = options.beforeOffsets && options.beforeOffsets.length > 0
        ? getLineStart(content, options.beforeOffsets[0].nodeRange.start)
        : getBlockClosingLineStart(content, blockRange);
    const { childIndent } = getBlockIndentation(content, blockRange);
    changes.push({
        range: { start: insertPosition, end: insertPosition },
        text: `${childIndent}${fieldName} = ${valueText}${lineEnding}`,
    });
}

function collectDocumentMeta(root: Node, filePath: string): FocusLayoutDocumentMeta {
    const result: FocusLayoutDocumentMeta = {
        focuses: {},
        continuousByKey: {},
        inlayRefs: {},
    };

    if (!Array.isArray(root.value)) {
        return result;
    }

    let focusTreeIndex = 0;
    for (const child of root.value) {
        const name = child.name?.toLowerCase();
        if (!name || !Array.isArray(child.value)) {
            continue;
        }

        if (name === 'focus_tree') {
            const continuousKey = createLayoutEditKey('continuous', filePath, focusTreeIndex);
            result.continuousByKey[continuousKey] = collectContinuousMeta(child, filePath, focusTreeIndex);
            focusTreeIndex++;

            for (const focusNode of child.value.filter(node => node.name?.toLowerCase() === 'focus' && Array.isArray(node.value))) {
                const meta = collectFocusMeta(focusNode, filePath);
                if (meta) {
                    result.focuses[meta.editKey] = meta;
                }
            }

            for (const inlayNode of child.value.filter(node => node.name?.toLowerCase() === 'inlay_window' && Array.isArray(node.value))) {
                const meta = collectInlayRefMeta(inlayNode, filePath);
                if (meta) {
                    result.inlayRefs[meta.editKey] = meta;
                }
            }

            continue;
        }

        if (name === 'shared_focus' || name === 'joint_focus') {
            const meta = collectFocusMeta(child, filePath);
            if (meta) {
                result.focuses[meta.editKey] = meta;
            }
        }
    }

    return result;
}

function collectFocusMeta(node: Node, filePath: string): FocusNodeMeta | undefined {
    if (!node.nameToken) {
        return undefined;
    }

    const focusId = readStringChildValue(node, 'id');
    if (!focusId) {
        return undefined;
    }

    return {
        editKey: createLayoutEditKey('focus', filePath, node.nameToken.start),
        focusId,
        nodeRange: createNodeRange(node),
        x: collectScalarField(node, 'x'),
        y: collectScalarField(node, 'y'),
        relativePositionId: collectScalarField(node, 'relative_position_id'),
        offsets: collectOffsetMetas(node, filePath),
    };
}

function collectOffsetMetas(node: Node, filePath: string): OffsetNodeMeta[] {
    if (!Array.isArray(node.value)) {
        return [];
    }

    return node.value
        .filter(child => child.name?.toLowerCase() === 'offset' && Array.isArray(child.value))
        .map(offsetNode => ({
            editKey: createLayoutEditKey('offset', filePath, offsetNode.nameToken?.start ?? offsetNode.valueStartToken?.start ?? 0),
            nodeRange: createNodeRange(offsetNode),
            x: collectScalarField(offsetNode, 'x'),
            y: collectScalarField(offsetNode, 'y'),
            hasTrigger: !!findNamedChild(offsetNode, 'trigger'),
        }));
}

function collectContinuousMeta(node: Node, filePath: string, focusTreeIndex: number): PointBlockMeta | undefined {
    const positionNode = findNamedChild(node, 'continuous_focus_position');
    return {
        editKey: createLayoutEditKey('continuous', filePath, focusTreeIndex),
        label: 'continuous_focus_position',
        parentNodeRange: createNodeRange(node),
        positionNodeRange: positionNode ? createNodeRange(positionNode) : undefined,
        x: positionNode ? collectScalarField(positionNode, 'x') : undefined,
        y: positionNode ? collectScalarField(positionNode, 'y') : undefined,
    };
}

function collectInlayRefMeta(node: Node, filePath: string): PointBlockMeta | undefined {
    if (!node.nameToken) {
        return undefined;
    }

    const label = readStringChildValue(node, 'id') ?? 'inlay_window';
    const positionNode = findNamedChild(node, 'position');
    return {
        editKey: createLayoutEditKey('inlayRef', filePath, node.nameToken.start),
        label,
        parentNodeRange: createNodeRange(node),
        positionNodeRange: positionNode ? createNodeRange(positionNode) : undefined,
        x: positionNode ? collectScalarField(positionNode, 'x') : undefined,
        y: positionNode ? collectScalarField(positionNode, 'y') : undefined,
    };
}

function collectScalarField(node: Node, fieldName: string): ScalarFieldMeta | undefined {
    const child = findNamedChild(node, fieldName);
    if (!child || !child.nameToken || !child.valueStartToken || !child.valueEndToken) {
        return undefined;
    }

    return {
        name: fieldName,
        nodeRange: createNodeRange(child),
        valueRange: {
            start: child.valueStartToken.start,
            end: child.valueEndToken.end,
        },
    };
}

function dedupeChanges(changes: FocusLayoutTextChange[]): FocusLayoutTextChange[] {
    const seen = new Map<string, FocusLayoutTextChange>();
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

function expandNodeRemovalRange(content: string, range: TextRange): TextRange {
    const start = getLineStart(content, range.start);
    const end = getLineEndIncludingNewline(content, range.end);
    return { start, end };
}

function getLineStart(content: string, index: number): number {
    const lineBreak = content.lastIndexOf('\n', Math.max(0, index - 1));
    return lineBreak === -1 ? 0 : lineBreak + 1;
}

function getLineEndIncludingNewline(content: string, index: number): number {
    const lineBreak = content.indexOf('\n', index);
    return lineBreak === -1 ? content.length : lineBreak + 1;
}

function getBlockClosingLineStart(content: string, blockRange: TextRange): number {
    const closingBraceIndex = Math.max(blockRange.start, blockRange.end - 1);
    return getLineStart(content, closingBraceIndex);
}

function getBlockIndentation(content: string, blockRange: TextRange): { blockIndent: string; childIndent: string; indentUnit: string } {
    const blockIndent = getLineIndent(content, blockRange.start);
    const closeLineStart = getBlockClosingLineStart(content, blockRange);
    const closingIndent = content.slice(closeLineStart, content.indexOf('}', closeLineStart));
    const indentUnit = inferIndentUnit(content, blockIndent, blockRange);
    return {
        blockIndent: closingIndent || blockIndent,
        childIndent: (closingIndent || blockIndent) + indentUnit,
        indentUnit,
    };
}

function getLineIndent(content: string, index: number): string {
    const lineStart = getLineStart(content, index);
    const line = content.slice(lineStart, content.indexOf('\n', lineStart) === -1 ? content.length : content.indexOf('\n', lineStart));
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

function detectLineEnding(content: string): string {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function formatInteger(value: number): string {
    return `${Math.round(value)}`;
}

function findNamedChild(node: Node, fieldName: string): Node | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    return node.value.find(child => child.name?.toLowerCase() === fieldName);
}

function readStringChildValue(node: Node, fieldName: string): string | undefined {
    const child = findNamedChild(node, fieldName);
    if (!child) {
        return undefined;
    }

    if (typeof child.value === 'string') {
        return child.value;
    }

    if (typeof child.value === 'object' && child.value !== null && 'name' in child.value) {
        return child.value.name;
    }

    return undefined;
}

function createNodeRange(node: Node): TextRange {
    return {
        start: node.nameToken?.start ?? node.valueStartToken?.start ?? 0,
        end: node.valueEndToken?.end ?? node.valueStartToken?.end ?? node.nameToken?.end ?? 0,
    };
}
