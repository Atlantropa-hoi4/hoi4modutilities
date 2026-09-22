export class FocusSceneMeasurementBatcher {
    private readonly pending = new Set<string>();
    private readonly suspended = new Set<string>();
    private frame: number | undefined;
    private generation = 0;

    constructor(
        private readonly measure: (focusIds: readonly string[]) => void,
        private readonly batchSize = 120,
        private readonly requestFrame: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
        private readonly cancelFrame: (frame: number) => void = frame => cancelAnimationFrame(frame),
    ) {}

    public schedule(focusIds: Iterable<string>): void {
        for (const focusId of focusIds) {
            if (!this.suspended.has(focusId)) {
                this.pending.add(focusId);
            }
        }
        this.request();
    }

    public suspend(focusId: string): void {
        this.suspended.add(focusId);
        this.pending.delete(focusId);
    }

    public resume(focusId: string): void {
        this.suspended.delete(focusId);
        this.schedule([focusId]);
    }

    public clear(): void {
        this.generation += 1;
        this.pending.clear();
        this.suspended.clear();
        if (this.frame !== undefined) {
            this.cancelFrame(this.frame);
            this.frame = undefined;
        }
    }

    private request(): void {
        if (this.frame !== undefined || this.pending.size === 0) {
            return;
        }
        const generation = this.generation;
        this.frame = this.requestFrame(() => {
            if (generation !== this.generation) {
                return;
            }
            this.frame = undefined;
            const batch: string[] = [];
            for (const focusId of this.pending) {
                this.pending.delete(focusId);
                batch.push(focusId);
                if (batch.length >= this.batchSize) {
                    break;
                }
            }
            try {
                if (batch.length > 0) {
                    this.measure(batch);
                }
            } finally {
                this.request();
            }
        });
    }
}
