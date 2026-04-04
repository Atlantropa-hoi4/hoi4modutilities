export interface ScopeContext {
    fromStack: string[];
    currentScopeName: string;
}

export interface SharedChildTargetLike {
    event?: {
        id: string;
    };
}

export interface SharedChildEdgeLike<TTarget extends SharedChildTargetLike | string = SharedChildTargetLike | string> {
    toScope: string;
    toNode: TTarget;
    days: number;
    hours: number;
    randomDays: number;
    randomHours: number;
}

export interface SharedChildOptionLike<TEdge extends SharedChildEdgeLike = SharedChildEdgeLike> {
    children: TEdge[];
}

export interface SharedOptionChildGroup<
    TOption extends SharedChildOptionLike<TEdge>,
    TEdge extends SharedChildEdgeLike,
> {
    edge: TEdge;
    optionNodes: TOption[];
}

export function nextScope(scopeContext: ScopeContext, toScope: string): ScopeContext {
    let currentScopeName: string;
    if (toScope.match(/^from(?:\.from)*$/)) {
        const fromCount = toScope.split('.').length;
        const fromIndex = scopeContext.fromStack.length - fromCount;
        if (fromIndex < 0) {
            currentScopeName = (scopeContext.fromStack.length > 0 ? scopeContext.fromStack[0] : scopeContext.currentScopeName) +
                '.FROM'.repeat(-fromIndex);
        } else {
            currentScopeName = scopeContext.fromStack[fromIndex];
        }
    } else {
        currentScopeName = toScope.replace(/\{event_target\}/g, scopeContext.currentScopeName);
    }

    return {
        fromStack: [ ...scopeContext.fromStack, scopeContext.currentScopeName ],
        currentScopeName,
    };
}

export function getSharedOptionChildGroups<
    TEdge extends SharedChildEdgeLike,
    TOption extends SharedChildOptionLike<TEdge>,
>(
    children: readonly (TEdge | TOption)[],
    scopeContext: ScopeContext,
): SharedOptionChildGroup<TOption, TEdge>[] {
    const keyToOptions = new Map<string, { edge: TEdge; optionNodes: TOption[] }>();

    for (const child of children) {
        if (typeof child !== 'object' || 'toScope' in child) {
            continue;
        }

        for (const optionEdge of child.children) {
            const renderKey = getEventEdgeRenderKey(optionEdge, scopeContext);
            const existing = keyToOptions.get(renderKey);
            if (existing) {
                existing.optionNodes.push(child);
            } else {
                keyToOptions.set(renderKey, { edge: optionEdge, optionNodes: [child] });
            }
        }
    }

    return Array.from(keyToOptions.values())
        .filter(group => group.optionNodes.length > 1)
        .map(group => ({
            edge: group.edge,
            optionNodes: group.optionNodes,
        }));
}

function getEventEdgeRenderKey(edge: SharedChildEdgeLike, scopeContext: ScopeContext): string {
    const nextScopeContext = nextScope(scopeContext, edge.toScope);
    return [
        typeof edge.toNode === 'string' ? edge.toNode : edge.toNode.event?.id ?? '',
        nextScopeContext.currentScopeName,
        edge.days,
        edge.hours,
        edge.randomDays,
        edge.randomHours,
    ].join('|');
}
