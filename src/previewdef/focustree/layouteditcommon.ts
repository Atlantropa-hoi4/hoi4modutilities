export type FocusLayoutTargetKind = 'focus' | 'continuous' | 'inlayRef';

export interface TextRange {
    start: number;
    end: number;
}

export interface FocusLayoutOffsetDraft {
    editKey: string;
    x: number;
    y: number;
    hasTrigger: boolean;
    triggerText?: string;
    isNew?: boolean;
}

export interface FocusLayoutFocusDraft {
    kind: 'focus';
    editKey: string;
    focusId: string;
    editable: boolean;
    sourceFile: string;
    sourceRange?: TextRange;
    x: number;
    y: number;
    relativePositionId: string | null;
    offsets: FocusLayoutOffsetDraft[];
}

export interface FocusLayoutPointDraft {
    kind: 'continuous' | 'inlayRef';
    editKey: string;
    editable: boolean;
    sourceFile: string;
    sourceRange?: TextRange;
    x: number;
    y: number;
    label: string;
}

export interface FocusLayoutDraft {
    baseVersion: number;
    focuses: Record<string, FocusLayoutFocusDraft>;
    continuous: Record<string, FocusLayoutPointDraft>;
    inlayRefs: Record<string, FocusLayoutPointDraft>;
}

export interface FocusLayoutOffsetMeta {
    editKey: string;
    x: number;
    y: number;
    hasTrigger: boolean;
    triggerText?: string;
}

export interface FocusLayoutFocusMeta {
    kind: 'focus';
    editKey: string;
    editable: boolean;
    sourceFile: string;
    sourceRange?: TextRange;
    basePosition: {
        x: number;
        y: number;
    };
    relativePositionId?: string;
    offsets: FocusLayoutOffsetMeta[];
}

export interface FocusLayoutPointMeta {
    kind: 'continuous' | 'inlayRef';
    editKey: string;
    editable: boolean;
    sourceFile: string;
    sourceRange?: TextRange;
    basePosition: {
        x: number;
        y: number;
    };
    label: string;
}

export interface FocusLayoutApplyMessage {
    command: 'focusLayoutApply';
    draft: FocusLayoutDraft;
}

export interface FocusLayoutDraftChangeMessage {
    command: 'focusLayoutDraftChange';
    draft: FocusLayoutDraft;
}

export interface FocusLayoutDiscardMessage {
    command: 'focusLayoutDiscard';
}

export interface FocusLayoutReloadMessage {
    command: 'focusLayoutReload';
}

export interface FocusLayoutApplyResultMessage {
    command: 'focusLayoutApplyResult';
    ok: boolean;
    stale?: boolean;
    message?: string;
}

export type FocusLayoutMessage =
    | FocusLayoutApplyMessage
    | FocusLayoutDraftChangeMessage
    | FocusLayoutDiscardMessage
    | FocusLayoutReloadMessage
    | FocusLayoutApplyResultMessage;

export function createLayoutEditKey(kind: FocusLayoutTargetKind | 'offset', file: string, discriminator: string | number): string {
    return `${kind}:${file}:${discriminator}`;
}
