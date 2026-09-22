interface BranchFocus {
    id: string;
    prerequisite: string[][];
    inAllowBranch: string[];
}

export function propagateFocusBranchMembership(focuses: Record<string, BranchFocus>): void {
    const focusList = Object.values(focuses);
    const memberships = focusList.map(focus => new Set(focus.inAllowBranch));
    if (memberships.every(membership => membership.size === 0)) {
        return;
    }
    const indexById = new Map(focusList.map((focus, index) => [focus.id, index]));
    const dependents = focusList.map(() => [] as number[]);
    const prerequisites = focusList.map((focus, index) => {
        const parentIndexes = new Set<number>();
        for (const group of focus.prerequisite) {
            for (const parentId of group) {
                const parentIndex = indexById.get(parentId);
                if (parentIndex !== undefined) {
                    parentIndexes.add(parentIndex);
                }
            }
        }
        for (const parentIndex of parentIndexes) {
            dependents[parentIndex].push(index);
        }
        return Array.from(parentIndexes);
    });
    let pending = new FocusBranchWorkQueue();
    let nextPass = new FocusBranchWorkQueue();
    memberships.forEach((membership, index) => {
        if (membership.size > 0) {
            dependents[index].forEach(dependent => pending.add(dependent));
        }
    });

    // Retain file-order propagation and branch ordering, but revisit only dependents
    // whose prerequisites changed instead of rescanning the entire tree each pass.
    while (pending.size > 0) {
        let index: number | undefined;
        while ((index = pending.take()) !== undefined) {
            const focus = focusList[index];
            const membership = memberships[index];
            let changed = false;
            for (const parentIndex of prerequisites[index]) {
                for (const branchId of focusList[parentIndex].inAllowBranch) {
                    if (!membership.has(branchId)) {
                        membership.add(branchId);
                        focus.inAllowBranch.push(branchId);
                        changed = true;
                    }
                }
            }
            if (changed) {
                for (const dependent of dependents[index]) {
                    (dependent > index ? pending : nextPass).add(dependent);
                }
            }
        }
        [pending, nextPass] = [nextPass, pending];
    }
}

class FocusBranchWorkQueue {
    private readonly values: number[] = [];
    private readonly queued = new Set<number>();

    public get size(): number {
        return this.values.length;
    }

    public add(value: number): void {
        if (this.queued.has(value)) {
            return;
        }
        this.queued.add(value);
        let index = this.values.length;
        this.values.push(value);
        while (index > 0) {
            const parent = (index - 1) >>> 1;
            if (this.values[parent] <= value) {
                break;
            }
            this.values[index] = this.values[parent];
            index = parent;
        }
        this.values[index] = value;
    }

    public take(): number | undefined {
        const first = this.values[0];
        const last = this.values.pop();
        if (first === undefined || last === undefined) {
            return undefined;
        }
        this.queued.delete(first);
        if (this.values.length > 0) {
            let index = 0;
            while (index * 2 + 1 < this.values.length) {
                let child = index * 2 + 1;
                if (child + 1 < this.values.length && this.values[child + 1] < this.values[child]) {
                    child += 1;
                }
                if (last <= this.values[child]) {
                    break;
                }
                this.values[index] = this.values[child];
                index = child;
            }
            this.values[index] = last;
        }
        return first;
    }
}
