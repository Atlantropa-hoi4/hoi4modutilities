import type { Resource } from '../../src/previewdef/worldmap/definitions';

interface ResourceImageCacheEntry {
    image: HTMLImageElement;
    onLoad: () => void;
    uri: string;
}

type ResourceImageFactory = () => HTMLImageElement;

export class ResourceImageCache {
    private readonly entries = new Map<string, ResourceImageCacheEntry>();

    constructor(private readonly createImage: ResourceImageFactory = () => new Image()) {
    }

    public sync(resources: readonly Resource[], onLoad: () => void): void {
        const resourceNames = new Set(resources.map(resource => resource.name));
        for (const [resourceName, entry] of this.entries) {
            if (!resourceNames.has(resourceName)) {
                this.detachEntry(entry);
                this.entries.delete(resourceName);
            }
        }

        for (const resource of resources) {
            const cached = this.entries.get(resource.name);
            if (cached?.uri === resource.imageUri) {
                cached.onLoad = onLoad;
                continue;
            }
            if (cached) {
                this.detachEntry(cached);
            }

            const image = this.createImage();
            const entry: ResourceImageCacheEntry = { image, onLoad, uri: resource.imageUri };
            this.entries.set(resource.name, entry);
            image.onload = () => {
                if (this.entries.get(resource.name) === entry) {
                    entry.onLoad();
                }
            };
            image.onerror = () => {
                if (this.entries.get(resource.name) === entry) {
                    this.detachEntry(entry);
                    this.entries.delete(resource.name);
                }
            };
            image.src = resource.imageUri;
        }
    }

    public getLoaded(resourceName: string): HTMLImageElement | undefined {
        const image = this.entries.get(resourceName)?.image;
        return image?.complete && image.naturalWidth > 0 ? image : undefined;
    }

    public clear(): void {
        for (const entry of this.entries.values()) {
            this.detachEntry(entry);
        }
        this.entries.clear();
    }

    private detachEntry(entry: ResourceImageCacheEntry): void {
        entry.image.onload = null;
        entry.image.onerror = null;
    }
}
