export class FakeUpdateClock {
    private now = 0;
    private nextId = 0;
    private readonly timers = new Map<number, { at: number; action: () => void }>();
    private readonly originalSetTimeout = global.setTimeout;
    private readonly originalClearTimeout = global.clearTimeout;
    private readonly originalNow = Date.now;

    public install(): void {
        Date.now = () => this.now;
        global.setTimeout = ((action: () => void, delay = 0) => {
            const id = ++this.nextId;
            this.timers.set(id, { at: this.now + delay, action });
            return id;
        }) as unknown as typeof setTimeout;
        global.clearTimeout = ((id: NodeJS.Timeout | number | string | undefined) => {
            if (typeof id === 'number') {
                this.timers.delete(id);
            } else {
                this.originalClearTimeout(id);
            }
        }) as typeof clearTimeout;
    }

    public fireTimers(milliseconds: number): void {
        this.now += milliseconds;
        for (const [id, timer] of [...this.timers]) {
            if (timer.at <= this.now) {
                this.timers.delete(id);
                timer.action();
            }
        }
    }

    public async advance(milliseconds = 0): Promise<void> {
        this.fireTimers(milliseconds);
        for (let index = 0; index < 16; index += 1) {
            await Promise.resolve();
        }
    }

    public restore(): void {
        Date.now = this.originalNow;
        global.setTimeout = this.originalSetTimeout;
        global.clearTimeout = this.originalClearTimeout;
    }
}
