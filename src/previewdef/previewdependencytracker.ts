import { matchPathEnd } from '../util/nodecommon';
import type { PreviewBase } from './previewbase';

interface DependencySubscription {
    segments: string[];
    preview: PreviewBase;
}

export class PreviewDependencyTracker {
    private readonly subscriptions: DependencySubscription[] = [];

    public add(preview: PreviewBase, dependencies: string[]): void {
        for (const dependency of dependencies) {
            this.subscriptions.push({
                segments: dependency.split('/').filter(Boolean),
                preview,
            });
        }
    }

    public remove(preview: PreviewBase): void {
        for (let i = this.subscriptions.length - 1; i >= 0; i--) {
            if (this.subscriptions[i].preview === preview) {
                this.subscriptions.splice(i, 1);
            }
        }
    }

    public getAffected(uri: string): PreviewBase[] {
        const previews = new Set<PreviewBase>();
        for (const subscription of this.subscriptions) {
            if (matchPathEnd(uri, subscription.segments)) {
                previews.add(subscription.preview);
            }
        }

        return [...previews];
    }
}
