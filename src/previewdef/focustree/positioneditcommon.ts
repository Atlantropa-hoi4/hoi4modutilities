export interface TextRange {
    start: number;
    end: number;
}

export interface ScalarFieldMeta {
    nodeRange: TextRange;
    valueRange: TextRange;
}

export interface FocusConditionPreset {
    id: string;
    name: string;
    exprKeys: string[];
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

interface FocusEditRequestBase {
    requestId: string;
    documentVersion: number;
}

export interface ApplyFocusPositionEditMessage extends FocusEditRequestBase {
    command: 'applyFocusPositionEdit';
    focusId: string;
    targetLocalX: number;
    targetLocalY: number;
}

export interface CreateFocusTemplateAtPositionMessage extends FocusEditRequestBase {
    command: 'createFocusTemplateAtPosition';
    treeEditKey: string;
    targetAbsoluteX: number;
    targetAbsoluteY: number;
}

export interface ApplyFocusLinkEditMessage extends FocusEditRequestBase {
    command: 'applyFocusLinkEdit';
    parentFocusId: string;
    parentFocusIds?: string[];
    childFocusId: string;
    targetLocalX: number;
    targetLocalY: number;
}

export interface ApplyFocusExclusiveLinkEditMessage extends FocusEditRequestBase {
    command: 'applyFocusExclusiveLinkEdit';
    sourceFocusId: string;
    targetFocusId: string;
}

export interface ApplyContinuousFocusPositionEditMessage extends FocusEditRequestBase {
    command: 'applyContinuousFocusPositionEdit';
    focusTreeEditKey: string;
    targetX: number;
    targetY: number;
}

export interface DeleteFocusMessage extends FocusEditRequestBase {
    command: 'deleteFocus';
    focusId: string;
    focusIds?: string[];
}

export interface PromptFocusConditionPresetNameMessage {
    command: 'promptFocusConditionPresetName';
    initialValue?: string;
}

export interface PersistFocusConditionPresetsMessage {
    command: 'persistFocusConditionPresets';
    presetsByTree: Record<string, FocusConditionPreset[]>;
}

export type FocusPositionEditMessage =
    | ApplyFocusPositionEditMessage
    | CreateFocusTemplateAtPositionMessage
    | ApplyFocusLinkEditMessage
    | ApplyFocusExclusiveLinkEditMessage
    | ApplyContinuousFocusPositionEditMessage
    | DeleteFocusMessage
    | PromptFocusConditionPresetNameMessage
    | PersistFocusConditionPresetsMessage;

export function createFocusPositionEditKey(file: string, discriminator: string | number): string {
    return `focus:${file}:${discriminator}`;
}

export function createFocusTreeEditKey(file: string, kind: FocusTreeCreateKind, discriminator: string | number): string {
    return `focus-tree:${file}:${kind}:${discriminator}`;
}
