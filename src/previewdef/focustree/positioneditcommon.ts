export interface TextRange {
    start: number;
    end: number;
}

export interface ScalarFieldMeta {
    nodeRange: TextRange;
    valueRange: TextRange;
}

export interface FocusPositionOffsetMeta {
    x: number;
    y: number;
    hasTrigger: boolean;
    triggerText?: string;
}

export type FocusTreeCreateKind = 'focus' | 'shared' | 'joint';

export interface FocusPositionMeta {
    editKey: string;
    focusId: string;
    editable: boolean;
    sourceFile: string;
    sourceRange?: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    basePosition: {
        x: number;
        y: number;
    };
    relativePositionId?: string;
    offsets: FocusPositionOffsetMeta[];
}

export interface FocusTreeCreateMeta {
    editKey: string;
    editable: boolean;
    kind: FocusTreeCreateKind;
    sourceFile: string;
    sourceRange?: TextRange;
    focusIdPrefix?: string;
}

export interface ApplyFocusPositionEditMessage {
    command: 'applyFocusPositionEdit';
    focusId: string;
    targetLocalX: number;
    targetLocalY: number;
    documentVersion: number;
}

export interface CreateFocusTemplateAtPositionMessage {
    command: 'createFocusTemplateAtPosition';
    treeEditKey: string;
    targetAbsoluteX: number;
    targetAbsoluteY: number;
    documentVersion: number;
}

export interface ApplyFocusLinkEditMessage {
    command: 'applyFocusLinkEdit';
    parentFocusId: string;
    childFocusId: string;
    targetLocalX: number;
    targetLocalY: number;
    documentVersion: number;
}

export interface ApplyFocusExclusiveLinkEditMessage {
    command: 'applyFocusExclusiveLinkEdit';
    sourceFocusId: string;
    targetFocusId: string;
    documentVersion: number;
}

export interface DeleteFocusMessage {
    command: 'deleteFocus';
    focusId: string;
    documentVersion: number;
}

export type FocusPositionEditMessage =
    | ApplyFocusPositionEditMessage
    | CreateFocusTemplateAtPositionMessage
    | ApplyFocusLinkEditMessage
    | ApplyFocusExclusiveLinkEditMessage
    | DeleteFocusMessage;

export function createFocusPositionEditKey(file: string, discriminator: string | number): string {
    return `focus:${file}:${discriminator}`;
}

export function createFocusTreeEditKey(file: string, kind: FocusTreeCreateKind, discriminator: string | number): string {
    return `focus-tree:${file}:${kind}:${discriminator}`;
}
