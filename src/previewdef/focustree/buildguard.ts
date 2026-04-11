export class LatestOnlyBuildGuard {
    private version = 0;

    public start(): number {
        this.version += 1;
        return this.version;
    }

    public isCurrent(version: number): boolean {
        return version === this.version;
    }
}
