export interface TextRange {
    start: number;
    end: number;
}

export interface ScalarFieldMeta {
    nodeRange: TextRange;
    valueRange: TextRange;
}

export interface TechnologyFolderEditMeta {
    editKey: string;
    editable: boolean;
    resolvedX?: number;
    resolvedY?: number;
}

export interface TechnologyPositionEdit {
    technologyId: string;
    editKey: string;
    x: number;
    y: number;
}

interface TechnologyEditMessageBase {
    requestId: string;
    documentVersion: number;
    folder: string;
}

export interface ApplyTechnologyPositionEditsMessage extends TechnologyEditMessageBase {
    command: 'applyTechnologyPositionEdits';
    edits: TechnologyPositionEdit[];
}

export interface ToggleTechnologyPathMessage extends TechnologyEditMessageBase {
    command: 'toggleTechnologyPath';
    sourceTechnologyId: string;
    targetTechnologyId: string;
}

export interface ToggleTechnologyXorMessage extends TechnologyEditMessageBase {
    command: 'toggleTechnologyXor';
    sourceTechnologyId: string;
    targetTechnologyId: string;
}

export interface CreateChildTechnologyAtPositionMessage extends TechnologyEditMessageBase {
    command: 'createChildTechnologyAtPosition';
    parentTechnologyId: string;
    x: number;
    y: number;
}

export interface DeleteTechnologiesMessage extends TechnologyEditMessageBase {
    command: 'deleteTechnologies';
    technologyIds: string[];
}

export type TechnologyEditMessage =
    | ApplyTechnologyPositionEditsMessage
    | ToggleTechnologyPathMessage
    | ToggleTechnologyXorMessage
    | CreateChildTechnologyAtPositionMessage
    | DeleteTechnologiesMessage;

export interface TechnologyEditRenderContext {
    availableTreeRootsByFolder: Record<string, string[]>;
    gridLayoutsByFolder: Record<string, Record<string, TechnologyGridEditLayout>>;
}

export interface TechnologyGridEditLayout {
    format: 'up' | 'down' | 'left' | 'right' | 'center';
    gridSize: { width: number; height: number };
    slotSize: { width: number; height: number };
    positionsByTechnologyId: Record<string, { x: number; y: number }>;
}

export function createTechnologyFolderEditKey(
    file: string,
    technologyTokenStart: number,
    folderTokenStart: number,
): string {
    return `technology-folder:${file}:${technologyTokenStart}:${folderTokenStart}`;
}
