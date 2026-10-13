export class WorkBudget {
    private remaining = 8192;
    private clockChecks = 256;
    private deadline = Date.now() + 8;

    public shouldYield(): boolean {
        this.remaining--;
        if (--this.clockChecks > 0 && this.remaining > 0) {
            return false;
        }
        this.clockChecks = 256;
        if (this.remaining > 0 && Date.now() < this.deadline) {
            return false;
        }
        this.remaining = 8192;
        this.deadline = Date.now() + 8;
        return true;
    }
}

export function finishCooperativeWork<T>(steps: Generator<void, T>): T {
    let step = steps.next();
    while (!step.done) {
        step = steps.next();
    }
    return step.value;
}

export async function runCooperatively<T>(steps: Generator<void, T>, signal?: AbortSignal, checkCancelled?: () => void): Promise<T> {
    try {
        signal?.throwIfAborted();
        checkCancelled?.();
        let step = steps.next();
        while (!step.done) {
            await new Promise<void>(resolve => setImmediate(resolve));
            signal?.throwIfAborted();
            checkCancelled?.();
            step = steps.next();
        }
        signal?.throwIfAborted();
        checkCancelled?.();
        return step.value;
    } finally {
        steps.return(undefined as T);
    }
}
