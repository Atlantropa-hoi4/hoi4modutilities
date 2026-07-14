export interface WorldMapLoadRequest {
    loadGeneration: number;
    force: boolean;
}

export class WorldMapLoadQueue {
    private activeRequest: WorldMapLoadRequest | undefined;
    private pendingRequest: WorldMapLoadRequest | undefined;
    private drainPromise: Promise<void> | undefined;

    constructor(private readonly run: (request: WorldMapLoadRequest) => Promise<void>) {}

    public get isRunning(): boolean {
        return this.drainPromise !== undefined;
    }

    public enqueue(request: WorldMapLoadRequest): Promise<void> {
        this.pendingRequest = {
            ...request,
            force: request.force || this.pendingRequest?.force === true || this.activeRequest?.force === true,
        };

        if (!this.drainPromise) {
            this.drainPromise = this.drain().finally(() => {
                this.activeRequest = undefined;
                this.drainPromise = undefined;
            });
        }

        return this.drainPromise;
    }

    public clearPending(): void {
        this.pendingRequest = undefined;
    }

    private async drain(): Promise<void> {
        while (this.pendingRequest) {
            this.activeRequest = this.pendingRequest;
            this.pendingRequest = undefined;
            await this.run(this.activeRequest);
        }
    }
}
