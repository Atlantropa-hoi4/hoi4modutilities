import { Node } from "../../hoiformat/hoiparser";
import { HOIPartial } from "../../hoiformat/schema";
import { collectFocusPositionFileMetadata, FocusPositionFileMetadata } from './positioneditmetadata';
import { buildFocusTreesFromFile } from "./focustreeschemahelpers";
import { convertFocusFileNodeToJson } from "./focustreeschematypes";
import type { FocusFile, FocusTree } from "./focustreeschematypes";

export * from "./focustreeschematypes";

export interface FocusTreeSourceSnapshot {
    node: Node;
    file: HOIPartial<FocusFile>;
    metadata: FocusPositionFileMetadata;
    filePath: string;
}

export function createFocusTreeSourceSnapshot(node: Node, filePath: string): FocusTreeSourceSnapshot {
    const constants = {};
    return {
        node,
        file: convertFocusFileNodeToJson(node, constants),
        metadata: collectFocusPositionFileMetadata(node, filePath),
        filePath,
    };
}

export function getFocusTreeWithFocusFile(
    file: HOIPartial<FocusFile>,
    sharedFocusTrees: FocusTree[],
    filePath: string,
    constants: {},
): FocusTree[] {
    return buildFocusTreesFromFile(file, sharedFocusTrees, filePath, constants);
}

export function getFocusTree(node: Node, sharedFocusTrees: FocusTree[], filePath: string): FocusTree[] {
    return getFocusTreeFromSourceSnapshot(createFocusTreeSourceSnapshot(node, filePath), sharedFocusTrees);
}

export function getFocusTreeFromSourceSnapshot(
    snapshot: FocusTreeSourceSnapshot,
    sharedFocusTrees: FocusTree[],
): FocusTree[] {
    const constants = {};
    const { file, filePath, metadata } = snapshot;
    const trees = getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants);
    let localFocusTreeIndex = 0;

    for (const tree of trees) {
        if (tree.kind === 'focus' && Object.values(tree.focuses).some(focus => focus.file === filePath)) {
            tree.createTemplate = metadata.focusTrees[localFocusTreeIndex];
            tree.continuousLayout = tree.createTemplate ? metadata.continuousTrees[tree.createTemplate.editKey] : undefined;
            localFocusTreeIndex++;
        } else if (tree.kind === 'shared' && Object.values(tree.focuses).some(focus => focus.file === filePath)) {
            tree.createTemplate = metadata.sharedTree;
        } else if (tree.kind === 'joint' && Object.values(tree.focuses).some(focus => focus.file === filePath)) {
            tree.createTemplate = metadata.jointTree;
        }

        for (const focus of Object.values(tree.focuses)) {
            if (!focus.layout && focus.file === filePath) {
                focus.layout = metadata.focuses[focus.layoutEditKey];
            }
            focus.isInCurrentFile = focus.file === filePath;
        }
    }

    return trees;
}

export function getGfxNameForSearchFilter(filter: string): string {
    return `GFX_${filter}`;
}
