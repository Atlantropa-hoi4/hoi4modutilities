import { Node, NodeValue } from './hoiparser';

export function nodeToString(node: Node): string {
    const name = node.name === null ? null : nodeNameToString(node);
    return [name, node.operator, node.valueAttachment?.name, nodeValueToString(node.value)].filter(v => !!v).join(' ');
}

function nodeNameToString(node: Node): string {
    const name = node.name!;
    return node.nameToken?.type === 'string' || !isBareSymbol(name) ? quoteString(name) : name;
}

function nodeValueToString(nodeValue: NodeValue): string | null {
    if (Array.isArray(nodeValue)) {
        return [ '{', ...nodeValue.map(v => nodeToString(v)), '}' ].join(' ');
    }

    if (nodeValue === null) {
        return null;
    }

    if (typeof nodeValue === 'object') {
        return nodeValue.name;
    }

    if (typeof nodeValue === 'string') {
        return quoteString(nodeValue);
    }

    return nodeValue.toString();
}

function isBareSymbol(value: string): boolean {
    return value.length > 0 && !/[\s#={}<>!,;]/.test(value);
}

function quoteString(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
