import type { PreviewBase } from './previewbase';
import type { PreviewDependencyTracker } from './previewdependencytracker';

export class PreviewSessionStore {
    public readonly items: Record<string, PreviewBase> = {};

    constructor(
        private readonly dependencyTracker: PreviewDependencyTracker,
    ) {}

    public get(key: string): PreviewBase | undefined {
        return this.items[key];
    }

    public add(key: string, preview: PreviewBase): void {
        const previousPreview = this.items[key];
        if (previousPreview && previousPreview !== preview) {
            this.dependencyTracker.remove(previousPreview);
        }
        this.items[key] = preview;

        preview.onDispose(() => {
            this.dependencyTracker.remove(preview);
            if (this.items[key] === preview) {
                delete this.items[key];
            }
        });

        preview.onDependencyChanged((newDependencies) => {
            if (this.items[key] !== preview) {
                return;
            }
            this.dependencyTracker.remove(preview);
            this.dependencyTracker.add(preview, newDependencies);
        });
    }
}
