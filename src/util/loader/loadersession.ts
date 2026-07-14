import { UserError } from '../common';
import type { Loader } from './loader';

type AnyLoader = Loader<unknown, unknown>;
type ShouldReloadState = boolean | 'checking';

export class LoaderSession {
    private loadedLoaders = new Set<AnyLoader>();
    private shouldReloadStates = new Map<AnyLoader, ShouldReloadState>();
    private cachedLoaders = new Map<string, AnyLoader>();
    private loadingLoaders: AnyLoader[] = [];

    constructor(
        public readonly force: boolean,
        private readonly cancelled?: () => boolean,
    ) {}

    public isLoaded(loader: AnyLoader): boolean {
        return this.loadedLoaders.has(loader);
    }

    public setLoaded(loader: AnyLoader): void {
        this.loadedLoaders.add(loader);
    }

    public getLoadedLoaderNames(): string[] {
        return Array.from(this.loadedLoaders, loader => loader.toString());
    }

    public checkingShouldReload(loader: AnyLoader): void {
        this.shouldReloadStates.set(loader, 'checking');
    }

    public setShouldReload(loader: AnyLoader, shouldReload: boolean = true): void {
        this.shouldReloadStates.set(loader, shouldReload);
    }

    public clearShouldReload(loader: AnyLoader): void {
        this.shouldReloadStates.delete(loader);
    }

    public shouldReload(loader: AnyLoader): ShouldReloadState | undefined {
        return this.shouldReloadStates.get(loader);
    }

    public createOrGetCachedLoader<R extends AnyLoader>(file: string, loaderType: { new (file: string): R }): R {
        const cachedLoader = this.cachedLoaders.get(file);
        if (cachedLoader instanceof loaderType) {
            return cachedLoader;
        }

        const loader = new loaderType(file);
        this.cachedLoaders.set(file, loader);
        return loader;
    }

    public beginLoading(loader: AnyLoader): void {
        this.loadingLoaders.push(loader);
    }

    public endLoading(loader: AnyLoader): void {
        if (this.loadingLoaders.pop() !== loader) {
            throw new Error('loadingLoader corrupted.');
        }
    }

    public throwIfLoadingFile(file: string): void {
        const ancestors = this.loadingLoaders.slice(0, -1);
        if (ancestors.some(loader => isFileLoader(loader) && loader.file === file)) {
            throw new UserError('Circular dependency when loading file. Loading loaders: ' + this.loadingLoaders);
        }
    }

    public forChild(): LoaderSession {
        const child = new LoaderSession(this.force, this.cancelled);
        child.loadedLoaders = this.loadedLoaders;
        child.shouldReloadStates = this.shouldReloadStates;
        child.cachedLoaders = this.cachedLoaders;
        child.loadingLoaders = [...this.loadingLoaders];
        return child;
    }

    public throwIfCancelled(): void {
        if (this.cancelled?.call(this)) {
            throw new UserError('Load session cancelled.');
        }
    }
}

function isFileLoader(loader: AnyLoader): loader is AnyLoader & { file: string } {
    return 'file' in loader && typeof (loader as { file?: unknown }).file === 'string';
}
