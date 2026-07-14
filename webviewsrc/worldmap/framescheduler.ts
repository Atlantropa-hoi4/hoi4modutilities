import type { Disposable } from '../util/event';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class AnimationFrameScheduler implements Disposable {
    private frameHandle: number | undefined;
    private pending = false;
    private disposed = false;

    constructor(
        private readonly callback: FrameRequestCallback,
        private readonly requestFrame: RequestFrame = callback => requestAnimationFrame(callback),
        private readonly cancelFrame: CancelFrame = handle => cancelAnimationFrame(handle),
    ) {
    }

    public schedule(): void {
        if (this.disposed || this.pending) {
            return;
        }

        this.pending = true;
        const handle = this.requestFrame(timestamp => {
            this.pending = false;
            this.frameHandle = undefined;
            if (!this.disposed) {
                this.callback(timestamp);
            }
        });

        // A test scheduler may invoke the callback synchronously.
        if (this.pending) {
            this.frameHandle = handle;
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        if (this.pending && this.frameHandle !== undefined) {
            this.cancelFrame(this.frameHandle);
        }
        this.pending = false;
        this.frameHandle = undefined;
    }
}
