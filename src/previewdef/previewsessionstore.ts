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

    public set(key: string, preview: PreviewBase): void {
        this.items[key] = preview;
    }

    public bind(key: string, preview: PreviewBase): void {
        preview.onDispose(() => {
            const currentPreview = this.items[key];
            if (currentPreview) {
                this.dependencyTracker.remove(currentPreview);
                delete this.items[key];
            }
        });

        preview.onDependencyChanged((newDependencies) => {
            this.dependencyTracker.remove(preview);
            this.dependencyTracker.add(preview, newDependencies);
        });
    }
}
