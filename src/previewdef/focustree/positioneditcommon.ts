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

export interface ContinuousFocusPositionMeta {
    editKey: string;
    editable: boolean;
    sourceFile: string;
    focusTreeRange?: TextRange;
    sourceRange?: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    basePosition: {
        x: number;
        y: number;
    };
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
    parentFocusIds?: string[];
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

export interface ApplyContinuousFocusPositionEditMessage {
    command: 'applyContinuousFocusPositionEdit';
    focusTreeEditKey: string;
    targetX: number;
    targetY: number;
    documentVersion: number;
}

export interface DeleteFocusMessage {
    command: 'deleteFocus';
    focusId: string;
    documentVersion: number;
}

export interface PromptFocusConditionPresetNameMessage {
    command: 'promptFocusConditionPresetName';
    initialValue?: string;
}

export type FocusPositionEditMessage =
    | ApplyFocusPositionEditMessage
    | CreateFocusTemplateAtPositionMessage
    | ApplyFocusLinkEditMessage
    | ApplyFocusExclusiveLinkEditMessage
    | ApplyContinuousFocusPositionEditMessage
    | DeleteFocusMessage
    | PromptFocusConditionPresetNameMessage;

export function createFocusPositionEditKey(file: string, discriminator: string | number): string {
    return `focus:${file}:${discriminator}`;
}

export function createFocusTreeEditKey(file: string, kind: FocusTreeCreateKind, discriminator: string | number): string {
    return `focus-tree:${file}:${kind}:${discriminator}`;
}
