interface RelativeFocus {
    id: string;
    relativePositionId?: string;
}

export function findFocusRelativePositionCycles(focuses: Record<string, RelativeFocus>): string[][] {
    const focusList = Object.values(focuses);
    const indexById = new Map(focusList.map((focus, index) => [focus.id, index]));
    const componentParents = focusList.map((_focus, index) => index);
    const componentSizes = focusList.map(() => 1);
    const relativeIndexes = focusList.map(() => -1);
    const cycles: string[][] = [];

    function findComponent(index: number): number {
        let root = index;
        while (componentParents[root] !== root) {
            root = componentParents[root];
        }
        while (componentParents[index] !== root) {
            const parent = componentParents[index];
            componentParents[index] = root;
            index = parent;
        }
        return root;
    }

    for (let index = 0; index < focusList.length; index += 1) {
        const focus = focusList[index];
        const target = focus.relativePositionId === undefined ? undefined : indexById.get(focus.relativePositionId);
        if (target === undefined) {
            continue;
        }
        relativeIndexes[index] = target;
        let sourceComponent = findComponent(index);
        let targetComponent = findComponent(target);
        if (sourceComponent !== targetComponent) {
            if (componentSizes[sourceComponent] < componentSizes[targetComponent]) {
                [sourceComponent, targetComponent] = [targetComponent, sourceComponent];
            }
            componentParents[targetComponent] = sourceComponent;
            componentSizes[sourceComponent] += componentSizes[targetComponent];
            continue;
        }

        // Each focus has at most one outgoing relative edge. An edge within an
        // existing component closes a cycle; only that cycle needs a chain walk.
        const chain = [focus.id];
        let current = target;
        while (current !== index) {
            chain.push(focusList[current].id);
            current = relativeIndexes[current];
        }
        chain.push(focus.id);
        cycles.push(chain);
    }
    return cycles;
}
