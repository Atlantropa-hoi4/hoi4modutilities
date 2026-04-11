import { applyCondition, ConditionItem } from "../../hoiformat/condition";
import { NumberPosition } from "../../util/common";
import { normalizeForStyle } from "../../util/styletable";
import { GridBoxConnection, GridBoxItem } from "../../util/hoi4gui/gridboxcommon";
import { collectCompletedFocusIds } from "./conditionexprs";
import { getFocusPosition } from "./positioning";
import { Focus, FocusTree } from "./schema";

export interface FocusTreeLayoutPlan {
    focusGridBoxItems: GridBoxItem[];
    focusPosition: Record<string, NumberPosition>;
    completableFocusIds: ReadonlySet<string>;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface FocusTreeResolvedLayoutPlan {
    layoutPlan: FocusTreeLayoutPlan;
    renderExprs: ConditionItem[];
    clearedSelectedExprs: boolean;
}

const focusTreeLayoutPlanCache = new WeakMap<FocusTree, Map<string, FocusTreeLayoutPlan>>();

export function getCachedFocusTreeLayoutPlan(
    focusTree: FocusTree,
    exprs: ConditionItem[],
    hideDisallowedFocuses: boolean,
): FocusTreeLayoutPlan {
    const cacheKey = getLayoutPlanCacheKey(exprs, hideDisallowedFocuses);
    const cachedPlans = focusTreeLayoutPlanCache.get(focusTree);
    const cachedPlan = cachedPlans?.get(cacheKey);
    if (cachedPlan) {
        return cachedPlan;
    }

    const nextPlan = buildFocusTreeLayoutPlan(focusTree, exprs, hideDisallowedFocuses);
    let nextCachedPlans = cachedPlans;
    if (!nextCachedPlans) {
        nextCachedPlans = new Map<string, FocusTreeLayoutPlan>();
        focusTreeLayoutPlanCache.set(focusTree, nextCachedPlans);
    }
    nextCachedPlans.set(cacheKey, nextPlan);
    return nextPlan;
}

export function invalidateCachedFocusTreeLayoutPlan(focusTree: FocusTree | undefined) {
    if (!focusTree) {
        return;
    }

    focusTreeLayoutPlanCache.delete(focusTree);
}

export function resolveFocusTreeLayoutPlan(
    focusTree: FocusTree,
    checkedExprs: ConditionItem[],
    selectedExprs: ConditionItem[],
    hideDisallowedFocuses: boolean,
): FocusTreeResolvedLayoutPlan {
    const baseExprs = [{ scopeName: '', nodeContent: `has_focus_tree = ${focusTree.id}` }, ...checkedExprs, ...selectedExprs];
    const baseLayoutPlan = getCachedFocusTreeLayoutPlan(focusTree, baseExprs, hideDisallowedFocuses);
    if (baseLayoutPlan.focusGridBoxItems.length > 0
        || Object.keys(focusTree.focuses).length === 0
        || selectedExprs.length === 0) {
        return {
            layoutPlan: baseLayoutPlan,
            renderExprs: baseExprs,
            clearedSelectedExprs: false,
        };
    }

    const fallbackExprs = [{ scopeName: '', nodeContent: `has_focus_tree = ${focusTree.id}` }, ...checkedExprs];
    return {
        layoutPlan: getCachedFocusTreeLayoutPlan(focusTree, fallbackExprs, hideDisallowedFocuses),
        renderExprs: fallbackExprs,
        clearedSelectedExprs: true,
    };
}

function buildFocusTreeLayoutPlan(
    focusTree: FocusTree,
    exprs: ConditionItem[],
    hideDisallowedFocuses: boolean,
): FocusTreeLayoutPlan {
    const focuses = Object.values(focusTree.focuses);
    const allowBranchOptionsValue = buildAllowBranchOptionsValue(focusTree, exprs);
    const focusPosition: Record<string, NumberPosition> = {};
    const focusGridBoxItems = focuses
        .map(focus => focusToGridItem(focus, focusTree, allowBranchOptionsValue, exprs, hideDisallowedFocuses, focusPosition))
        .filter((value): value is GridBoxItem => !!value);
    const focusPositions = Object.values(focusPosition);

    return {
        focusGridBoxItems,
        focusPosition,
        completableFocusIds: collectCompletedFocusIds(focusTree.conditionExprs),
        minX: focusPositions.reduce((min, position) => Math.min(min, position.x), 0),
        minY: focusPositions.reduce((min, position) => Math.min(min, position.y), 0),
        maxX: focusPositions.reduce((max, position) => Math.max(max, position.x), 0),
        maxY: focusPositions.reduce((max, position) => Math.max(max, position.y), 0),
    };
}

function getLayoutPlanCacheKey(exprs: ConditionItem[], hideDisallowedFocuses: boolean): string {
    return `${hideDisallowedFocuses ? 'hide' : 'show'}\u001e${exprs
        .map(expr => `${expr.scopeName}!|${expr.nodeContent}`)
        .sort()
        .join('\u001f')}`;
}

function buildAllowBranchOptionsValue(
    focusTree: FocusTree,
    exprs: ConditionItem[],
): Record<string, boolean> {
    const allowBranchOptionsValue: Record<string, boolean> = {};
    focusTree.allowBranchOptions.forEach(option => {
        const focus = focusTree.focuses[option];
        allowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || applyCondition(focus.allowBranch, exprs);
    });

    if (focusTree.isSharedFocues) {
        focusTree.allowBranchOptions.forEach(option => {
            allowBranchOptionsValue[option] = true;
        });
    }

    const focuses = focusTree.focuses;
    let changed = true;
    while (changed) {
        changed = false;
        for (const key in focuses) {
            const focus = focuses[key];
            if (focus.prerequisite.length === 0 || focus.id in allowBranchOptionsValue) {
                continue;
            }

            let allow = true;
            for (const andPrerequests of focus.prerequisite) {
                if (andPrerequests.length === 0) {
                    continue;
                }

                allow = allow && andPrerequests.some(prerequisiteId => allowBranchOptionsValue[prerequisiteId] === true);
                const deny = andPrerequests.every(prerequisiteId => allowBranchOptionsValue[prerequisiteId] === false);
                if (deny) {
                    allowBranchOptionsValue[focus.id] = false;
                    changed = true;
                    break;
                }
            }

            if (allow) {
                allowBranchOptionsValue[focus.id] = true;
                changed = true;
            }
        }
    }

    return allowBranchOptionsValue;
}

function focusToGridItem(
    focus: Focus,
    focusTree: FocusTree,
    allowBranchOptionsValue: Record<string, boolean>,
    exprs: ConditionItem[],
    hideDisallowedFocuses: boolean,
    positionByFocusId: Record<string, NumberPosition>,
): GridBoxItem | undefined {
    if (hideDisallowedFocuses && allowBranchOptionsValue[focus.id] === false) {
        return undefined;
    }

    const classNames = focus.inAllowBranch.map(value => 'inbranch_' + value).join(' ');
    const connections: GridBoxConnection[] = [];

    for (const prerequisites of focus.prerequisite) {
        const groupedPrerequisite = prerequisites.length > 1;
        const style = groupedPrerequisite ? "1px dashed rgba(136, 170, 255, 0.5)" : "1px solid rgba(136, 170, 255, 0.5)";

        prerequisites.forEach(prerequisiteId => {
            const prerequisiteFocus = focusTree.focuses[prerequisiteId];
            const prerequisiteClassNames = prerequisiteFocus?.inAllowBranch.map(value => 'inbranch_' + value).join(' ') ?? '';
            const normalizedFocusId = normalizeFocusIdForClassName(focus.id);
            const normalizedTargetId = normalizeFocusIdForClassName(prerequisiteId);
            connections.push({
                target: prerequisiteId,
                targetType: 'parent',
                style,
                classNames: `${classNames} ${prerequisiteClassNames} focus-connection focus-connection-prerequisite focus-connection-source-${normalizedFocusId} focus-connection-target-${normalizedTargetId}`,
            });
        });
    }

    focus.exclusive.forEach(exclusiveId => {
        const exclusiveFocus = focusTree.focuses[exclusiveId];
        const exclusiveClassNames = exclusiveFocus?.inAllowBranch.map(value => 'inbranch_' + value).join(' ') ?? '';
        const normalizedFocusId = normalizeFocusIdForClassName(focus.id);
        const normalizedTargetId = normalizeFocusIdForClassName(exclusiveId);
        connections.push({
            target: exclusiveId,
            targetType: 'related',
            style: "1px solid rgba(255, 96, 96, 0.48)",
            classNames: `${classNames} ${exclusiveClassNames} focus-connection focus-connection-exclusive focus-connection-source-${normalizedFocusId} focus-connection-target-${normalizedTargetId}`,
        });
    });

    const position = getFocusPosition(focus, positionByFocusId, focusTree, exprs);

    return {
        id: focus.id,
        htmlId: 'focus_' + focus.id,
        classNames: `${classNames} focus`,
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}

function normalizeFocusIdForClassName(focusId: string): string {
    return normalizeForStyle(focusId);
}
