import * as assert from 'assert';
import { Cache, PromiseCache } from '../../src/util/cache';
import { getPerfSnapshot, resetPerfMetrics } from '../../src/util/perf';

describe('cache metrics', () => {
    beforeEach(() => {
        resetPerfMetrics();
    });

    it('records hit, miss, and expired counters for sync cache', async () => {
        let version = 1;
        let factoryCalls = 0;
        const cache = new Cache({
            name: 'unit-sync',
            factory: key => `${key}:${++factoryCalls}`,
            expireWhenChange: () => version,
            life: 1000,
            nonExpireLife: 0,
        });

        assert.strictEqual(cache.get('a'), 'a:1');
        assert.strictEqual(cache.get('a'), 'a:1');
        version += 1;
        assert.strictEqual(cache.get('a'), 'a:2');

        assert.strictEqual(getCounterCount('cache.miss', 'unit-sync'), 1);
        assert.strictEqual(getCounterCount('cache.hit', 'unit-sync'), 1);
        assert.strictEqual(getCounterCount('cache.expired', 'unit-sync'), 1);
    });

    it('records hit and miss counters for promise cache', async () => {
        let factoryCalls = 0;
        const cache = new PromiseCache({
            name: 'unit-promise',
            factory: async key => `${key}:${++factoryCalls}`,
            life: 1000,
        });

        assert.strictEqual(await cache.get('a'), 'a:1');
        assert.strictEqual(await cache.get('a'), 'a:1');

        assert.strictEqual(getCounterCount('cache.miss', 'unit-promise'), 1);
        assert.strictEqual(getCounterCount('cache.hit', 'unit-promise'), 1);
    });

    it('evicts least recently used entries when maxSize is exceeded', () => {
        let factoryCalls = 0;
        const cache = new Cache({
            name: 'unit-size-cap',
            factory: key => `${key}:${++factoryCalls}`,
            life: 1000,
            maxSize: 2,
        });

        assert.strictEqual(cache.get('a'), 'a:1');
        assert.strictEqual(cache.get('b'), 'b:2');
        assert.strictEqual(cache.get('a'), 'a:1');
        assert.strictEqual(cache.get('c'), 'c:3');
        assert.strictEqual(cache.get('b'), 'b:4');
        assert.strictEqual(cache.get('a'), 'a:5');
    });

    it('evicts resolved promise cache entries when maxBytes is exceeded', async () => {
        let factoryCalls = 0;
        const cache = new PromiseCache({
            name: 'unit-byte-cap',
            factory: async key => `${key}:${++factoryCalls}`,
            life: 1000,
            maxBytes: 5,
            weigher: value => value.length,
        });

        assert.strictEqual(await cache.get('a'), 'a:1');
        assert.strictEqual(await cache.get('b'), 'b:2');
        assert.strictEqual(await cache.get('a'), 'a:3');
        assert.strictEqual(await cache.get('b'), 'b:4');
    });

    it('does not let a stale rejected promise remove a replacement entry', async () => {
        let version = 1;
        const requests: Deferred<string>[] = [];
        const cache = new PromiseCache({
            name: 'unit-stale-rejection',
            factory: async () => {
                const request = createDeferred<string>();
                requests.push(request);
                return request.promise;
            },
            expireWhenChange: () => version,
            life: 1000,
            nonExpireLife: 0,
        });

        const stale = cache.get('a');
        version += 1;
        const replacement = cache.get('a');
        await waitForMicrotasks();
        assert.strictEqual(requests.length, 2);

        requests[0].reject(new Error('stale failure'));
        await assert.rejects(stale, /stale failure/);
        requests[1].resolve('replacement');
        assert.strictEqual(await replacement, 'replacement');
        assert.strictEqual(await cache.get('a'), 'replacement');
        assert.strictEqual(requests.length, 2);
    });

    it('does not let a stale undefined result remove a replacement entry', async () => {
        let version = 1;
        const requests: Deferred<string | undefined>[] = [];
        const cache = new PromiseCache<string | undefined>({
            name: 'unit-stale-empty-result',
            factory: async () => {
                const request = createDeferred<string | undefined>();
                requests.push(request);
                return request.promise;
            },
            expireWhenChange: () => version,
            life: 1000,
            nonExpireLife: 0,
        });

        const stale = cache.get('a');
        version += 1;
        const replacement = cache.get('a');
        await waitForMicrotasks();
        assert.strictEqual(requests.length, 2);

        requests[0].resolve(undefined);
        assert.strictEqual(await stale, undefined);
        requests[1].resolve('replacement');
        assert.strictEqual(await replacement, 'replacement');
        assert.strictEqual(await cache.get('a'), 'replacement');
        assert.strictEqual(requests.length, 2);
    });

    it('shares asynchronous expiry checks and replacement work across concurrent requests', async () => {
        let version: number | Promise<number> = 1;
        let expiryChecks = 0;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async () => ++factoryCalls,
            expireWhenChange: () => {
                expiryChecks++;
                return version;
            },
            life: 0,
            nonExpireLife: 0,
        });
        assert.strictEqual(await cache.get('shared'), 1);
        const changed = createDeferred<number>();
        version = changed.promise;

        const requests = Array.from({ length: 32 }, () => cache.get('shared'));
        assert.strictEqual(expiryChecks, 2);
        changed.resolve(2);
        assert.deepStrictEqual(await Promise.all(requests), Array(32).fill(2));
        assert.strictEqual(factoryCalls, 2);

        const unchanged = createDeferred<number>();
        version = unchanged.promise;
        const hits = Array.from({ length: 32 }, () => cache.get('shared'));
        assert.strictEqual(expiryChecks, 3);
        unchanged.resolve(2);
        assert.deepStrictEqual(await Promise.all(hits), Array(32).fill(2));
        assert.strictEqual(factoryCalls, 2);
        cache.dispose();
    });

    it('retries after a shared expiry check rejects', async () => {
        let expiryToken: number | Promise<number> = 1;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async () => ++factoryCalls,
            expireWhenChange: () => expiryToken,
            life: 0,
            nonExpireLife: 0,
        });
        await cache.get('shared');
        const failure = createDeferred<number>();
        expiryToken = failure.promise;
        const first = cache.get('shared');
        const second = cache.get('shared');
        const rejections = Promise.all([
            assert.rejects(first, /expiry failure/),
            assert.rejects(second, /expiry failure/),
        ]);
        failure.reject(new Error('expiry failure'));
        await rejections;

        expiryToken = 2;
        assert.strictEqual(await cache.get('shared'), 2);
        assert.strictEqual(factoryCalls, 2);
        cache.dispose();
    });

    it('retries factory failures without retaining a rejected value', async () => {
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async () => {
                if (++factoryCalls === 1) {
                    throw new Error('factory failure');
                }
                return 'recovered';
            },
            life: 0,
        });

        await assert.rejects(cache.get('shared'), /factory failure/);
        assert.strictEqual(await cache.get('shared'), 'recovered');
        assert.strictEqual(await cache.get('shared'), 'recovered');
        assert.strictEqual(factoryCalls, 2);
        cache.dispose();
    });

    for (const invalidation of ['remove', 'clear'] as const) {
        it(`keeps the current entry when ${invalidation} happens during an expiry check`, async () => {
            let expiryToken: number | Promise<number> = 1;
            let factoryCalls = 0;
            const cache = new PromiseCache({
                factory: async () => ++factoryCalls,
                expireWhenChange: () => expiryToken,
                life: 0,
                nonExpireLife: 0,
            });
            assert.strictEqual(await cache.get('shared'), 1);
            const staleToken = createDeferred<number>();
            expiryToken = staleToken.promise;
            const pending = cache.get('shared');

            if (invalidation === 'clear') {
                cache.clear();
            } else {
                cache.remove('shared');
            }
            expiryToken = 2;
            assert.strictEqual(await cache.get('shared'), 2);
            staleToken.resolve(1);
            assert.strictEqual(await pending, 2);
            assert.strictEqual(await cache.get('shared'), 2);
            assert.strictEqual(factoryCalls, 2);
            cache.dispose();
        });
    }

    for (const invalidation of ['clear', 'dispose'] as const) {
        it(`does not repopulate the cache when ${invalidation} interrupts an expiry check`, async () => {
            let expiryToken: number | Promise<number> = 1;
            let factoryCalls = 0;
            const cache = new PromiseCache({
                factory: async () => ++factoryCalls,
                expireWhenChange: () => expiryToken,
                life: 0,
                nonExpireLife: 0,
            });
            assert.strictEqual(await cache.get('shared'), 1);
            const staleToken = createDeferred<number>();
            expiryToken = staleToken.promise;
            const pending = cache.get('shared');
            cache[invalidation]();
            staleToken.resolve(2);

            assert.strictEqual(await pending, 1);
            assert.strictEqual(factoryCalls, 1);
            assert.strictEqual(await cache.get('shared'), 2);
            cache.dispose();
        });
    }

    it('does not count stale promise weights after clearing the cache', async () => {
        const staleValue = createDeferred<string>();
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async key => {
                factoryCalls++;
                return key === 'stale' ? staleValue.promise : key;
            },
            life: 0,
            maxBytes: 2,
            weigher: value => value.length,
        });
        const stale = cache.get('stale');
        cache.clear();
        assert.strictEqual(await cache.get('a'), 'a');
        staleValue.resolve('a value larger than the cache limit');
        await stale;
        assert.strictEqual(await cache.get('b'), 'b');
        assert.strictEqual(await cache.get('a'), 'a');
        assert.strictEqual(factoryCalls, 3);
        cache.dispose();
    });

    it('accounts for replaced and removed weights and preserves LRU within one timestamp', () => {
        const originalNow = Date.now;
        Date.now = () => 1_000;
        let version = 1;
        const values = new Map([['a', 'a'], ['b', 'bb'], ['c', 'c']]);
        const calls = new Map<string, number>();
        const cache = new Cache({
            factory: key => {
                calls.set(key, (calls.get(key) ?? 0) + 1);
                return values.get(key)!;
            },
            expireWhenChange: () => version,
            life: 0,
            nonExpireLife: 0,
            maxBytes: 4,
            maxSize: 2,
            weigher: value => value.length,
        });
        try {
            cache.get('a');
            cache.get('b');
            values.set('a', 'aa');
            version++;
            assert.strictEqual(cache.get('a'), 'aa');
            cache.get('c');
            assert.strictEqual(cache.get('a'), 'aa');
            assert.strictEqual(calls.get('a'), 2);
            assert.strictEqual(cache.get('b'), 'bb');
            assert.strictEqual(calls.get('b'), 2);
            cache.remove('a');
            cache.get('c');
            assert.strictEqual(cache.get('b'), 'bb');
            assert.strictEqual(calls.get('b'), 2);
            cache.clear();
            cache.get('a');
            cache.get('b');
            assert.strictEqual(cache.get('a'), 'aa');
            assert.strictEqual(calls.get('a'), 3);
        } finally {
            Date.now = originalNow;
            cache.dispose();
        }
    });
});

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitForMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function getCounterCount(label: string, cacheName: string): number {
    return getPerfSnapshot().counters.find(counter =>
        counter.label === label && counter.tags.cache === cacheName)?.count ?? 0;
}
