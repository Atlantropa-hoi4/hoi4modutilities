import type { ConditionComplexExpr, ConditionItem } from '../../hoiformat/condition';
import type {
    Focus,
    FocusTree,
    FocusTreeInlay,
    FocusTreeKind,
    FocusWarning,
} from './schema';
import type { ContinuousFocusPositionMeta, FocusTreeCreateMeta } from './positioneditcommon';

export const focusTreeProtocolVersion = 5 as const;

export interface FocusTreeCatalogView {
    id: string;
    kind: FocusTreeKind;
    focusCount: number;
    warningCount: number;
}

export interface FocusView {
    id: string;
    displayName?: string;
    x: number;
    y: number;
    icon: Focus['icon'];
    overlay?: string;
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

export type FocusTreeHeaderView = Omit<FocusTreeView, 'focuses'>;

/** Source range of a focus definition. JSON messages carry missing offsets as null. */
export type FocusRangeView = [start: number | null, end: number | null];

/**
 * Changes to one tree whose focus ids and order are unchanged. Source offsets move on almost
 * every edit, so focus ranges and warning navigation ranges travel separately from the data
 * that would otherwise have to be resent in full.
 */
export interface FocusTreeViewDelta {
    header?: Omit<FocusTreeHeaderView, 'warnings'>;
    warnings?: FocusWarning[];
    /** Navigation ranges per warning, used when only offsets changed. */
    warningRanges?: Array<Array<[start: number, end: number]>>;
    focuses?: Record<string, FocusView>;
    ranges?: Record<string, FocusRangeView>;
}

export interface FocusTreeViewPatch {
    treeId: string;
    /** Complete replacement, used when focuses were added, removed, or reordered. */
    tree?: FocusTreeView;
    delta?: FocusTreeViewDelta;
}

/**
 * Returns the patched tree. Unchanged header fields keep their references so consumers can skip
 * work by identity. Range-only warning updates adjust navigation offsets in place.
 */
export function applyFocusTreeViewDelta(tree: FocusTreeView, delta: FocusTreeViewDelta): FocusTreeView {
    const focuses = { ...tree.focuses };
    if (delta.focuses) {
        for (const [focusId, focus] of Object.entries(delta.focuses)) {
            if (focusId in focuses) {
                focuses[focusId] = focus;
            }
        }
    }
    if (delta.ranges) {
        for (const [focusId, [start, end]] of Object.entries(delta.ranges)) {
            const focus = focuses[focusId];
            if (focus) {
                focuses[focusId] = { ...focus, start: start ?? undefined, end: end ?? undefined };
            }
        }
    }
    const warnings = delta.warnings ?? tree.warnings;
    if (!delta.warnings && delta.warningRanges) {
        delta.warningRanges.forEach((ranges, warningIndex) => {
            ranges.forEach(([start, end], navigationIndex) => {
                const navigation = warnings[warningIndex]?.navigations?.[navigationIndex];
                if (navigation) {
                    navigation.start = start;
                    navigation.end = end;
                }
            });
        });
    }
    return {
        ...(delta.header ?? toFocusTreeHeaderView(tree)),
        warnings,
        focuses,
    };
}

export function toFocusTreeHeaderView(tree: FocusTreeView): FocusTreeHeaderView {
    const { focuses: _focuses, ...header } = tree;
    return header;
}

export function toFocusTreeCatalogViews(focusTrees: readonly FocusTreeView[]): FocusTreeCatalogView[] {
    return focusTrees.map(tree => ({
        id: tree.id,
        kind: tree.kind,
        focusCount: Object.keys(tree.focuses).length,
        warningCount: tree.warnings.length,
    }));
}

export function toFocusTreeViews(
    focusTrees: readonly FocusTree[],
    displayNameByFocusId: Readonly<Record<string, string>> = {},
): FocusTreeView[] {
    return focusTrees.map(focusTree => toFocusTreeView(focusTree, displayNameByFocusId));
}

export function toFocusTreeView(
    focusTree: FocusTree,
    displayNameByFocusId: Readonly<Record<string, string>> = {},
): FocusTreeView {
    return {
        id: focusTree.id,
        kind: focusTree.kind,
        focuses: Object.fromEntries(
            Object.entries(focusTree.focuses).map(([focusId, focus]) => [
                focusId,
                toFocusView(focus, displayNameByFocusId[focusId]),
            ]),
        ),
        createTemplate: toFocusTreeCreateView(focusTree.createTemplate),
        continuousLayout: toContinuousFocusLayoutView(focusTree.continuousLayout),
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

// Edit handlers re-read source ranges from the current document, so views omit them and stay
// stable while text above the tree changes.
function toFocusTreeCreateView(meta: FocusTreeCreateMeta | undefined): FocusTreeCreateMeta | undefined {
    return meta && {
        editKey: meta.editKey,
        editable: meta.editable,
        kind: meta.kind,
        sourceFile: meta.sourceFile,
        focusIdPrefix: meta.focusIdPrefix,
    };
}

function toContinuousFocusLayoutView(meta: ContinuousFocusPositionMeta | undefined): ContinuousFocusPositionMeta | undefined {
    return meta && {
        editKey: meta.editKey,
        editable: meta.editable,
        sourceFile: meta.sourceFile,
        basePosition: { x: meta.basePosition.x, y: meta.basePosition.y },
    };
}

export function toFocusView(focus: Focus, displayName: string | undefined): FocusView {
    return {
        id: focus.id,
        displayName,
        x: focus.x,
        y: focus.y,
        icon: focus.icon,
        overlay: focus.overlay,
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
