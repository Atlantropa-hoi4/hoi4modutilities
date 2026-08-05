import { Node } from '../../hoiformat/hoiparser';
import {
    ScalarFieldMeta,
    TechnologyFolderEditMeta,
    TextRange,
    createTechnologyFolderEditKey,
} from './editcommon';

export interface TechnologyReferenceMeta {
    id: string;
    nodeRange: TextRange;
    valueRange: TextRange;
    containerRange?: TextRange;
    removeContainer: boolean;
}

export interface TechnologyFolderSourceMeta extends TechnologyFolderEditMeta {
    name: string;
    sourceRange: TextRange;
    positionRange?: TextRange;
    positionNode?: Node;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    xValue?: number;
    yValue?: number;
}

export interface TechnologySourceMeta {
    id: string;
    sourceRange: TextRange;
    sourceNode: Node;
    technologiesRange: TextRange;
    technologiesNode: Node;
    folders: TechnologyFolderSourceMeta[];
    paths: TechnologyReferenceMeta[];
    xors: TechnologyReferenceMeta[];
    subTechnologies: TechnologyReferenceMeta[];
}

export interface TechnologyFileMetadata {
    technologies: TechnologySourceMeta[];
}

export function collectTechnologyFileMetadata(root: Node, filePath: string, offset = 0): TechnologyFileMetadata {
    const technologies: TechnologySourceMeta[] = [];
    if (!Array.isArray(root.value)) {
        return { technologies };
    }

    for (const technologiesNode of root.value.filter(isNamedBlock('technologies'))) {
        const technologiesRange = createNodeRange(technologiesNode, offset);
        const constants = collectNumericConstants(technologiesNode);
        for (const technologyNode of technologiesNode.value as Node[]) {
            if (!technologyNode.name || !Array.isArray(technologyNode.value) || !technologyNode.nameToken) {
                continue;
            }

            technologies.push(collectTechnologyMeta(
                technologyNode,
                technologiesNode,
                technologiesRange,
                filePath,
                offset,
                constants,
            ));
        }
    }

    const counts = new Map<string, number>();
    for (const technology of technologies) {
        counts.set(technology.id, (counts.get(technology.id) ?? 0) + 1);
    }
    for (const technology of technologies) {
        if ((counts.get(technology.id) ?? 0) !== 1) {
            technology.folders.forEach(folder => folder.editable = false);
        }
        const folderCounts = new Map<string, number>();
        technology.folders.forEach(folder => folderCounts.set(folder.name, (folderCounts.get(folder.name) ?? 0) + 1));
        technology.folders.forEach(folder => {
            if ((folderCounts.get(folder.name) ?? 0) !== 1) {
                folder.editable = false;
            }
        });
    }

    return { technologies };
}

export function getTechnologyFolderEditMetadata(
    metadata: TechnologyFileMetadata,
): Record<string, Record<string, TechnologyFolderEditMeta>> {
    const result: Record<string, Record<string, TechnologyFolderEditMeta>> = {};
    const counts = new Map<string, number>();
    metadata.technologies.forEach(technology => counts.set(technology.id, (counts.get(technology.id) ?? 0) + 1));
    for (const technology of metadata.technologies) {
        if ((counts.get(technology.id) ?? 0) !== 1) {
            continue;
        }
        const folders: Record<string, TechnologyFolderEditMeta> = {};
        for (const folder of technology.folders) {
            folders[folder.name] = {
                editKey: folder.editKey,
                editable: folder.editable,
                resolvedX: folder.xValue,
                resolvedY: folder.yValue,
            };
        }
        result[technology.id] = folders;
    }
    return result;
}

function collectTechnologyMeta(
    node: Node,
    technologiesNode: Node,
    technologiesRange: TextRange,
    filePath: string,
    offset: number,
    constants: ReadonlyMap<string, number>,
): TechnologySourceMeta {
    const children = node.value as Node[];
    return {
        id: node.name!,
        sourceRange: createNodeRange(node, offset),
        sourceNode: node,
        technologiesRange,
        technologiesNode,
        folders: children.filter(isNamedBlock('folder')).map(folder => collectFolderMeta(node, folder, filePath, offset, constants)),
        paths: children.filter(isNamedBlock('path')).flatMap(path => collectScalarReferences(path, 'leads_to_tech', offset)),
        xors: children.filter(child => child.name?.toLowerCase() === 'xor').flatMap(child => collectDirectReference(child, offset)),
        subTechnologies: children.filter(isNamedBlock('sub_technologies')).flatMap(child => collectListReferences(child, offset)),
    };
}

function collectFolderMeta(
    technologyNode: Node,
    folderNode: Node,
    filePath: string,
    offset: number,
    constants: ReadonlyMap<string, number>,
): TechnologyFolderSourceMeta {
    const name = readStringChildValue(folderNode, 'name') ?? '';
    const positionNode = findNamedChild(folderNode, 'position');
    const positionChildren = positionNode && Array.isArray(positionNode.value) ? positionNode.value : [];
    const xNodes = positionChildren.filter(child => child.name?.toLowerCase() === 'x');
    const yNodes = positionChildren.filter(child => child.name?.toLowerCase() === 'y');
    const xNode = xNodes[0];
    const yNode = yNodes[0];
    const xValue = readNumberNodeValue(xNode, constants);
    const yValue = readNumberNodeValue(yNode, constants);
    const hasUnsupportedCoordinate = (positionNode !== undefined && !Array.isArray(positionNode.value))
        || xNodes.length > 1
        || yNodes.length > 1
        || (xNode !== undefined && xValue === undefined)
        || (yNode !== undefined && yValue === undefined);
    const technologyStart = (technologyNode.nameToken?.start ?? 0) + offset;
    const folderStart = (folderNode.nameToken?.start ?? folderNode.valueStartToken?.start ?? 0) + offset;

    return {
        name,
        editKey: createTechnologyFolderEditKey(filePath, technologyStart, folderStart),
        editable: !!name && !!technologyNode.nameToken && !!folderNode.nameToken && !hasUnsupportedCoordinate,
        sourceRange: createNodeRange(folderNode, offset),
        positionRange: positionNode ? createNodeRange(positionNode, offset) : undefined,
        positionNode,
        x: xNode ? collectScalarField(xNode, offset) : undefined,
        y: yNode ? collectScalarField(yNode, offset) : undefined,
        xValue,
        yValue,
    };
}

function collectScalarReferences(container: Node, fieldName: string, offset: number): TechnologyReferenceMeta[] {
    if (!Array.isArray(container.value)) {
        return [];
    }
    const containerChildren = container.value;
    const matching = containerChildren.filter(child => child.name?.toLowerCase() === fieldName);
    return matching.flatMap(child => {
        const direct = collectDirectReference(child, offset);
        return direct.map(reference => ({
            ...reference,
            containerRange: createNodeRange(container, offset),
            removeContainer: containerChildren.length === 1,
        }));
    });
}

function collectDirectReference(node: Node, offset: number): TechnologyReferenceMeta[] {
    const id = readNodeStringValue(node);
    if (!id || !node.valueStartToken || !node.valueEndToken) {
        return [];
    }
    return [{
        id,
        nodeRange: createNodeRange(node, offset),
        valueRange: { start: node.valueStartToken.start + offset, end: node.valueEndToken.end + offset },
        removeContainer: false,
    }];
}

function collectListReferences(container: Node, offset: number): TechnologyReferenceMeta[] {
    if (!Array.isArray(container.value)) {
        return [];
    }
    const references: TechnologyReferenceMeta[] = [];
    for (const child of container.value) {
        const id = child.name;
        const token = child.nameToken;
        if (!id || !token) {
            continue;
        }
        references.push({
            id,
            nodeRange: createNodeRange(child, offset),
            valueRange: { start: token.start + offset, end: token.end + offset },
            containerRange: createNodeRange(container, offset),
            removeContainer: container.value.length === 1,
        });
    }
    return references;
}

function collectScalarField(node: Node, offset: number): ScalarFieldMeta | undefined {
    if (!node.nameToken || !node.valueStartToken || !node.valueEndToken) {
        return undefined;
    }
    return {
        nodeRange: createNodeRange(node, offset),
        valueRange: { start: node.valueStartToken.start + offset, end: node.valueEndToken.end + offset },
    };
}

function isNamedBlock(expectedName: string) {
    return (node: Node): boolean => node.name?.toLowerCase() === expectedName && Array.isArray(node.value);
}

function findNamedChild(node: Node, expectedName: string): Node | undefined {
    return Array.isArray(node.value)
        ? node.value.find(child => child.name?.toLowerCase() === expectedName)
        : undefined;
}

function readStringChildValue(node: Node, expectedName: string): string | undefined {
    const child = findNamedChild(node, expectedName);
    return child ? readNodeStringValue(child) : undefined;
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

function collectNumericConstants(container: Node): ReadonlyMap<string, number> {
    const candidates = new Map<string, number[]>();
    if (!Array.isArray(container.value)) {
        return new Map();
    }
    for (const child of container.value) {
        if (!child.name?.startsWith('@') || typeof child.value !== 'number') {
            continue;
        }
        const values = candidates.get(child.name) ?? [];
        values.push(child.value);
        candidates.set(child.name, values);
    }
    return new Map(Array.from(candidates)
        .filter(([, values]) => values.length === 1)
        .map(([name, values]) => [name, values[0]]));
}

function readNumberNodeValue(node: Node | undefined, constants: ReadonlyMap<string, number> = new Map()): number | undefined {
    if (!node) {
        return undefined;
    }
    if (typeof node.value === 'number') {
        return node.value;
    }
    if (typeof node.value === 'object' && node.value !== null && 'name' in node.value) {
        const constant = constants.get(node.value.name);
        if (constant !== undefined) {
            return constant;
        }
        const value = Number(node.value.name);
        return Number.isFinite(value) ? value : undefined;
    }
    return undefined;
}

function createNodeRange(node: Node, offset: number): TextRange {
    return {
        start: (node.nameToken?.start ?? node.valueStartToken?.start ?? 0) + offset,
        end: (node.valueEndToken?.end ?? node.valueStartToken?.end ?? node.nameToken?.end ?? 0) + offset,
    };
}
