type ScheduledAction = () => void | Promise<void>;

export class UpdateScheduler<TKey> {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly jobs = new Map<string, ScheduledAction>();

    constructor(
        private readonly serialize: (key: TKey) => string,
    ) {}

    public schedule(key: TKey, delayMs: number, action: ScheduledAction): void {
        const timerKey = this.serialize(key);
        const existingTimer = this.timers.get(timerKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        this.jobs.set(timerKey, action);
        const timer = setTimeout(() => {
            this.timers.delete(timerKey);
            const scheduledAction = this.jobs.get(timerKey);
            this.jobs.delete(timerKey);
            void scheduledAction?.();
        }, Math.max(0, delayMs));
        this.timers.set(timerKey, timer);
    }

    public cancel(key: TKey): void {
        const timerKey = this.serialize(key);
        const existingTimer = this.timers.get(timerKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        this.timers.delete(timerKey);
        this.jobs.delete(timerKey);
    }

    public dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.jobs.clear();
    }
}
