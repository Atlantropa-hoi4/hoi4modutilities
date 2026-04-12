import { Node } from "../../hoiformat/hoiparser";
import { ContinuousFocusPositionMeta, FocusTreeCreateMeta, ScalarFieldMeta, TextRange } from "./positioneditcommon";
import { FocusNodeMeta, FocusReferenceFieldMeta } from "./positioneditservicetypes";

export function collectEditableFocuses(root: Node): FocusNodeMeta[] {
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

export function shiftFocusMeta(meta: FocusNodeMeta, offset: number): FocusNodeMeta {
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

export function shiftTreeMeta(meta: FocusTreeCreateMeta, offset: number): FocusTreeCreateMeta {
    if (offset === 0) {
        return meta;
    }

    return {
        ...meta,
        sourceRange: meta.sourceRange ? shiftRange(meta.sourceRange, offset) : undefined,
    };
}

export function shiftContinuousFocusMeta(meta: ContinuousFocusPositionMeta, offset: number): ContinuousFocusPositionMeta {
    if (offset === 0) {
        return meta;
    }

    return {
        ...meta,
        focusTreeRange: meta.focusTreeRange ? shiftRange(meta.focusTreeRange, offset) : undefined,
        sourceRange: meta.sourceRange ? shiftRange(meta.sourceRange, offset) : undefined,
        x: meta.x ? shiftScalarField(meta.x, offset) : undefined,
        y: meta.y ? shiftScalarField(meta.y, offset) : undefined,
    };
}

export function normalizeParentFocusIds(
    parentFocusId: string,
    parentFocusIds: readonly string[] | undefined,
    childFocusId: string,
): string[] {
    return Array.from(new Set(
        (parentFocusIds && parentFocusIds.length > 0 ? parentFocusIds : [parentFocusId])
            .filter(focusId => focusId && focusId !== childFocusId),
    ));
}

export function findMatchingPrerequisiteField(
    focus: FocusNodeMeta,
    parentFocusIds: readonly string[],
): FocusReferenceFieldMeta | undefined {
    return focus.prerequisiteFields.find(field => areFocusIdSetsEqual(field.focusIds, parentFocusIds))
        ?? focus.prerequisiteFields.find(field => parentFocusIds.some(parentFocusId => field.focusIds.includes(parentFocusId)));
}

export function areFocusIdSetsEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const rightSet = new Set(right);
    return left.every(focusId => rightSet.has(focusId));
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
