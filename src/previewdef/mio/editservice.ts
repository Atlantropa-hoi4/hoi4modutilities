import { Node, SymbolNode, parseHoi4File } from '../../hoiformat/hoiparser';
import type { Mio } from './schema';
import type {
    ApplyMioPositionEditsMessage,
    CreateMioTraitAtPositionMessage,
    DeleteMioTraitsMessage,
    MioEditMessage,
    ToggleMioExclusiveLinkMessage,
    ToggleMioParentLinkMessage,
} from './editcommon';
import { isMioAbsolutePositionInBounds } from './draginteraction';

export interface MioTextEditResult {
    updatedContent?: string;
    placeholderRange?: { start: number; end: number };
    createdTraitId?: string;
    error?: string;
}

interface ParsedDocument {
    root: Node;
    offset: number;
}

interface LocalTraitBlock {
    kind: 'trait' | 'add_trait' | 'override_trait';
    node: Node;
    token: string;
}

export function buildMioTextEdit(content: string, message: MioEditMessage, mio: Mio): MioTextEditResult {
    if (mio.id !== message.mioId) {
        return { error: `Military industrial organization ${message.mioId} is not available.` };
    }

    try {
        switch (message.command) {
            case 'applyMioPositionEdits':
                return buildPositionEdits(content, message, mio);
            case 'toggleMioParentLink':
                return buildParentLinkEdit(content, message, mio);
            case 'toggleMioExclusiveLink':
                return buildExclusiveLinkEdit(content, message, mio);
            case 'createMioTraitAtPosition':
                return buildCreateTraitEdit(content, message, mio);
            case 'deleteMioTraits':
                return buildDeleteTraitsEdit(content, message, mio);
        }
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

function buildPositionEdits(content: string, message: ApplyMioPositionEditsMessage, mio: Mio): MioTextEditResult {
    const seen = new Set<string>();
    let updated = content;
    for (const edit of message.edits) {
        if (seen.has(edit.traitId)) {
            return { error: `MIO trait ${edit.traitId} was requested more than once.` };
        }
        seen.add(edit.traitId);
        if (!mio.traits[edit.traitId]) {
            return { error: `MIO trait ${edit.traitId} does not exist in ${mio.id}.` };
        }
        if (![edit.x, edit.y].every(Number.isFinite)
            || !isMioAbsolutePositionInBounds({ x: edit.absoluteX, y: edit.absoluteY })) {
            return { error: `MIO trait ${edit.traitId} position is outside the editable grid.` };
        }
        updated = ensureEditableTraitBlock(updated, mio.id, edit.traitId);
        updated = setPosition(updated, mio.id, edit.traitId, Math.round(edit.x), Math.round(edit.y));
    }
    return { updatedContent: updated };
}

function buildParentLinkEdit(content: string, message: ToggleMioParentLinkMessage, mio: Mio): MioTextEditResult {
    if (message.parentTraitId === message.childTraitId) {
        return { error: 'A MIO trait cannot be its own parent.' };
    }
    const parent = mio.traits[message.parentTraitId];
    const child = mio.traits[message.childTraitId];
    if (!parent || !child) {
        return { error: 'Both MIO traits must exist in the selected organization.' };
    }
    if (child.parent?.traits.includes(message.parentTraitId)) {
        return { error: 'Links using parent/num_parents_needed are read-only in the preview editor.' };
    }

    const selected = message.kind === 'any' ? child.anyParent : child.allParents;
    const adding = !selected.includes(parent.id);
    if (adding && canReachParent(mio, parent.id, child.id)) {
        return { error: 'The MIO parent link would create a cycle.' };
    }
    const nextSelected = selected.includes(parent.id)
        ? selected.filter(id => id !== parent.id)
        : [...selected, parent.id];
    const nextOther = (message.kind === 'any' ? child.allParents : child.anyParent)
        .filter(id => id !== parent.id);

    let updated = ensureEditableTraitBlock(content, mio.id, child.id);
    updated = setEnumField(updated, mio.id, child.id, message.kind === 'any' ? 'any_parent' : 'all_parents', nextSelected);
    updated = setEnumField(updated, mio.id, child.id, message.kind === 'any' ? 'all_parents' : 'any_parent', nextOther);
    return { updatedContent: updated };
}

function buildExclusiveLinkEdit(content: string, message: ToggleMioExclusiveLinkMessage, mio: Mio): MioTextEditResult {
    if (message.sourceTraitId === message.targetTraitId) {
        return { error: 'A MIO trait cannot be mutually exclusive with itself.' };
    }
    const source = mio.traits[message.sourceTraitId];
    const target = mio.traits[message.targetTraitId];
    if (!source || !target) {
        return { error: 'Both MIO traits must exist in the selected organization.' };
    }

    const linked = source.exclusive.includes(target.id) || target.exclusive.includes(source.id);
    const sourceExclusive = linked
        ? source.exclusive.filter(id => id !== target.id)
        : Array.from(new Set([...source.exclusive, target.id]));
    const targetExclusive = linked
        ? target.exclusive.filter(id => id !== source.id)
        : Array.from(new Set([...target.exclusive, source.id]));

    let updated = ensureEditableTraitBlock(content, mio.id, source.id);
    updated = setEnumField(updated, mio.id, source.id, 'mutually_exclusive', sourceExclusive);
    updated = ensureEditableTraitBlock(updated, mio.id, target.id);
    updated = setEnumField(updated, mio.id, target.id, 'mutually_exclusive', targetExclusive);
    return { updatedContent: updated };
}

function buildCreateTraitEdit(content: string, message: CreateMioTraitAtPositionMessage, mio: Mio): MioTextEditResult {
    if (!isMioAbsolutePositionInBounds({ x: message.x, y: message.y })) {
        return { error: 'The new MIO trait position is outside the editable grid.' };
    }
    const parsed = parseDocument(content);
    const mioNode = findUniqueMioNode(parsed, message.mioId);
    const existingIds = collectAllTraitIds(parsed.root);
    const placeholder = createUniqueId('MIO_TRAIT_ID', existingIds);
    const kind = hasNamedChild(mioNode, 'include') ? 'add_trait' : 'trait';
    const lineEnding = detectLineEnding(content);
    const { childIndent, nestedIndent } = getBlockIndentation(content, mioNode, parsed.offset);
    const block = `${childIndent}${kind} = {${lineEnding}`
        + `${nestedIndent}token = ${placeholder}${lineEnding}`
        + `${nestedIndent}name = ${placeholder}${lineEnding}`
        + `${nestedIndent}position = { x = ${Math.round(message.x)} y = ${Math.round(message.y)} }${lineEnding}`
        + `${childIndent}}${lineEnding}`;
    const insertion = getChildBlockInsertion(content, mioNode, parsed.offset, block);
    const updatedContent = insertAt(content, insertion.position, insertion.text);
    const placeholderOffset = insertion.text.indexOf(placeholder);
    return {
        updatedContent,
        createdTraitId: placeholder,
        placeholderRange: {
            start: insertion.position + placeholderOffset,
            end: insertion.position + placeholderOffset + placeholder.length,
        },
    };
}

function buildDeleteTraitsEdit(content: string, message: DeleteMioTraitsMessage, mio: Mio): MioTextEditResult {
    const deletedIds = Array.from(new Set(message.traitIds.filter(Boolean)));
    if (deletedIds.length === 0) {
        return { error: 'Select at least one MIO trait to delete.' };
    }
    for (const traitId of deletedIds) {
        if (!mio.traits[traitId]) {
            return { error: `MIO trait ${traitId} does not exist in ${mio.id}.` };
        }
    }

    const deletedSet = new Set(deletedIds);
    const absolutePositions = getAbsoluteTraitPositions(mio);
    let updated = content;

    // Clean relationships first while local blocks still provide useful insertion anchors.
    for (const trait of Object.values(mio.traits)) {
        if (deletedSet.has(trait.id)) {
            continue;
        }
        const nextAny = trait.anyParent.filter(id => !deletedSet.has(id));
        const nextAll = trait.allParents.filter(id => !deletedSet.has(id));
        const nextExclusive = trait.exclusive.filter(id => !deletedSet.has(id));
        if (nextAny.length !== trait.anyParent.length
            || nextAll.length !== trait.allParents.length
            || nextExclusive.length !== trait.exclusive.length) {
            updated = ensureEditableTraitBlock(updated, mio.id, trait.id);
            if (nextAny.length !== trait.anyParent.length) {
                updated = setEnumField(updated, mio.id, trait.id, 'any_parent', nextAny);
            }
            if (nextAll.length !== trait.allParents.length) {
                updated = setEnumField(updated, mio.id, trait.id, 'all_parents', nextAll);
            }
            if (nextExclusive.length !== trait.exclusive.length) {
                updated = setEnumField(updated, mio.id, trait.id, 'mutually_exclusive', nextExclusive);
            }
        }
        if (trait.relativePositionId && deletedSet.has(trait.relativePositionId)) {
            const local = findLocalTraitBlock(parseDocument(updated), mio.id, trait.id, false);
            const absolutePosition = absolutePositions[trait.id];
            updated = ensureEditableTraitBlock(updated, mio.id, trait.id);
            updated = setPosition(updated, mio.id, trait.id, absolutePosition.x, absolutePosition.y);
            if (local?.kind === 'trait' || local?.kind === 'add_trait') {
                updated = removeNamedField(updated, mio.id, trait.id, 'relative_position_id');
            } else {
                updated = setScalarField(updated, mio.id, trait.id, 'relative_position_id', '""');
            }
        }
    }

    for (const traitId of deletedIds) {
        const parsed = parseDocument(updated);
        const local = findLocalTraitBlock(parsed, mio.id, traitId, false);
        if (local?.kind === 'trait' || local?.kind === 'add_trait') {
            updated = removeWholeNode(updated, local.node, parsed.offset);
            continue;
        }
        if (local?.kind === 'override_trait') {
            updated = removeWholeNode(updated, local.node, parsed.offset);
        }
        updated = addRemoveTrait(updated, mio.id, traitId);
    }

    return { updatedContent: updated };
}

function getAbsoluteTraitPositions(mio: Mio): Record<string, { x: number; y: number }> {
    const result: Record<string, { x: number; y: number }> = {};
    const visiting = new Set<string>();
    const resolve = (traitId: string): { x: number; y: number } => {
        if (result[traitId]) {
            return result[traitId];
        }
        const trait = mio.traits[traitId];
        if (!trait || visiting.has(traitId)) {
            return { x: 0, y: 0 };
        }
        visiting.add(traitId);
        const parent = trait.relativePositionId ? resolve(trait.relativePositionId) : { x: 0, y: 0 };
        visiting.delete(traitId);
        return result[traitId] = { x: trait.x + parent.x, y: trait.y + parent.y };
    };
    for (const traitId of Object.keys(mio.traits)) {
        resolve(traitId);
    }
    return result;
}

function ensureEditableTraitBlock(content: string, mioId: string, traitId: string): string {
    const parsed = parseDocument(content);
    if (findLocalTraitBlock(parsed, mioId, traitId, false)) {
        return content;
    }
    const mioNode = findUniqueMioNode(parsed, mioId);
    const lineEnding = detectLineEnding(content);
    const { childIndent, nestedIndent } = getBlockIndentation(content, mioNode, parsed.offset);
    const block = `${childIndent}override_trait = {${lineEnding}`
        + `${nestedIndent}token = ${traitId}${lineEnding}`
        + `${childIndent}}${lineEnding}`;
    const insertion = getChildBlockInsertion(content, mioNode, parsed.offset, block);
    return insertAt(content, insertion.position, insertion.text);
}

function setPosition(content: string, mioId: string, traitId: string, x: number, y: number): string {
    let parsed = parseDocument(content);
    let block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    let position = findNamedChild(block, 'position');
    if (!position || !Array.isArray(position.value)) {
        return insertField(content, block, parsed.offset, `position = { x = ${x} y = ${y} }`);
    }

    const xNode = findNamedChild(position, 'x');
    if (xNode?.valueStartToken && xNode.valueEndToken) {
        content = replaceRange(content, xNode.valueStartToken.start + parsed.offset, xNode.valueEndToken.end + parsed.offset, String(x));
    } else {
        content = insertBeforeClosingToken(content, position, parsed.offset, ` x = ${x}`);
    }

    parsed = parseDocument(content);
    block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    position = findNamedChild(block, 'position')!;
    const yNode = findNamedChild(position, 'y');
    if (yNode?.valueStartToken && yNode.valueEndToken) {
        return replaceRange(content, yNode.valueStartToken.start + parsed.offset, yNode.valueEndToken.end + parsed.offset, String(y));
    }
    return insertBeforeClosingToken(content, position, parsed.offset, ` y = ${y}`);
}

function setEnumField(content: string, mioId: string, traitId: string, fieldName: string, desiredIds: readonly string[]): string {
    let parsed = parseDocument(content);
    let block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    let field = findNamedChild(block, fieldName);
    if (!field) {
        return insertField(content, block, parsed.offset, `${fieldName} = { ${desiredIds.join(' ')} }`);
    }
    if (!Array.isArray(field.value) || !field.valueEndToken) {
        const start = field.valueStartToken?.start ?? field.nameToken?.end;
        const end = field.valueEndToken?.end ?? field.nameToken?.end;
        if (start === undefined || end === undefined) {
            throw new Error(`Unable to edit ${fieldName} for MIO trait ${traitId}.`);
        }
        return replaceRange(content, start + parsed.offset, end + parsed.offset, `{ ${desiredIds.join(' ')} }`);
    }

    const desired = new Set(desiredIds);
    const current = new Set<string>();
    const removals = field.value
        .filter(child => child.name && child.nameToken)
        .map(child => ({ id: child.name!, start: child.nameToken!.start + parsed.offset, end: child.nameToken!.end + parsed.offset }))
        .filter(item => {
            current.add(item.id);
            return !desired.has(item.id);
        })
        .sort((a, b) => b.start - a.start);
    for (const removal of removals) {
        content = replaceRange(content, removal.start, removal.end, '');
    }

    const missing = desiredIds.filter(id => !current.has(id));
    if (missing.length === 0) {
        return content;
    }
    parsed = parseDocument(content);
    block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    field = findNamedChild(block, fieldName)!;
    return insertBeforeClosingToken(content, field, parsed.offset, ` ${missing.join(' ')}`);
}

function removeNamedField(content: string, mioId: string, traitId: string, fieldName: string): string {
    const parsed = parseDocument(content);
    const block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    const field = findNamedChild(block, fieldName);
    return field ? removeWholeNode(content, field, parsed.offset) : content;
}

function setScalarField(content: string, mioId: string, traitId: string, fieldName: string, value: string): string {
    const parsed = parseDocument(content);
    const block = findLocalTraitBlock(parsed, mioId, traitId, true)!.node;
    const field = findNamedChild(block, fieldName);
    if (!field) {
        return insertField(content, block, parsed.offset, `${fieldName} = ${value}`);
    }
    const start = field.valueStartToken?.start;
    const end = field.valueEndToken?.end;
    if (start === undefined || end === undefined) {
        throw new Error(`Unable to edit ${fieldName} for MIO trait ${traitId}.`);
    }
    return replaceRange(content, start + parsed.offset, end + parsed.offset, value);
}

function addRemoveTrait(content: string, mioId: string, traitId: string): string {
    const parsed = parseDocument(content);
    const mioNode = findUniqueMioNode(parsed, mioId);
    const fields = children(mioNode).filter(node => node.name?.toLowerCase() === 'remove_trait');
    if (fields.some(field => readEnum(field).includes(traitId))) {
        return content;
    }
    const target = fields[fields.length - 1];
    if (target && Array.isArray(target.value)) {
        return insertBeforeClosingToken(content, target, parsed.offset, ` ${traitId}`);
    }
    return insertField(content, mioNode, parsed.offset, `remove_trait = { ${traitId} }`);
}

function parseDocument(content: string): ParsedDocument {
    const offset = content.startsWith('\uFEFF') ? 1 : 0;
    return { root: parseHoi4File(offset ? content.slice(offset) : content), offset };
}

function findUniqueMioNode(parsed: ParsedDocument, mioId: string): Node {
    const matches = children(parsed.root).filter(node => node.name === mioId && Array.isArray(node.value));
    if (matches.length !== 1) {
        throw new Error(matches.length === 0
            ? `Military industrial organization ${mioId} is not editable in the current file.`
            : `Military industrial organization ${mioId} is ambiguous in the current file.`);
    }
    return matches[0];
}

function findLocalTraitBlock(parsed: ParsedDocument, mioId: string, traitId: string, required: boolean): LocalTraitBlock | undefined {
    const mioNode = findUniqueMioNode(parsed, mioId);
    const matches = children(mioNode)
        .filter(node => node.name === 'trait' || node.name === 'add_trait' || node.name === 'override_trait')
        .map(node => ({
            kind: node.name as LocalTraitBlock['kind'],
            node,
            token: readString(findNamedChild(node, 'token')) ?? '',
        }))
        .filter(item => item.token === traitId);
    if (matches.length > 1) {
        throw new Error(`MIO trait ${traitId} is ambiguous in ${mioId}.`);
    }
    if (required && matches.length === 0) {
        throw new Error(`MIO trait ${traitId} is not editable in ${mioId}.`);
    }
    return matches[0];
}

function children(node: Node): Node[] {
    return Array.isArray(node.value) ? node.value : [];
}

function findNamedChild(node: Node, name: string): Node | undefined {
    return children(node).find(child => child.name?.toLowerCase() === name);
}

function hasNamedChild(node: Node, name: string): boolean {
    return findNamedChild(node, name) !== undefined;
}

function readString(node: Node | undefined): string | undefined {
    if (!node) {
        return undefined;
    }
    if (typeof node.value === 'string') {
        return node.value;
    }
    if (typeof node.value === 'object' && node.value !== null && 'name' in node.value) {
        return (node.value as SymbolNode).name;
    }
    return undefined;
}

function readEnum(node: Node): string[] {
    return children(node).map(child => child.name).filter((name): name is string => !!name);
}

function collectAllTraitIds(root: Node): Set<string> {
    const result = new Set<string>();
    for (const mioNode of children(root)) {
        for (const block of children(mioNode)) {
            if (block.name === 'trait' || block.name === 'add_trait' || block.name === 'override_trait') {
                const token = readString(findNamedChild(block, 'token'));
                if (token) {
                    result.add(token);
                }
            }
        }
    }
    return result;
}

function createUniqueId(base: string, existing: ReadonlySet<string>): string {
    if (!existing.has(base)) {
        return base;
    }
    let index = 2;
    while (existing.has(`${base}_${index}`)) {
        index++;
    }
    return `${base}_${index}`;
}

function canReachParent(mio: Mio, startTraitId: string, targetTraitId: string): boolean {
    const pending = [startTraitId];
    const visited = new Set<string>();
    while (pending.length > 0) {
        const traitId = pending.pop()!;
        if (traitId === targetTraitId) {
            return true;
        }
        if (visited.has(traitId)) {
            continue;
        }
        visited.add(traitId);
        const trait = mio.traits[traitId];
        if (trait) {
            pending.push(...trait.anyParent, ...trait.allParents, ...(trait.parent?.traits ?? []));
        }
    }
    return false;
}

function insertField(content: string, block: Node, offset: number, fieldText: string): string {
    const lineEnding = detectLineEnding(content);
    const { childIndent } = getBlockIndentation(content, block, offset);
    const insertion = getBlockClosingLineStart(content, block, offset);
    const blockStart = (block.nameToken ?? block.valueStartToken)?.start;
    if (blockStart !== undefined && insertion === getLineStart(content, blockStart + offset)) {
        return insertBeforeClosingToken(content, block, offset, ` ${fieldText}`);
    }
    return insertAt(content, insertion, `${childIndent}${fieldText}${lineEnding}`);
}

function insertBeforeClosingToken(content: string, node: Node, offset: number, text: string): string {
    if (!node.valueEndToken) {
        throw new Error(`Unable to find the closing token for ${node.name ?? 'block'}.`);
    }
    return insertAt(content, node.valueEndToken.start + offset, text);
}

function removeWholeNode(content: string, node: Node, offset: number): string {
    const startToken = node.nameToken ?? node.valueStartToken;
    const endToken = node.valueEndToken ?? node.valueStartToken ?? node.nameToken;
    if (!startToken || !endToken) {
        throw new Error(`Unable to remove ${node.name ?? 'MIO node'}.`);
    }
    const rawStart = startToken.start + offset;
    const rawEnd = endToken.end + offset;
    const lineStart = getLineStart(content, rawStart);
    const lineEnd = getNextLineStart(content, rawEnd);
    const prefix = content.slice(lineStart, rawStart);
    const suffix = content.slice(rawEnd, lineEnd).replace(/\r?\n$/, '');
    if (prefix.trim() !== '' || suffix.trim() !== '') {
        let start = rawStart;
        let end = rawEnd;
        while (start > lineStart && (content[start - 1] === ' ' || content[start - 1] === '\t')) {
            start--;
        }
        while (end < lineEnd && (content[end] === ' ' || content[end] === '\t')) {
            end++;
        }
        return replaceRange(content, start, end, ' ');
    }
    return replaceRange(content, lineStart, lineEnd, '');
}

function getChildBlockInsertion(content: string, node: Node, offset: number, block: string): { position: number; text: string } {
    if (!node.valueEndToken) {
        throw new Error(`Unable to find the closing line for ${node.name ?? 'block'}.`);
    }
    const closingPosition = node.valueEndToken.start + offset;
    const closingLineStart = getLineStart(content, closingPosition);
    const nodeStart = (node.nameToken ?? node.valueStartToken)?.start;
    if (nodeStart !== undefined && closingLineStart === getLineStart(content, nodeStart + offset)) {
        const parentIndent = content.slice(closingLineStart, nodeStart + offset).match(/^\s*/)?.[0] ?? '';
        return {
            position: closingPosition,
            text: `${detectLineEnding(content)}${block}${parentIndent}`,
        };
    }
    return { position: closingLineStart, text: block };
}

function getBlockClosingLineStart(content: string, node: Node, offset: number): number {
    if (!node.valueEndToken) {
        throw new Error(`Unable to find the closing line for ${node.name ?? 'block'}.`);
    }
    return getLineStart(content, node.valueEndToken.start + offset);
}

function getBlockIndentation(content: string, node: Node, offset: number): { childIndent: string; nestedIndent: string } {
    const nodeStart = (node.nameToken ?? node.valueStartToken)?.start;
    if (nodeStart === undefined) {
        return { childIndent: '    ', nestedIndent: '        ' };
    }
    const lineStart = getLineStart(content, nodeStart + offset);
    const parentIndent = content.slice(lineStart, nodeStart + offset).match(/^\s*/)?.[0] ?? '';
    const firstChild = children(node).find(child => child.nameToken);
    let indentUnit = parentIndent.includes('\t') ? '\t' : '    ';
    if (firstChild?.nameToken) {
        const childStart = firstChild.nameToken.start + offset;
        const existingIndent = content.slice(getLineStart(content, childStart), childStart);
        if (/^\s+$/.test(existingIndent)
            && existingIndent.length > parentIndent.length
            && existingIndent.startsWith(parentIndent)) {
            indentUnit = existingIndent.slice(parentIndent.length);
        }
    }
    const childIndent = parentIndent + indentUnit;
    return { childIndent, nestedIndent: childIndent + indentUnit };
}

function detectLineEnding(content: string): string {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function getLineStart(content: string, index: number): number {
    const breakIndex = content.lastIndexOf('\n', Math.max(0, index - 1));
    return breakIndex === -1 ? 0 : breakIndex + 1;
}

function getNextLineStart(content: string, index: number): number {
    const breakIndex = content.indexOf('\n', index);
    return breakIndex === -1 ? content.length : breakIndex + 1;
}

function insertAt(content: string, index: number, text: string): string {
    return content.slice(0, index) + text + content.slice(index);
}

function replaceRange(content: string, start: number, end: number, text: string): string {
    return content.slice(0, start) + text + content.slice(end);
}
