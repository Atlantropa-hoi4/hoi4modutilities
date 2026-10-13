export interface WorldMapLoadRequest {
    loadGeneration: number;
    force: boolean;
}

export class WorldMapLoadQueue {
    private activeRequest: WorldMapLoadRequest | undefined;
    private pendingRequest: WorldMapLoadRequest | undefined;
    private drainPromise: Promise<void> | undefined;
    private activeAbortController: AbortController | undefined;

    constructor(private readonly run: (request: WorldMapLoadRequest, signal: AbortSignal) => Promise<void>) {}

    public get isRunning(): boolean {
        return this.drainPromise !== undefined;
    }

    public enqueue(request: WorldMapLoadRequest): Promise<void> {
        this.pendingRequest = {
            ...request,
            force: request.force || this.pendingRequest?.force === true || this.activeRequest?.force === true,
        };
        this.activeAbortController?.abort();

        if (!this.drainPromise) {
            this.drainPromise = this.drain().finally(() => {
                this.activeRequest = undefined;
                this.activeAbortController = undefined;
                this.drainPromise = undefined;
            });
        }

        return this.drainPromise;
    }

    public clearPending(): void {
        this.pendingRequest = undefined;
        this.activeAbortController?.abort();
    }

    private async drain(): Promise<void> {
        while (this.pendingRequest) {
            this.activeRequest = this.pendingRequest;
            this.pendingRequest = undefined;
            const controller = this.activeAbortController = new AbortController();
            try {
                await this.run(this.activeRequest, controller.signal);
            } catch (error) {
                if (!controller.signal.aborted) {
                    throw error;
                }
            }
        }
    }
}
