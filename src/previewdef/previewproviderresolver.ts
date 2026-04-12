import * as vscode from 'vscode';
import { arrayToMap } from '../util/common';
import { debug, error } from '../util/debug';
import { PreviewDescriptor } from './descriptor';

export class PreviewProviderResolver {
    private readonly previewProvidersMap: Record<string, PreviewDescriptor>;
    private readonly previewProviderCache = new Map<string, { version: number; providerType: string | undefined }>();

    constructor(
        private readonly previewProviders: PreviewDescriptor[],
    ) {
        this.previewProvidersMap = arrayToMap(this.previewProviders, 'type');
    }

    public find(document: vscode.TextDocument): PreviewDescriptor | undefined {
        const cacheKey = document.uri.toString();
        const cached = this.previewProviderCache.get(cacheKey);
        if (cached?.version === document.version) {
            return cached.providerType ? this.previewProvidersMap[cached.providerType] : undefined;
        }

        let bestProvider: PreviewDescriptor | undefined;
        let bestPriority: number | undefined;

        for (const provider of this.previewProviders) {
            const priority = this.safeCanPreview(provider, document);
            if (priority === undefined) {
                continue;
            }

            if (bestPriority === undefined || priority < bestPriority) {
                bestProvider = provider;
                bestPriority = priority;
            }
        }

        this.previewProviderCache.set(cacheKey, {
            version: document.version,
            providerType: bestProvider?.type,
        });
        return bestProvider;
    }

    public clear(uri: vscode.Uri | string): void {
        this.previewProviderCache.delete(typeof uri === 'string' ? uri : uri.toString());
    }

    private safeCanPreview(provider: PreviewDescriptor, document: vscode.TextDocument): number | undefined {
        try {
            return provider.canPreview(document);
        } catch (e) {
            error(e);
            debug(`Preview provider ${provider.type} failed for ${document.uri.toString()}`);
            return undefined;
        }
    }
}
