type ScheduledAction = () => void | Promise<void>;

export interface UpdateSchedulingOptions {
    serialize?: boolean;
}

interface ScheduledJob {
    action: ScheduledAction;
    serialize: boolean;
    ready: boolean;
    timer?: NodeJS.Timeout;
}

export class UpdateScheduler<TKey> {
    private readonly jobs = new Map<string, ScheduledJob>();
    private readonly running = new Map<string, number>();
    private disposed = false;

    constructor(
        private readonly serialize: (key: TKey) => string,
        private readonly onError: (error: unknown) => void = reportedError => console.error(reportedError),
    ) {}

    public schedule(key: TKey, delayMs: number, action: ScheduledAction, options?: UpdateSchedulingOptions): void {
        if (this.disposed) {
            return;
        }
        const timerKey = this.serialize(key);
        this.cancel(key);
        const job: ScheduledJob = { action, serialize: options?.serialize ?? false, ready: false };
        this.jobs.set(timerKey, job);
        job.timer = setTimeout(() => {
            if (this.jobs.get(timerKey) !== job) {
                return;
            }
            job.timer = undefined;
            job.ready = true;
            this.runReadyJob(timerKey, job);
        }, Math.max(0, delayMs));
    }

    public cancel(key: TKey): void {
        const timerKey = this.serialize(key);
        const job = this.jobs.get(timerKey);
        clearTimeout(job?.timer);
        this.jobs.delete(timerKey);
    }

    public dispose(): void {
        this.disposed = true;
        for (const job of this.jobs.values()) {
            clearTimeout(job.timer);
        }
        this.jobs.clear();
    }

    private runReadyJob(key: string, job: ScheduledJob): void {
        if (!job.ready || (job.serialize && this.running.has(key))) {
            return;
        }
        void Promise.resolve().then(async () => {
            // Keep the job registered until execution, so cancellation or a newer
            // request also invalidates a timer callback already queued as a microtask.
            if (this.disposed || this.jobs.get(key) !== job
                || (job.serialize && this.running.has(key))) {
                return;
            }
            this.jobs.delete(key);
            this.running.set(key, (this.running.get(key) ?? 0) + 1);
            try {
                await job.action();
            } finally {
                const remaining = (this.running.get(key) ?? 1) - 1;
                if (remaining > 0) {
                    this.running.set(key, remaining);
                } else {
                    this.running.delete(key);
                }
                const next = this.jobs.get(key);
                if (next) {
                    this.runReadyJob(key, next);
                }
            }
        }).catch(this.onError);
    }
}
