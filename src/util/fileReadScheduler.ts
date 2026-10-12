export type FileReadPriority = 'interactive' | 'background';

export interface ScheduledFileRead<T> {
    promise: Promise<T>;
    queued: boolean;
    /** Promotes queued work in place; running work never needs another slot. */
    promote(): boolean;
}

interface ReadQueueEntry {
    priority: FileReadPriority;
    queued: boolean;
    previous?: ReadQueueEntry;
    next?: ReadQueueEntry;
    start(): void;
}

class ReadQueue {
    public first?: ReadQueueEntry;
    private last?: ReadQueueEntry;

    public push(entry: ReadQueueEntry): void {
        entry.previous = this.last;
        entry.next = undefined;
        if (this.last) {
            this.last.next = entry;
        } else {
            this.first = entry;
        }
        this.last = entry;
    }

    public remove(entry: ReadQueueEntry): void {
        if (entry.previous) {
            entry.previous.next = entry.next;
        } else {
            this.first = entry.next;
        }
        if (entry.next) {
            entry.next.previous = entry.previous;
        } else {
            this.last = entry.previous;
        }
        entry.previous = undefined;
        entry.next = undefined;
    }
}

/** One shared pool; at most three interactive admissions precede a waiting background read. */
export class FileReadScheduler {
    private active = 0;
    private interactiveStreak = 0;
    private readonly interactive = new ReadQueue();
    private readonly background = new ReadQueue();

    constructor(private readonly limit: number) {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new RangeError('File read concurrency must be a positive integer');
        }
    }

    public schedule<T>(
        task: (priority: FileReadPriority, waitDurationMs: number) => Promise<T>,
        priority: FileReadPriority = 'interactive',
    ): ScheduledFileRead<T> {
        const enqueuedAt = Date.now();
        const queued = this.active >= this.limit;
        let entry!: ReadQueueEntry;
        const promise = new Promise<T>((resolve, reject) => {
            entry = {
                priority,
                queued,
                start: () => {
                    entry.queued = false;
                    this.execute(entry, enqueuedAt, task).then(resolve, reject);
                },
            };
            if (queued) {
                (priority === 'interactive' ? this.interactive : this.background).push(entry);
            } else {
                this.active++;
                entry.start();
            }
        });
        return {
            promise,
            queued,
            promote: () => {
                if (!entry.queued || entry.priority === 'interactive') {
                    return false;
                }
                this.background.remove(entry);
                entry.priority = 'interactive';
                this.interactive.push(entry);
                return true;
            },
        };
    }

    private async execute<T>(
        entry: ReadQueueEntry,
        enqueuedAt: number,
        task: (priority: FileReadPriority, waitDurationMs: number) => Promise<T>,
    ): Promise<T> {
        try {
            let result: Promise<T>;
            try {
                result = task(entry.priority, Date.now() - enqueuedAt);
            } catch (error) {
                // Only synchronous failures need a boundary to prevent recursive queue draining.
                await undefined;
                throw error;
            }
            return await result;
        } finally {
            const next = this.takeNext();
            if (next) {
                next.start();
            } else {
                this.active--;
            }
        }
    }

    private takeNext(): ReadQueueEntry | undefined {
        let next: ReadQueueEntry | undefined;
        if (this.background.first && (!this.interactive.first || this.interactiveStreak >= 3)) {
            next = this.background.first;
            this.interactiveStreak = 0;
        } else {
            next = this.interactive.first;
            this.interactiveStreak = this.background.first ? this.interactiveStreak + 1 : 0;
        }
        if (next) {
            (next.priority === 'interactive' ? this.interactive : this.background).remove(next);
        }
        return next;
    }
}
