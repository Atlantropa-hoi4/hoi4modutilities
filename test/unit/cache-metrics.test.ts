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
});

function getCounterCount(label: string, cacheName: string): number {
    return getPerfSnapshot().counters.find(counter =>
        counter.label === label && counter.tags.cache === cacheName)?.count ?? 0;
}
