import { Node, Token } from "../../hoiformat/hoiparser";
import { FocusLayoutFocusMeta, FocusLayoutOffsetMeta, FocusLayoutPointMeta, createLayoutEditKey } from "./layouteditcommon";

export interface FocusLayoutFileMetadata {
    focuses: Record<string, FocusLayoutFocusMeta | undefined>;
    continuousByTreeIndex: Record<number, FocusLayoutPointMeta | undefined>;
    inlayRefs: Record<string, FocusLayoutPointMeta | undefined>;
}

export function collectFocusLayoutFileMetadata(node: Node, filePath: string): FocusLayoutFileMetadata {
    const result: FocusLayoutFileMetadata = {
        focuses: {},
        continuousByTreeIndex: {},
        inlayRefs: {},
    };

    if (!Array.isArray(node.value)) {
        return result;
    }

    let focusTreeIndex = 0;
    for (const child of node.value) {
        const childName = child.name?.toLowerCase();
        if (!childName || !Array.isArray(child.value)) {
            continue;
        }

        if (childName === 'focus_tree') {
            result.continuousByTreeIndex[focusTreeIndex] = collectContinuousFocusMetadata(child, filePath, focusTreeIndex);
            focusTreeIndex++;

            for (const focusNode of child.value.filter(isNamedBlock('focus'))) {
                const metadata = collectFocusMetadata(focusNode, filePath);
                if (metadata) {
                    result.focuses[metadata.editKey] = metadata;
                }
            }

            for (const inlayNode of child.value.filter(isNamedBlock('inlay_window'))) {
                const metadata = collectInlayRefMetadata(inlayNode, filePath);
                if (metadata) {
                    result.inlayRefs[metadata.editKey] = metadata;
                }
            }

            continue;
        }

        if (childName === 'shared_focus' || childName === 'joint_focus') {
            const metadata = collectFocusMetadata(child, filePath);
            if (metadata) {
                result.focuses[metadata.editKey] = metadata;
            }
        }
    }

    return result;
}

function collectFocusMetadata(node: Node, filePath: string): FocusLayoutFocusMeta | undefined {
    if (!node.nameToken) {
        return undefined;
    }

    const id = readStringChildValue(node, 'id');
    if (!id) {
        return undefined;
    }

    const editKey = createLayoutEditKey('focus', filePath, node.nameToken.start);
    return {
        kind: 'focus',
        editKey,
        editable: true,
        sourceFile: filePath,
        sourceRange: createNodeRange(node),
        basePosition: {
            x: readNumberChildValue(node, 'x') ?? 0,
            y: readNumberChildValue(node, 'y') ?? 0,
        },
        relativePositionId: readStringChildValue(node, 'relative_position_id'),
        offsets: collectOffsetMetadata(node, filePath),
    };
}

function collectOffsetMetadata(node: Node, filePath: string): FocusLayoutOffsetMeta[] {
    if (!Array.isArray(node.value)) {
        return [];
    }

    return node.value
        .filter(isNamedBlock('offset'))
        .map(offsetNode => {
            const tokenStart = offsetNode.nameToken?.start ?? offsetNode.valueStartToken?.start ?? 0;
            return {
                editKey: createLayoutEditKey('offset', filePath, tokenStart),
                x: readNumberChildValue(offsetNode, 'x') ?? 0,
                y: readNumberChildValue(offsetNode, 'y') ?? 0,
                hasTrigger: hasNamedChild(offsetNode, 'trigger'),
            };
        });
}

function collectContinuousFocusMetadata(node: Node, filePath: string, focusTreeIndex: number): FocusLayoutPointMeta | undefined {
    const positionNode = findNamedChild(node, 'continuous_focus_position');
    if (!positionNode) {
        return undefined;
    }

    return {
        kind: 'continuous',
        editKey: createLayoutEditKey('continuous', filePath, focusTreeIndex),
        editable: true,
        sourceFile: filePath,
        sourceRange: createNodeRange(positionNode),
        basePosition: {
            x: readNumberChildValue(positionNode, 'x') ?? 50,
            y: readNumberChildValue(positionNode, 'y') ?? 1000,
        },
        label: 'continuous_focus_position',
    };
}

function collectInlayRefMetadata(node: Node, filePath: string): FocusLayoutPointMeta | undefined {
    if (!node.nameToken) {
        return undefined;
    }

    const id = readStringChildValue(node, 'id');
    if (!id) {
        return undefined;
    }

    const positionNode = findNamedChild(node, 'position');
    return {
        kind: 'inlayRef',
        editKey: createLayoutEditKey('inlayRef', filePath, node.nameToken.start),
        editable: true,
        sourceFile: filePath,
        sourceRange: createNodeRange(node),
        basePosition: {
            x: positionNode ? readNumberChildValue(positionNode, 'x') ?? 0 : 0,
            y: positionNode ? readNumberChildValue(positionNode, 'y') ?? 0 : 0,
        },
        label: id,
    };
}

function isNamedBlock(expectedName: string) {
    return (node: Node): boolean => node.name?.toLowerCase() === expectedName && Array.isArray(node.value);
}

function hasNamedChild(node: Node, expectedName: string): boolean {
    return findNamedChild(node, expectedName) !== undefined;
}

function findNamedChild(node: Node, expectedName: string): Node | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    return node.value.find(child => child.name?.toLowerCase() === expectedName);
}

function readStringChildValue(node: Node, expectedName: string): string | undefined {
    const child = findNamedChild(node, expectedName);
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

function readNumberChildValue(node: Node, expectedName: string): number | undefined {
    const child = findNamedChild(node, expectedName);
    if (!child) {
        return undefined;
    }

    if (typeof child.value === 'number') {
        return child.value;
    }

    if (typeof child.value === 'object' && child.value !== null && 'name' in child.value) {
        const parsed = Number(child.value.name);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function createNodeRange(node: Node): { start: number; end: number } | undefined {
    const start = node.nameToken?.start;
    const end = node.valueEndToken?.end ?? node.valueStartToken?.end ?? node.nameToken?.end;
    if (start === undefined || end === undefined) {
        return undefined;
    }

    return { start, end };
}

export function createTokenRange(token: Token | undefined): { start: number; end: number } | undefined {
    if (!token) {
        return undefined;
    }

    return { start: token.start, end: token.end };
}
