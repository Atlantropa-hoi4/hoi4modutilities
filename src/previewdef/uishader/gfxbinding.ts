import { Node, NodeValue, parseHoi4File } from '../../hoiformat/hoiparser';
import { isSymbolNode } from '../../hoiformat/schema';
import { UiShaderAnimationBinding, UiShaderGfxFieldValue, UiShaderSpriteBinding } from './types';

const spriteTypeNames = new Set([
    'spritetype',
    'frameanimatedspritetype',
    'corneredtilespritetype',
    'textspritetype',
    'progressbartype',
]);

export function extractUiShaderSpriteBindings(content: string, fileLabel: string): UiShaderSpriteBinding[] {
    const root = parseHoi4File(content, fileLabel);
    const result: UiShaderSpriteBinding[] = [];
    visitNodes(root, node => {
        if (!node.name || !spriteTypeNames.has(normalizeName(node.name)) || !Array.isArray(node.value)) {
            return;
        }

        const name = getStringField(node, 'name');
        const texturefile = getFirstStringField(node, ['texturefile', 'texturefile1']);
        if (!name || !texturefile) {
            return;
        }

        const fields = readFields(node);
        result.push({
            name,
            kind: normalizeName(node.name),
            texturefile,
            effectFile: getStringField(node, 'effectfile'),
            noOfFrames: getNumberField(node, 'noofframes') ?? 1,
            tokenStart: findChild(node, 'name')?.nameToken?.start,
            tokenEnd: findChild(node, 'name')?.nameToken?.end,
            fields,
            animations: getChildren(node, 'animation').map(readAnimation),
        });
    });
    return result;
}

function readAnimation(node: Node): UiShaderAnimationBinding {
    const fields: Record<string, UiShaderGfxFieldValue> = {};
    if (!Array.isArray(node.value)) {
        return { fields };
    }

    for (const child of node.value) {
        if (!child.name) {
            continue;
        }
        const value = scalarValue(child.value);
        if (value !== undefined) {
            fields[normalizeName(child.name)] = value;
        }
    }
    return { fields };
}

function readFields(node: Node): Record<string, UiShaderGfxFieldValue> {
    const fields: Record<string, UiShaderGfxFieldValue> = {};
    if (!Array.isArray(node.value)) {
        return fields;
    }
    for (const child of node.value) {
        if (!child.name) {
            continue;
        }
        const value = fieldValue(child);
        if (value !== undefined) {
            fields[normalizeName(child.name)] = value;
        }
    }
    return fields;
}

function visitNodes(node: Node, callback: (node: Node) => void): void {
    callback(node);
    if (!Array.isArray(node.value)) {
        return;
    }
    node.value.forEach(child => visitNodes(child, callback));
}

function findChild(node: Node, name: string): Node | undefined {
    return getChildren(node, name)[0];
}

function getChildren(node: Node, name: string): Node[] {
    if (!Array.isArray(node.value)) {
        return [];
    }
    const normalized = normalizeName(name);
    return node.value.filter(child => child.name !== null && normalizeName(child.name) === normalized);
}

function getStringField(node: Node, name: string): string | undefined {
    const value = findChild(node, name)?.value;
    const scalar = scalarValue(value);
    return typeof scalar === 'string' ? scalar : undefined;
}

function getFirstStringField(node: Node, names: string[]): string | undefined {
    for (const name of names) {
        const value = getStringField(node, name);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function getNumberField(node: Node, name: string): number | undefined {
    const value = findChild(node, name)?.value;
    return typeof value === 'number' ? value : undefined;
}

function fieldValue(node: Node): UiShaderGfxFieldValue | undefined {
    if (Array.isArray(node.value)) {
        return blockValue(node.value);
    }
    return scalarNodeValue(node);
}

function blockValue(nodes: Node[]): UiShaderGfxFieldValue | undefined {
    const namedValues: Record<string, string | number | boolean> = {};
    const listValues: (string | number | boolean)[] = [];
    let hasNamedValues = false;
    let hasListValues = false;
    for (const node of nodes) {
        const value = scalarNodeValue(node);
        if (value === undefined) {
            continue;
        }
        if (node.operator && node.name) {
            namedValues[normalizeName(node.name)] = value;
            hasNamedValues = true;
        } else {
            listValues.push(value);
            hasListValues = true;
        }
    }
    if (hasNamedValues) {
        return namedValues;
    }
    if (hasListValues) {
        return listValues;
    }
    return undefined;
}

function scalarNodeValue(node: Node): string | number | boolean | undefined {
    const value = scalarValue(node.value);
    if (value !== undefined) {
        return value;
    }
    if (!node.operator && node.value === null && node.name !== null) {
        return scalarNameValue(node.name);
    }
    return undefined;
}

function scalarNameValue(name: string): string | number | boolean {
    if (name === 'yes') {
        return true;
    }
    if (name === 'no') {
        return false;
    }
    const numeric = Number(name);
    return Number.isFinite(numeric) && /^[-+]?(?:0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+))$/i.test(name) ? numeric : name;
}

function scalarValue(value: NodeValue | undefined): string | number | boolean | undefined {
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    if (value !== undefined && isSymbolNode(value)) {
        if (value.name === 'yes') {
            return true;
        }
        if (value.name === 'no') {
            return false;
        }
        return value.name;
    }
    return undefined;
}

function normalizeName(name: string): string {
    return name.toLowerCase();
}
