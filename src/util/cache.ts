import { incrementPerfCounter } from './perf';

export interface CacheOptions<V> {
    factory(key: string): V;
    expireWhenChange?(key: string, cachedValue: V): any;
    life: number;
    nonExpireLife?: number;
    name?: string;
    maxSize?: number;
    maxBytes?: number;
    weigher?(value: V): number;
}

export interface PromiseCacheOptions<V> extends Omit<CacheOptions<Promise<V>>, 'weigher'> {
    expireWhenChange?(key: string, cachedValue: Promise<V>): Promise<any> | any;
    weigher?(value: V): number;
}

interface CacheEntry<V> {
    value: V;
    expiryToken: any;
    lastAccess: number;
    weight: number;
}

export class Cache<V> {
    protected readonly _cache = new Map<string, CacheEntry<V>>();
    private _intervalToken: NodeJS.Timeout | null = null;
    private _totalWeight = 0;
    
    constructor(protected readonly options: CacheOptions<V>) {
        if (options.life > 0) {
            this._intervalToken = setInterval(() => this.tryClean(), options.life / 5);
            this._intervalToken.unref?.();
        }
        if (!options.expireWhenChange) {
            options.expireWhenChange = () => undefined;
        }
        if (options.nonExpireLife === undefined) {
            options.nonExpireLife = 200;
        }
    }

    public get(key: string = ''): V {
        const cacheName = this.options.name ?? this.constructor.name;
        const cacheEntry = this._cache.get(key);
        const now = Date.now();
        let expireToken: any = undefined;
        if (cacheEntry &&
            (now - cacheEntry.lastAccess < this.options.nonExpireLife! ||
                (expireToken = this.options.expireWhenChange!(key, cacheEntry.value)) === cacheEntry.expiryToken
            )) {
            this.touch(key, cacheEntry, now);
            incrementPerfCounter('cache.hit', { cache: cacheName });
            return cacheEntry.value;
        }

        incrementPerfCounter(cacheEntry ? 'cache.expired' : 'cache.miss', { cache: cacheName });
        const value = this.options.factory(key);
        const newEntry = {
            lastAccess: now,
            expiryToken: expireToken ?? this.options.expireWhenChange!(key, value),
            value,
            weight: this.options.weigher ? (this.options.weigher(value) ?? 0) : 0,
        };

        this.setEntry(key, newEntry);
        return newEntry.value;
    }

    public remove(key: string = ''): void {
        incrementPerfCounter('cache.remove', { cache: this.options.name ?? this.constructor.name });
        this.deleteEntry(key);
    }

    public clear(): void {
        incrementPerfCounter('cache.clear', { cache: this.options.name ?? this.constructor.name });
        this._cache.clear();
        this._totalWeight = 0;
    }

    public dispose(): void {
        this._cache.clear();
        this._totalWeight = 0;
        if (this._intervalToken) {
            clearTimeout(this._intervalToken);
        }
    }
    
    private tryClean(): void {
        const now = Date.now();
        for (const [key, entry] of this._cache) {
            if (entry.lastAccess + this.options.life < now) {
                this.deleteEntry(key);
            }
        }
    }

    protected touch(key: string, entry: CacheEntry<V>, now: number): void {
        entry.lastAccess = now;
        this._cache.delete(key);
        this._cache.set(key, entry);
    }

    protected setEntry(key: string, entry: CacheEntry<V>): void {
        this.deleteEntry(key);
        this._cache.set(key, entry);
        this._totalWeight += entry.weight;
        this.enforceLimits();
    }

    protected setWeight(entry: CacheEntry<V>, weight: number): void {
        this._totalWeight += weight - entry.weight;
        entry.weight = weight;
        this.enforceLimits();
    }

    private deleteEntry(key: string): void {
        const entry = this._cache.get(key);
        if (entry) {
            this._totalWeight -= entry.weight;
            this._cache.delete(key);
        }
    }

    protected enforceLimits(): void {
        const { maxBytes, maxSize } = this.options;
        if (maxBytes === undefined && maxSize === undefined) {
            return;
        }

        while ((maxSize !== undefined && this._cache.size > maxSize) ||
            (maxBytes !== undefined && this._totalWeight > maxBytes)) {
            const oldest = this._cache.keys().next();
            if (oldest.done) {
                break;
            }
            this.deleteEntry(oldest.value);
        }
    }
}

export class PromiseCache<V> extends Cache<Promise<V>> {
    private readonly promiseWeigher?: (value: V) => number;
    private readonly validations = new Map<string, {
        entry: CacheEntry<Promise<V>>;
        promise: Promise<V>;
    }>();

    constructor(options: PromiseCacheOptions<V>) {
        const { weigher, ...rest } = options;
        super({
            ...rest,
            factory: options.factory,
        });
        this.promiseWeigher = weigher;
    }

    public remove(key: string = ''): void {
        super.remove(key);
        this.validations.delete(key);
    }

    public clear(): void {
        super.clear();
        this.validations.clear();
    }

    public dispose(): void {
        super.dispose();
        this.validations.clear();
    }

    public async get(key: string = ''): Promise<V> {
        const cacheName = this.options.name ?? this.constructor.name;
        const cacheEntry = this._cache.get(key);
        const now = Date.now();
        if (!cacheEntry) {
            return this.createEntry(key);
        }
        if (now - cacheEntry.lastAccess < this.options.nonExpireLife!) {
            this.touch(key, cacheEntry, now);
            incrementPerfCounter('cache.hit', { cache: cacheName });
            return cacheEntry.value;
        }

        const validation = this.validations.get(key);
        if (validation?.entry === cacheEntry) {
            incrementPerfCounter('cache.hit', { cache: cacheName });
            return validation.promise;
        }

        const promise = this.validateEntry(key, cacheEntry);
        this.validations.set(key, { entry: cacheEntry, promise });
        try {
            return await promise;
        } finally {
            if (this.validations.get(key)?.promise === promise) {
                this.validations.delete(key);
            }
        }
    }

    private async validateEntry(key: string, entry: CacheEntry<Promise<V>>): Promise<V> {
        const expiryToken = Promise.resolve(this.options.expireWhenChange!(key, entry.value));
        const unchanged = await expiryToken === await entry.expiryToken;

        // Removal or replacement during validation must not restore the old entry.
        const currentEntry = this._cache.get(key);
        if (currentEntry !== entry) {
            return currentEntry ? this.get(key) : entry.value;
        }
        if (unchanged) {
            this.touch(key, entry, Date.now());
            incrementPerfCounter('cache.hit', { cache: this.options.name ?? this.constructor.name });
            return entry.value;
        }
        return this.createEntry(key, expiryToken);
    }

    private createEntry(key: string, expiryToken?: Promise<any>): Promise<V> {
        incrementPerfCounter(expiryToken ? 'cache.expired' : 'cache.miss', {
            cache: this.options.name ?? this.constructor.name,
        });
        const value = this.options.factory(key);
        const newEntry = {
            lastAccess: Date.now(),
            expiryToken: expiryToken ?? Promise.resolve(this.options.expireWhenChange!(key, value)),
            value,
            weight: 0,
        };

        this.setEntry(key, newEntry);
        value.then(resolved => {
            if (this._cache.get(key) !== newEntry) {
                return;
            }

            if (resolved === null || resolved === undefined) {
                this.remove(key);
                return;
            }

            if (this.promiseWeigher && this.options.maxBytes !== undefined) {
                this.setWeight(newEntry, this.promiseWeigher(resolved) ?? 0);
            }
        }, () => {
            if (this._cache.get(key) === newEntry) {
                this.remove(key);
            }
        });
        return newEntry.value;
    }
}
