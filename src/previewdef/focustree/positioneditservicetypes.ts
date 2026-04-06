import { ScalarFieldMeta, TextRange } from "./positioneditcommon";

export interface FocusReferenceFieldMeta {
    range: TextRange;
    focusIds: string[];
    hasOrWrapper: boolean;
    fieldName: string;
}

export interface FocusNodeMeta {
    focusId: string;
    sourceRange: TextRange;
    x?: ScalarFieldMeta;
    y?: ScalarFieldMeta;
    relativePositionId?: ScalarFieldMeta;
    currentRelativePositionId?: string;
    prerequisiteIds: string[];
    prerequisiteFields: FocusReferenceFieldMeta[];
    exclusiveIds: string[];
    exclusiveFields: FocusReferenceFieldMeta[];
    linkInsertAnchorStart?: number;
    firstOffsetStart?: number;
}

export interface FocusPositionTextChange {
    range: TextRange;
    text: string;
}

export interface FocusPositionTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface CreateFocusTemplateTextChangeResult {
    changes?: FocusPositionTextChange[];
    placeholderFocusId?: string;
    placeholderRange?: TextRange;
    error?: string;
}

export interface FocusLinkTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface FocusExclusiveLinkTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}

export interface FocusDeleteTextChangeResult {
    changes?: FocusPositionTextChange[];
    error?: string;
}
