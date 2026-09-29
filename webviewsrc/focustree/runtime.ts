import type { ConditionItem } from '../../src/hoiformat/condition';
import type { NumberPosition } from '../../src/util/common';
import type { GridBoxType } from '../../src/hoiformat/gui';
import type { FocusConditionPresetsByTree } from '../../src/previewdef/focustree/conditionpresets';
import type { FocusTreeCatalogView, FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import { LatestOnlyBuildGuard } from '../../src/previewdef/focustree/buildguard';
import { toFocusTreeCatalogViews } from '../../src/previewdef/focustree/viewmodel';
import { getState } from '../util/common';
import type { DivDropdown } from '../util/dropdown';
import { createFocusTreeWebviewInitialState } from './state';

declare global {
    interface Window {
        useConditionInFocus: boolean;
        focusTrees: FocusTreeView[];
        persistedConditionPresetsByTree: FocusConditionPresetsByTree;
        focusPositionDocumentVersion?: number;
        focusPositionActiveFile?: string;
        xGridSize: number;
        yGridSize?: number;
        focusToolbarHeight?: number;
        previewedFileUri?: string;
        focusTreeTraceEnabled?: boolean;
        gridBox: GridBoxType;
        focusTemplates?: Record<string, string>;
        focusTemplateKeyById?: Record<string, string>;
        renderedInlayWindows?: Record<string, string>;
        styleNonce: string;
    }
}

export type PendingFocusLinkType = 'prerequisite' | 'exclusive';

/**
 * Mutable webview state shared by the focus tree modules. Scene DOM bookkeeping lives in
 * `FocusScene`; this object holds document, selection, and interaction state.
 */
export interface FocusTreeWebviewRuntime {
    readonly useConditionInFocus: boolean;
    readonly focusToolbarHeight: number;
    readonly contentBuildGuard: LatestOnlyBuildGuard;
    focusTrees: FocusTreeView[];
    focusTreeCatalog: FocusTreeCatalogView[];
    selectedExprs: ConditionItem[];
    conditionPresetsByTree: FocusConditionPresetsByTree;
    selectedFocusTreeIndex: number;
    selectedFocusTreeId: string | undefined;
    selectedFocusIdsByTree: Record<string, string[]>;
    selectedSearchFilters: string[];
    focusPositionEditMode: boolean;
    activeFocusEditRequestId: string | undefined;
    focusEditRequestSequence: number;
    /** Tree whose scene is currently rendered. */
    renderedFocusTree: FocusTreeView | undefined;
    renderedExprs: ConditionItem[];
    /** Host GUI card templates and the template key of each focus that uses one. */
    focusTemplates: Record<string, string>;
    focusTemplateKeyById: Record<string, string>;
    focusPositions: Record<string, NumberPosition>;
    occupiedFocusPositionKeys: Set<string>;
    relatedFocusIdsById: Record<string, ReadonlySet<string>>;
    completableFocusIds: ReadonlySet<string>;
    selectedFocusIds: Set<string>;
    searchTextByFocusId: Record<string, string>;
    searchResultIds: Set<string>;
    searchFilterMatchIds: Set<string>;
    hoveredRelationFocusId: string | undefined;
    pendingFocusLinkParentId: string | undefined;
    pendingFocusLinkParentIds: string[];
    pendingFocusLinkType: PendingFocusLinkType | undefined;
    cancelActiveFocusPositionDrag: (() => void) | undefined;
    suppressEditableFocusClickUntil: number;
    snapshotVersion: number;
    sceneRevision: number;
    latestRequestId: number;
    focusPositionDocumentVersion: number;
    focusPositionActiveFile: string;
    xGridSize: number;
    yGridSize: number;
    gridLeftPadding: number;
    gridTopPadding: number;
    pendingPlaceholderFocusIdsByTree: Record<string, Set<string>>;
    dropdowns: {
        searchFilters?: DivDropdown;
        allowBranches?: DivDropdown;
        conditions?: DivDropdown;
        conditionPresets?: DivDropdown;
        inlayWindows?: DivDropdown;
    };
    suppressConditionSelectionChange: boolean;
    suppressConditionPresetSelectionChange: boolean;
    suppressInlayWindowSelectionChange: boolean;
    pendingConditionPresetTargetTreeId: string | undefined;
    pendingConditionPresetExprKeys: string[];
    readonly initialSearchboxValue: string;
}

const restoredState = getState();
const initialWebviewState = createFocusTreeWebviewInitialState(restoredState, window.persistedConditionPresetsByTree);
const bootstrapFocusTrees = window.focusTrees ?? [];

export const runtime: FocusTreeWebviewRuntime = {
    useConditionInFocus: window.useConditionInFocus,
    focusToolbarHeight: window.focusToolbarHeight ?? 68,
    contentBuildGuard: new LatestOnlyBuildGuard(),
    focusTrees: bootstrapFocusTrees,
    focusTreeCatalog: toFocusTreeCatalogViews(bootstrapFocusTrees),
    selectedExprs: initialWebviewState.selectedExprs,
    conditionPresetsByTree: initialWebviewState.conditionPresetsByTree,
    selectedFocusTreeIndex: initialWebviewState.selectedFocusTreeIndex,
    selectedFocusTreeId: initialWebviewState.selectedFocusTreeId,
    selectedFocusIdsByTree: initialWebviewState.selectedFocusIdsByTree,
    selectedSearchFilters: Array.isArray(restoredState.selectedSearchFilters)
        ? restoredState.selectedSearchFilters.filter((value: unknown): value is string => typeof value === 'string')
        : [],
    focusPositionEditMode: initialWebviewState.focusPositionEditMode,
    activeFocusEditRequestId: undefined,
    focusEditRequestSequence: 0,
    renderedFocusTree: undefined,
    renderedExprs: [],
    focusTemplates: window.focusTemplates ?? {},
    focusTemplateKeyById: window.focusTemplateKeyById ?? {},
    focusPositions: {},
    occupiedFocusPositionKeys: new Set(),
    relatedFocusIdsById: {},
    completableFocusIds: new Set(),
    selectedFocusIds: new Set(),
    searchTextByFocusId: {},
    searchResultIds: new Set(),
    searchFilterMatchIds: new Set(),
    hoveredRelationFocusId: undefined,
    pendingFocusLinkParentId: undefined,
    pendingFocusLinkParentIds: [],
    pendingFocusLinkType: undefined,
    cancelActiveFocusPositionDrag: undefined,
    suppressEditableFocusClickUntil: 0,
    snapshotVersion: 0,
    sceneRevision: 0,
    latestRequestId: 0,
    focusPositionDocumentVersion: window.focusPositionDocumentVersion ?? 0,
    focusPositionActiveFile: window.focusPositionActiveFile ?? '',
    xGridSize: window.xGridSize,
    yGridSize: window.yGridSize ?? 130,
    gridLeftPadding: 0,
    gridTopPadding: 0,
    pendingPlaceholderFocusIdsByTree: {},
    dropdowns: {},
    suppressConditionSelectionChange: false,
    suppressConditionPresetSelectionChange: false,
    suppressInlayWindowSelectionChange: false,
    pendingConditionPresetTargetTreeId: undefined,
    pendingConditionPresetExprKeys: [],
    initialSearchboxValue: initialWebviewState.searchboxValue,
};

export function getFocusPositionKey(position: NumberPosition): string {
    return `${position.x},${position.y}`;
}

export function setFocusPositions(nextPositions: Record<string, NumberPosition>): void {
    runtime.focusPositions = nextPositions;
    runtime.occupiedFocusPositionKeys = new Set(Object.values(nextPositions).map(getFocusPositionKey));
}

export function hasPendingFocusLink(): boolean {
    return runtime.pendingFocusLinkParentId !== undefined && runtime.pendingFocusLinkType !== undefined;
}

export function rebuildRelationIndex(focusTree: FocusTreeView): void {
    const mutableIndex: Record<string, Set<string>> = {};
    const ensure = (focusId: string) => mutableIndex[focusId] ?? (mutableIndex[focusId] = new Set([focusId]));
    for (const focus of Object.values(focusTree.focuses)) {
        const related = ensure(focus.id);
        const link = (relatedFocusId: string) => {
            if (!focusTree.focuses[relatedFocusId]) {
                return;
            }
            related.add(relatedFocusId);
            ensure(relatedFocusId).add(focus.id);
        };
        for (const group of focus.prerequisite) {
            group.forEach(link);
        }
        focus.exclusive.forEach(link);
        if (focus.relativePositionId) {
            link(focus.relativePositionId);
        }
    }
    runtime.relatedFocusIdsById = mutableIndex;
}

export function getPendingPlaceholderFocusIds(treeId: string): Set<string> {
    return runtime.pendingPlaceholderFocusIdsByTree[treeId] ?? (runtime.pendingPlaceholderFocusIdsByTree[treeId] = new Set<string>());
}

function clearPendingPlaceholderFocus(treeId: string, focusId: string): void {
    const treePendingIds = runtime.pendingPlaceholderFocusIdsByTree[treeId];
    if (!treePendingIds) {
        return;
    }

    treePendingIds.delete(focusId);
    if (treePendingIds.size === 0) {
        delete runtime.pendingPlaceholderFocusIdsByTree[treeId];
    }
}

export function clearMissingPendingPlaceholderFocusIds(): void {
    for (const [treeId, pendingIds] of Object.entries(runtime.pendingPlaceholderFocusIdsByTree)) {
        const focusTree = runtime.focusTrees.find(tree => tree.id === treeId);
        if (!focusTree) {
            delete runtime.pendingPlaceholderFocusIdsByTree[treeId];
            continue;
        }

        Array.from(pendingIds).forEach(focusId => {
            if (!focusTree.focuses[focusId]) {
                pendingIds.delete(focusId);
            }
        });

        if (pendingIds.size === 0) {
            delete runtime.pendingPlaceholderFocusIdsByTree[treeId];
        }
    }
}

/** Focuses that received host card templates are no longer local placeholders. */
export function clearPendingPlaceholderFocusIdsForTemplateKeys(keyById: Record<string, string> | undefined): void {
    if (!keyById) {
        return;
    }

    for (const focusId of Object.keys(keyById)) {
        const focusTree = runtime.focusTrees.find(tree => !!tree.focuses[focusId]);
        if (focusTree) {
            clearPendingPlaceholderFocus(focusTree.id, focusId);
        }
    }
}

export function getSearchText(focusId: string, displayName: string | undefined): string {
    return `${focusId} ${displayName ?? ''}`.trim().toLowerCase();
}
