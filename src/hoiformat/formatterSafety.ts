import { Node, parseHoi4File } from './hoiparser';
import { collectHoi4CommentSignature, collectHoi4SeparatorSignature } from './formatterTokens';
import {
    comparisonOperators,
    directEventCallKeys,
    orderedEventCallFields,
    orderedInlineBlockFields,
    OrderedBlockFields,
} from './formatterRules';

type FormatFingerprintValue = string | null | FormatFingerprintNode[];

interface FormatFingerprintNode {
    name: string | null;
    operator: string | null;
    valueAttachment: string | null;
    value: FormatFingerprintValue;
}

export function assertHoi4FormattingSafe(before: string, after: string): void {
    const beforeRoot = parseHoi4File(before);
    const afterRoot = parseHoi4File(after);
    const beforeFingerprint = JSON.stringify(createNodeFingerprint(beforeRoot, -1));
    const afterFingerprint = JSON.stringify(createNodeFingerprint(afterRoot, -1));

    if (beforeFingerprint !== afterFingerprint) {
        throw new Error('Formatter safety check failed because the script structure changed.');
    }

    if (!arraysEqual(collectHoi4CommentSignature(before), collectHoi4CommentSignature(after))) {
        throw new Error('Formatter safety check failed because comments changed.');
    }

    if (!arraysEqual(collectHoi4SeparatorSignature(before), collectHoi4SeparatorSignature(after))) {
        throw new Error('Formatter safety check failed because list separators changed.');
    }
}

function createNodeFingerprint(node: Node, depth: number): FormatFingerprintNode {
    const name = node.nameToken?.value ?? node.name;
    const valueAttachment = node.valueAttachmentToken?.value ?? node.valueAttachment?.name ?? null;

    if (depth > 0 && name !== null && directEventCallKeys.has(name)) {
        const directValue = createDirectEventValueFingerprint(node);
        if (directValue !== undefined) {
            return {
                name,
                operator: node.operator,
                valueAttachment,
                value: directValue,
            };
        }
    }

    return {
        name,
        operator: node.operator,
        valueAttachment,
        value: createValueFingerprint(node, name, depth),
    };
}

function createValueFingerprint(node: Node, blockName: string | null, depth: number): FormatFingerprintValue {
    const value = node.value;
    if (Array.isArray(value)) {
        const children = normalizeOrderedChildren(value, blockName, depth);
        return children.map(child => createNodeFingerprint(child, depth + 1));
    }

    if (value === null) {
        return null;
    }

    if (node.valueStartToken !== null) {
        return node.valueStartToken.value;
    }

    return typeof value === 'object' ? value.name : String(value);
}

function createDirectEventValueFingerprint(node: Node): string | undefined {
    const value = node.value;
    if (Array.isArray(value)) {
        if (value.length !== 1) {
            return undefined;
        }
        const id = value[0];
        if (id.name !== 'id' || id.operator !== '=' || id.valueAttachment !== null || Array.isArray(id.value) || id.value === null) {
            return undefined;
        }
        return rawScalarValue(id);
    }

    if (value === null || typeof value !== 'object') {
        return value === null ? undefined : node.valueStartToken?.value ?? String(value);
    }

    return node.valueStartToken?.value ?? value.name;
}

function normalizeOrderedChildren(children: Node[], blockName: string | null, depth: number): Node[] {
    const fields = blockName === null
        ? undefined
        : orderedInlineBlockFields.get(blockName)
            ?? (depth > 0 && directEventCallKeys.has(blockName) ? orderedEventCallFields : undefined);
    if (fields === undefined || !hasExactlyKnownFields(children, fields)) {
        return children;
    }

    const indexes = new Map(fields.order.map((field, index) => [field, index]));
    return [...children].sort((left, right) => indexes.get(left.name ?? '')! - indexes.get(right.name ?? '')!);
}

function hasExactlyKnownFields(children: Node[], fields: OrderedBlockFields): boolean {
    const allowed = new Set(fields.order);
    const seen = new Set<string>();
    for (const child of children) {
        if (child.name === null
            || !allowed.has(child.name)
            || seen.has(child.name)
            || child.operator === null
            || !comparisonOperators.has(child.operator)) {
            return false;
        }
        seen.add(child.name);
    }

    return fields.required.every(field => seen.has(field));
}

function rawScalarValue(node: Node): string {
    if (node.valueStartToken !== null) {
        return node.valueStartToken.value;
    }
    if (typeof node.value === 'object' && node.value !== null && !Array.isArray(node.value)) {
        return node.value.name;
    }
    return String(node.value);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
