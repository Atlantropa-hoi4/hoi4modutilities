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
