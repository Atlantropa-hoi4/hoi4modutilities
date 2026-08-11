export interface TechnologyPreviewRenderRequest {
    generation: number;
    skipRender: boolean;
}

export class TechnologyPreviewRenderCoordinator {
    private generation = 0;
    private readonly locallyAppliedPositionVersions = new Set<number>();

    public recordLocallyAppliedPositionVersion(version: number): () => void {
        this.locallyAppliedPositionVersions.add(version);
        return () => this.locallyAppliedPositionVersions.delete(version);
    }

    public begin(documentVersion: number): TechnologyPreviewRenderRequest {
        return {
            generation: ++this.generation,
            skipRender: this.locallyAppliedPositionVersions.delete(documentVersion),
        };
    }

    public isCurrent(generation: number): boolean {
        return generation === this.generation;
    }
}
