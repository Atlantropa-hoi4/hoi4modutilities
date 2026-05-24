import { matchPathEnd } from '../util/nodecommon';
import type { PreviewBase } from './previewbase';

interface DependencySubscription {
    segments: string[];
    preview: PreviewBase;
}

export class PreviewDependencyTracker {
    private readonly subscriptions: DependencySubscription[] = [];
    private readonly subscriptionsByLastSegment = new Map<string, DependencySubscription[]>();
    private readonly wildcardSubscriptions: DependencySubscription[] = [];

    public add(preview: PreviewBase, dependencies: string[]): void {
        for (const dependency of dependencies) {
            const subscription = {
                segments: normalizeSegments(dependency),
                preview,
            };
            this.subscriptions.push(subscription);
            this.addToIndex(subscription);
        }
    }

    public remove(preview: PreviewBase): void {
        let removed = false;
        for (let i = this.subscriptions.length - 1; i >= 0; i--) {
            if (this.subscriptions[i].preview === preview) {
                this.subscriptions.splice(i, 1);
                removed = true;
            }
        }
        if (removed) {
            this.rebuildIndex();
        }
    }

    public getAffected(uri: string): PreviewBase[] {
        const previews = new Set<PreviewBase>();
        for (const subscription of this.getCandidateSubscriptions(uri)) {
            if (matchPathEnd(uri, subscription.segments)) {
                previews.add(subscription.preview);
            }
        }

        return [...previews];
    }

    private getCandidateSubscriptions(uri: string): DependencySubscription[] {
        const lastSegment = getLastSegment(normalizeSegments(uri));
        if (!lastSegment) {
            return this.subscriptions;
        }

        return [
            ...(this.subscriptionsByLastSegment.get(lastSegment) ?? []),
            ...this.wildcardSubscriptions,
        ];
    }

    private addToIndex(subscription: DependencySubscription): void {
        const lastSegment = getLastSegment(subscription.segments);
        if (!lastSegment || subscription.segments.includes('*')) {
            this.wildcardSubscriptions.push(subscription);
            return;
        }

        const existing = this.subscriptionsByLastSegment.get(lastSegment);
        if (existing) {
            existing.push(subscription);
        } else {
            this.subscriptionsByLastSegment.set(lastSegment, [subscription]);
        }
    }

    private rebuildIndex(): void {
        this.subscriptionsByLastSegment.clear();
        this.wildcardSubscriptions.length = 0;
        for (const subscription of this.subscriptions) {
            this.addToIndex(subscription);
        }
    }
}

function normalizeSegments(path: string): string[] {
    return path.replace(/\\+/g, '/').split('/').filter(Boolean);
}

function getLastSegment(segments: string[]): string | undefined {
    return segments.length > 0 ? segments[segments.length - 1].toLowerCase() : undefined;
}
