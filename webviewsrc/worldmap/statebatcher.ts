import type { Disposable } from '../util/event';
import { AnimationFrameScheduler } from './framescheduler';

export class WorldMapStateBatcher implements Disposable {
    private readonly lastValues = new Map<string, unknown>();
    private pendingPatch: Record<string, unknown> = {};
    private readonly scheduler: AnimationFrameScheduler;

    constructor(
        private readonly applyPatch: (patch: Record<string, unknown>) => void,
        requestFrame?: (callback: FrameRequestCallback) => number,
        cancelFrame?: (handle: number) => void,
    ) {
        this.scheduler = new AnimationFrameScheduler(() => this.flush(), requestFrame, cancelFrame);
    }

    public update<T>(key: string, value: T): void {
        if (this.lastValues.has(key) && Object.is(this.lastValues.get(key), value)) {
            return;
        }

        this.lastValues.set(key, value);
        this.pendingPatch[key] = value;
        this.scheduler.schedule();
    }

    public flush(): void {
        if (Object.keys(this.pendingPatch).length === 0) {
            return;
        }

        const patch = this.pendingPatch;
        this.pendingPatch = {};
        this.applyPatch(patch);
    }

    public dispose(): void {
        this.scheduler.dispose();
        this.flush();
    }
}
