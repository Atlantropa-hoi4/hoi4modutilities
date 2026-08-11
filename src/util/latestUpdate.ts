export class LatestUpdateCoordinator<TKey> {
    private epoch = 0;
    private nextRevision = 0;
    private readonly currentRevisions = new Map<TKey, number>();
    private readonly queues = new Map<TKey, Promise<void>>();

    public update<T>(key: TKey, load: () => Promise<T>, commit: (value: T) => void): Promise<void> {
        const epoch = this.epoch;
        const revision = ++this.nextRevision;
        this.currentRevisions.set(key, revision);

        const previous = this.queues.get(key) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            if (this.epoch !== epoch || this.currentRevisions.get(key) !== revision) {
                return;
            }
            const value = await load();
            if (this.epoch === epoch && this.currentRevisions.get(key) === revision) {
                commit(value);
            }
        });
        const queue = operation.catch(() => undefined).finally(() => {
            if (this.queues.get(key) === queue) {
                this.queues.delete(key);
                this.currentRevisions.delete(key);
            }
        });
        this.queues.set(key, queue);
        return operation;
    }

    public invalidateAll(): void {
        this.epoch += 1;
        this.currentRevisions.clear();
    }
}

export class LatestGeneration {
    private generation = 0;

    public next(): () => boolean {
        const generation = ++this.generation;
        return () => generation === this.generation;
    }

    public invalidate(): void {
        this.generation += 1;
    }
}
