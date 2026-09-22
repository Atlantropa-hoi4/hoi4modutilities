import { AnimationFrameScheduler } from './framescheduler';

type WebviewState = Record<string, any>;

// Only viewport updates are deferred. Selection and edit state keep their synchronous
// persistence contract, and always include any pending scroll or zoom coordinates.
export class ViewportStateStore {
    private pendingState: WebviewState | undefined;
    private revision = 0;
    private readonly scheduler: AnimationFrameScheduler;

    constructor(
        private readonly readState: () => unknown,
        private readonly writeState: (state: WebviewState) => void,
        requestFrame?: (callback: FrameRequestCallback) => number,
        cancelFrame?: (handle: number) => void,
    ) {
        this.scheduler = new AnimationFrameScheduler(() => this.flush(), requestFrame, cancelFrame);
    }

    public getState(): WebviewState {
        const state = this.pendingState ?? this.readState();
        return state !== null && typeof state === 'object' ? state as WebviewState : {};
    }

    public setState(patch: WebviewState, defer = false): void {
        this.pendingState = Object.assign(this.getState(), patch);
        this.revision++;
        if (defer) {
            this.scheduler.schedule();
        } else {
            this.flush();
        }
    }

    public flush(): void {
        if (!this.pendingState) {
            return;
        }

        const revision = this.revision;
        this.writeState(this.pendingState);
        // Preserve a pending update if persistence throws or synchronously adds more state.
        if (this.revision === revision) {
            this.pendingState = undefined;
        }
    }
}
