import * as path from 'path';
import { ConditionItem, ConditionComplexExpr, extractConditionValue } from "../../hoiformat/condition";
import { Node, Token } from "../../hoiformat/hoiparser";
import { ContainerWindowType } from "../../hoiformat/gui";
import { HOIPartial, SchemaDef, Position, convertNodeToJson, positionSchema, Raw } from "../../hoiformat/schema";
import { countryScope } from "../../hoiformat/scope";
import { Warning } from "../../util/common";
import { localize } from "../../util/i18n";
import { ContinuousFocusPositionMeta, FocusPositionMeta, FocusTreeCreateMeta } from "./positioneditcommon";

export type FocusTreeKind = 'focus' | 'shared' | 'joint';

export interface FocusTree {
    id: string;
    kind: FocusTreeKind;
    focuses: Record<string, Focus>;
    createTemplate?: FocusTreeCreateMeta;
    continuousLayout?: ContinuousFocusPositionMeta;
    inlayWindowRefs: FocusTreeInlayRef[];
    inlayWindows: FocusTreeInlay[];
    inlayConditionExprs: ConditionItem[];
    allowBranchOptions: string[];
    conditionExprs: ConditionItem[];
    isSharedFocues: boolean;
    continuousFocusPositionX?: number;
    continuousFocusPositionY?: number;
    warnings: FocusWarning[];
}

interface FocusIconWithCondition {
    icon: string | undefined;
    condition: ConditionComplexExpr;
}

export interface Focus {
    layoutEditKey: string;
    x: number;
    y: number;
    id: string;
    icon: FocusIconWithCondition[];
    available?: ConditionComplexExpr;
    availableIfCapitulated: boolean;
    hasAiWillDo: boolean;
    hasCompletionReward: boolean;
    prerequisite: string[][];
    prerequisiteGroupCount: number;
    prerequisiteFocusCount: number;
    exclusive: string[];
    exclusiveCount: number;
    hasAllowBranch: boolean;
    inAllowBranch: string[];
    allowBranch: ConditionComplexExpr | undefined;
    relativePositionId: string | undefined;
    offset: Offset[];
    token: Token | undefined;
    file: string;
    isInCurrentFile: boolean;
    text?: string;
    layout?: FocusPositionMeta;
    lintWarningCount: number;
    lintInfoCount: number;
    lintMessages?: string[];
}

export interface FocusWarning extends Warning<string> {
    code: string;
    severity: 'warning' | 'info';
    kind: 'parse' | 'lint';
    relatedFocusIds?: string[];
    navigations?: { file: string, start: number, end: number }[];
}

export interface FocusTreeInlayRef {
    id: string;
    position: { x: number, y: number };
    file: string;
    token: Token | undefined;
}

export interface FocusTreeInlay {
    id: string;
    file: string;
    token: Token | undefined;
    windowName?: string;
    guiFile?: string;
    guiWindow?: HOIPartial<ContainerWindowType>;
    internal: boolean;
    visible: ConditionComplexExpr;
    position: { x: number, y: number };
    scriptedImages: FocusInlayImageSlot[];
    scriptedButtons: FocusTreeInlayButtonMeta[];
    conditionExprs: ConditionItem[];
}

export interface FocusInlayImageSlot {
    id: string;
    file: string;
    token: Token | undefined;
    gfxOptions: FocusInlayGfxOption[];
}

export interface FocusInlayGfxOption {
    gfxName: string;
    condition: ConditionComplexExpr;
    file: string;
    token: Token | undefined;
    gfxFile?: string;
}

export interface FocusTreeInlayButtonMeta {
    id: string;
    file: string;
    token: Token | undefined;
    available?: ConditionComplexExpr;
}

interface Offset {
    x: number;
    y: number;
    trigger: ConditionComplexExpr | undefined;
}

export interface FocusTreeDef {
    id: string;
    shared_focus: string[];
    focus: FocusDef[];
    continuous_focus_position: Position;
    inlay_window: Raw[];
}

export interface FocusDef {
    id: string;
    icon: Raw[];
    available: Raw;
    available_if_capitulated: boolean;
    ai_will_do: Raw;
    completion_reward: Raw;
    x: number;
    y: number;
    prerequisite: FocusOrORList[];
    mutually_exclusive: FocusOrORList[];
    relative_position_id: string;
    allow_branch: Raw[];
    offset: OffsetDef[];
    _token: Token;
    text?: string;
}

interface FocusIconDef {
    trigger: Raw;
    value: string;
}

interface OffsetDef {
    x: number;
    y: number;
    trigger: Raw[];
}

interface FocusOrORList {
    focus: string[];
    OR: string[];
}

export interface FocusFile {
    focus_tree: FocusTreeDef[];
    shared_focus: FocusDef[];
    joint_focus: FocusDef[];
}

const focusOrORListSchema: SchemaDef<FocusOrORList> = {
    focus: {
        _innerType: "string",
        _type: 'array',
    },
    OR: {
        _innerType: "string",
        _type: 'array',
    },
};

const focusSchema: SchemaDef<FocusDef> = {
    id: "string",
    icon: {
        _innerType: 'raw',
        _type: 'array',
    },
    available: "raw",
    available_if_capitulated: "boolean",
    ai_will_do: "raw",
    completion_reward: "raw",
    x: "number",
    y: "number",
    prerequisite: {
        _innerType: focusOrORListSchema,
        _type: 'array',
    },
    mutually_exclusive: {
        _innerType: focusOrORListSchema,
        _type: 'array',
    },
    relative_position_id: "string",
    allow_branch: {
        _innerType: 'raw',
        _type: 'array',
    },
    offset: {
        _innerType: {
            x: "number",
            y: "number",
            trigger: {
                _innerType: 'raw',
                _type: 'array',
            },
        },
        _type: 'array',
    },
    text: "string",
};

const focusTreeSchema: SchemaDef<FocusTreeDef> = {
    id: "string",
    shared_focus: {
        _innerType: "string",
        _type: "array",
    },
    focus: {
        _innerType: focusSchema,
        _type: 'array',
    },
    continuous_focus_position: positionSchema,
    inlay_window: {
        _innerType: 'raw',
        _type: 'array',
    },
};

const focusFileSchema: SchemaDef<FocusFile> = {
    focus_tree: {
        _innerType: focusTreeSchema,
        _type: "array",
    },
    shared_focus: {
        _innerType: focusSchema,
        _type: "array",
    },
    joint_focus: {
        _innerType: focusSchema,
        _type: "array",
    },
};

const focusIconSchema: SchemaDef<FocusIconDef> = {
    trigger: "raw",
    value: "string",
};

export function convertFocusFileNodeToJson(node: Node, constants: {}): HOIPartial<FocusFile> {
    return convertNodeToJson<FocusFile>(node, focusFileSchema, constants);
}

export function extractFocusIds(node: Node): string[] {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);
    const ids: string[] = [];

    for (const tree of file.focus_tree) {
        for (const focus of tree.focus) {
            if (focus.id) {
                ids.push(focus.id);
            }
        }
    }

    for (const focus of file.shared_focus) {
        if (focus.id) {
            ids.push(focus.id);
        }
    }

    for (const focus of file.joint_focus) {
        if (focus.id) {
            ids.push(focus.id);
        }
    }

    return ids;
}

export function getJointFocusTreeId(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    const label = localize('TODO', '<Joint focus tree>');
    return fileName ? `${label} (${fileName})` : label;
}

export function parseFocusIcon(nodes: Node[], constants: {}): Focus['icon'] {
    return nodes.map(n => parseSingleFocusIcon(n, constants)).filter((v): v is FocusIconWithCondition => v !== undefined);
}

function parseSingleFocusIcon(node: Node, constants: {}): FocusIconWithCondition {
    const stringResult = convertNodeToJson<string>(node, 'string', constants);
    if (stringResult) {
        return { icon: stringResult, condition: true };
    }

    const iconWithCondition = convertNodeToJson<FocusIconDef>(node, focusIconSchema, constants);
    return {
        icon: iconWithCondition.value,
        condition: iconWithCondition.trigger ? extractConditionValue(iconWithCondition.trigger._raw.value, countryScope, []).condition : true,
    };
}
