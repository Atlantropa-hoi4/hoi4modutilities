export type MioParentLinkKind = 'any' | 'all';

export type MioTraitDefinitionKind = 'trait' | 'add_trait' | 'override_trait' | 'inherited';

export interface MioEditMeta {
    editKey: string;
    editable: boolean;
    sourceFile: string;
    included: boolean;
}

export interface MioTraitEditMeta {
    editKey: string;
    editable: boolean;
    definitionKind: MioTraitDefinitionKind;
}

export interface MioPositionEdit {
    traitId: string;
    x: number;
    y: number;
    absoluteX: number;
    absoluteY: number;
}

interface MioEditRequestBase {
    requestId: string;
    documentVersion: number;
    mioId: string;
}

export interface ApplyMioPositionEditsMessage extends MioEditRequestBase {
    command: 'applyMioPositionEdits';
    edits: MioPositionEdit[];
}

export interface ToggleMioParentLinkMessage extends MioEditRequestBase {
    command: 'toggleMioParentLink';
    parentTraitId: string;
    childTraitId: string;
    kind: MioParentLinkKind;
}

export interface ToggleMioExclusiveLinkMessage extends MioEditRequestBase {
    command: 'toggleMioExclusiveLink';
    sourceTraitId: string;
    targetTraitId: string;
}

export interface CreateMioTraitAtPositionMessage extends MioEditRequestBase {
    command: 'createMioTraitAtPosition';
    x: number;
    y: number;
}

export interface DeleteMioTraitsMessage extends MioEditRequestBase {
    command: 'deleteMioTraits';
    traitIds: string[];
}

export type MioEditMessage =
    | ApplyMioPositionEditsMessage
    | ToggleMioParentLinkMessage
    | ToggleMioExclusiveLinkMessage
    | CreateMioTraitAtPositionMessage
    | DeleteMioTraitsMessage;

export function createMioEditKey(file: string, mioId: string): string {
    return `mio:${file}:${mioId}`;
}

export function createMioTraitEditKey(mioId: string, traitId: string): string {
    return `mio-trait:${mioId}:${traitId}`;
}
