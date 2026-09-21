import type { ConditionComplexExpr, ConditionItem } from '../../hoiformat/condition';
import type {
    Focus,
    FocusTree,
    FocusTreeInlay,
    FocusTreeKind,
    FocusWarning,
} from './schema';
import type { ContinuousFocusPositionMeta, FocusTreeCreateMeta } from './positioneditcommon';

export const focusTreeProtocolVersion = 2 as const;

export interface FocusView {
    id: string;
    layoutEditKey: string;
    x: number;
    y: number;
    icon: Focus['icon'];
    prerequisite: string[][];
    prerequisiteGroupCount: number;
    prerequisiteFocusCount: number;
    exclusive: string[];
    exclusiveCount: number;
    inAllowBranch: string[];
    allowBranch?: ConditionComplexExpr;
    relativePositionId?: string;
    offset: Focus['offset'];
    searchFilters: string[];
    file: string;
    start?: number;
    end?: number;
    editable?: boolean;
    sourceFile?: string;
}

export interface FocusInlayGfxOptionView {
    gfxName: string;
    condition: ConditionComplexExpr;
    gfxFile?: string;
}

export interface FocusInlayImageSlotView {
    id: string;
    gfxOptions: FocusInlayGfxOptionView[];
}

export interface FocusTreeInlayView {
    id: string;
    visible: ConditionComplexExpr;
    position: { x: number; y: number };
    scriptedImages: FocusInlayImageSlotView[];
}

export interface FocusTreeView {
    id: string;
    kind: FocusTreeKind;
    focuses: Record<string, FocusView>;
    createTemplate?: FocusTreeCreateMeta;
    continuousLayout?: ContinuousFocusPositionMeta;
    inlayWindows: FocusTreeInlayView[];
    allowBranchOptions: string[];
    conditionExprs: ConditionItem[];
    isSharedFocues: boolean;
    continuousFocusPositionX?: number;
    continuousFocusPositionY?: number;
    warnings: FocusWarning[];
    searchFilters: string[];
    searchFilterLabels?: Record<string, string>;
}

export interface FocusTreeAssetPatch {
    dynamicStyleCss?: string;
    renderedFocusPatch?: Record<string, string>;
    renderedInlayWindowPatch?: Record<string, string>;
    removedRenderedFocusIds?: string[];
    removedRenderedInlayWindowIds?: string[];
}

export function toFocusTreeViews(focusTrees: readonly FocusTree[]): FocusTreeView[] {
    return focusTrees.map(toFocusTreeView);
}

export function toFocusTreeView(focusTree: FocusTree): FocusTreeView {
    return {
        id: focusTree.id,
        kind: focusTree.kind,
        focuses: Object.fromEntries(
            Object.entries(focusTree.focuses).map(([focusId, focus]) => [focusId, toFocusView(focus)]),
        ),
        createTemplate: focusTree.createTemplate,
        continuousLayout: focusTree.continuousLayout,
        inlayWindows: focusTree.inlayWindows.map(toFocusTreeInlayView),
        allowBranchOptions: focusTree.allowBranchOptions,
        conditionExprs: focusTree.conditionExprs,
        isSharedFocues: focusTree.isSharedFocues,
        continuousFocusPositionX: focusTree.continuousFocusPositionX,
        continuousFocusPositionY: focusTree.continuousFocusPositionY,
        warnings: focusTree.warnings,
        searchFilters: focusTree.searchFilters,
        searchFilterLabels: focusTree.searchFilterLabels,
    };
}

function toFocusView(focus: Focus): FocusView {
    return {
        id: focus.id,
        layoutEditKey: focus.layoutEditKey,
        x: focus.x,
        y: focus.y,
        icon: focus.icon,
        prerequisite: focus.prerequisite,
        prerequisiteGroupCount: focus.prerequisiteGroupCount,
        prerequisiteFocusCount: focus.prerequisiteFocusCount,
        exclusive: focus.exclusive,
        exclusiveCount: focus.exclusiveCount,
        inAllowBranch: focus.inAllowBranch,
        allowBranch: focus.allowBranch,
        relativePositionId: focus.relativePositionId,
        offset: focus.offset,
        searchFilters: focus.searchFilters,
        file: focus.file,
        start: focus.token?.start,
        end: focus.token?.end,
        editable: focus.isInCurrentFile && focus.layout?.editable === true,
        sourceFile: focus.layout?.sourceFile ?? focus.file,
    };
}

function toFocusTreeInlayView(inlay: FocusTreeInlay): FocusTreeInlayView {
    return {
        id: inlay.id,
        visible: inlay.visible,
        position: inlay.position,
        scriptedImages: inlay.scriptedImages.map(slot => ({
            id: slot.id,
            gfxOptions: slot.gfxOptions.map(option => ({
                gfxName: option.gfxName,
                condition: option.condition,
                gfxFile: option.gfxFile,
            })),
        })),
    };
}
