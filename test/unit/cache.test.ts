import * as assert from 'assert';
import { PromiseCache } from '../../src/util/cache';

describe('promise cache freshness', () => {
    it('captures an opted-in cold token before reading content and retains it across an edit', async () => {
        let version = 1;
        let initialChecks = 0;
        let factoryCalls = 0;
        const started = deferred<void>();
        const content = deferred<void>();
        const cache = new PromiseCache({
            initialExpiryToken: () => { initialChecks++; return version; },
            expireWhenChange: async () => { await content.promise; return version; },
            factory: async () => {
                factoryCalls++;
                const readVersion = version;
                started.resolve();
                if (factoryCalls === 1) { await content.promise; }
                return readVersion;
            },
            life: 0,
            nonExpireLife: 0,
        });
        try {
            const old = cache.get('opened.gfx');
            await started.promise;
            version = 2;
            content.resolve();
            assert.strictEqual(await old, 1);
            assert.strictEqual(await cache.get('opened.gfx'), 2);
            assert.strictEqual(await cache.get('opened.gfx'), 2);
            assert.strictEqual(initialChecks, 1);
            assert.strictEqual(factoryCalls, 2);
        } finally {
            cache.dispose();
        }
    });

    it('stores the initial probe snapshot even when the source changes before the factory starts', async () => {
        let version = 1;
        let factoryCalls = 0;
        const probing = deferred<void>();
        const release = deferred<void>();
        const cache = new PromiseCache({
            initialExpiryToken: async () => {
                const capturedVersion = version;
                probing.resolve();
                await release.promise;
                return capturedVersion;
            },
            expireWhenChange: () => version,
            factory: async () => { factoryCalls++; return version; },
            life: 0,
            nonExpireLife: 0,
        });
        try {
            const pending = cache.get('opened.gfx');
            await probing.promise;
            assert.strictEqual(factoryCalls, 0);
            version = 2;
            release.resolve();
            assert.strictEqual(await pending, 2);
            assert.strictEqual(await cache.get('opened.gfx'), 2);
            assert.strictEqual(factoryCalls, 2, 'the earlier token remains conservative instead of being recaptured');
        } finally {
            cache.dispose();
        }
    });

    it('retains the expired candidate captured before replacement work', async () => {
        let version = 1;
        let factoryCalls = 0;
        let initialChecks = 0;
        let expiryChecks = 0;
        const started = deferred<void>();
        const replacement = deferred<void>();
        const cache = new PromiseCache({
            initialExpiryToken: () => { initialChecks++; return version; },
            expireWhenChange: () => { expiryChecks++; return version; },
            factory: async () => {
                const readVersion = version;
                if (++factoryCalls === 2) {
                    started.resolve();
                    await replacement.promise;
                }
                return readVersion;
            },
            life: 0,
            nonExpireLife: 0,
        });
        try {
            assert.strictEqual(await cache.get('opened.gfx'), 1);
            version = 2;
            const pending = cache.get('opened.gfx');
            await started.promise;
            version = 3;
            replacement.resolve();
            assert.strictEqual(await pending, 2);
            assert.strictEqual(await cache.get('opened.gfx'), 3);
            assert.strictEqual(initialChecks, 1);
            assert.strictEqual(expiryChecks, 2);
            assert.strictEqual(factoryCalls, 3);
        } finally {
            cache.dispose();
        }
    });

    it('coalesces both the initial probe and factory with no non-expiring window', async () => {
        const probe = deferred<number>();
        const started = deferred<void>();
        const content = deferred<string>();
        let initialChecks = 0;
        let expiryChecks = 0;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            initialExpiryToken: () => { initialChecks++; return probe.promise; },
            expireWhenChange: () => { expiryChecks++; return 1; },
            factory: () => { factoryCalls++; started.resolve(); return content.promise; },
            life: 0,
            nonExpireLife: 0,
        });
        try {
            const requests = Array.from({ length: 32 }, () => cache.get('shared'));
            await nextTurn();
            assert.strictEqual(initialChecks, 1);
            assert.strictEqual(factoryCalls, 0);
            probe.resolve(1);
            await started.promise;
            requests.push(...Array.from({ length: 32 }, () => cache.get('shared')));
            assert.strictEqual(factoryCalls, 1);
            assert.strictEqual(expiryChecks, 0);
            content.resolve('shared content');
            assert.deepStrictEqual(await Promise.all(requests), Array(64).fill('shared content'));
            assert.strictEqual(await cache.get('shared'), 'shared content');
            assert.strictEqual(expiryChecks, 1);
        } finally {
            cache.dispose();
        }
    });

    it('keeps default result-dependent expiry compatible without waiting for a token to start the factory', async () => {
        const content = deferred<{ texture: string }>();
        let revision = 1;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: () => { factoryCalls++; return content.promise; },
            expireWhenChange: async (_key, value) => `${(await value).texture}:${revision}`,
            life: 0,
            nonExpireLife: 0,
        });
        try {
            const pending = cache.get('sprite');
            assert.strictEqual(factoryCalls, 1);
            content.resolve({ texture: 'resolved.dds' });
            assert.deepStrictEqual(await pending, { texture: 'resolved.dds' });
            await nextTurn();
            await cache.get('sprite');
            assert.strictEqual(factoryCalls, 1);
            revision = 2;
            await cache.get('sprite');
            assert.strictEqual(factoryCalls, 2);
            await cache.get('sprite');
            assert.strictEqual(factoryCalls, 2);
        } finally {
            cache.dispose();
        }
    });

    it('observes result-dependent token rejection when the factory rejects', async () => {
        const failures: unknown[] = [];
        const onUnhandled = (reason: unknown) => failures.push(reason);
        process.on('unhandledRejection', onUnhandled);
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async () => {
                if (++factoryCalls === 1) { throw new Error('factory failure'); }
                return { texture: 'recovered.dds' };
            },
            expireWhenChange: async (_key, value) => (await value).texture,
            life: 0,
            nonExpireLife: 0,
        });
        try {
            await assert.rejects(cache.get('sprite'), /factory failure/);
            await nextTurn();
            assert.deepStrictEqual(failures, []);
            assert.deepStrictEqual(await cache.get('sprite'), { texture: 'recovered.dds' });
            assert.strictEqual(factoryCalls, 2);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            cache.dispose();
        }
    });

    it('observes an already-started factory rejection when the default token callback throws synchronously', async () => {
        const failures: unknown[] = [];
        const onUnhandled = (reason: unknown) => failures.push(reason);
        process.on('unhandledRejection', onUnhandled);
        let factoryCalls = 0;
        const cache = new PromiseCache({
            factory: async () => {
                if (++factoryCalls === 1) { throw new Error('factory failure'); }
                return 'recovered';
            },
            expireWhenChange: () => {
                if (factoryCalls === 1) { throw new Error('token failure'); }
                return 1;
            },
            life: 0,
        });
        try {
            await assert.rejects(cache.get('sprite'), /token failure/);
            await nextTurn();
            assert.deepStrictEqual(failures, []);
            assert.strictEqual(await cache.get('sprite'), 'recovered');
        } finally {
            process.off('unhandledRejection', onUnhandled);
            cache.dispose();
        }
    });

    for (const synchronous of [false, true]) {
        it(`retries after a ${synchronous ? 'synchronous' : 'shared asynchronous'} initial probe failure`, async () => {
            const probe = deferred<number>();
            let initialChecks = 0;
            let factoryCalls = 0;
            const cache = new PromiseCache({
                initialExpiryToken: () => {
                    if (++initialChecks === 1) {
                        if (synchronous) { throw new Error('probe failure'); }
                        return probe.promise;
                    }
                    return 2;
                },
                expireWhenChange: () => 2,
                factory: async () => ++factoryCalls,
                life: 0,
                nonExpireLife: 0,
            });
            try {
                const failures = Promise.all([
                    assert.rejects(cache.get('shared'), /probe failure/),
                    assert.rejects(cache.get('shared'), /probe failure/),
                ]);
                if (!synchronous) { probe.reject(new Error('probe failure')); }
                await failures;
                assert.strictEqual(initialChecks, 1);
                assert.strictEqual(factoryCalls, 0);
                assert.strictEqual(await cache.get('shared'), 1);
                assert.strictEqual(initialChecks, 2);
            } finally {
                cache.dispose();
            }
        });
    }

    it('retries a factory failure after a successful initial probe', async () => {
        let initialChecks = 0;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            initialExpiryToken: () => ++initialChecks,
            factory: async () => {
                if (++factoryCalls === 1) { throw new Error('factory failure'); }
                return 'recovered';
            },
            life: 0,
        });
        try {
            await assert.rejects(cache.get('shared'), /factory failure/);
            assert.strictEqual(await cache.get('shared'), 'recovered');
            assert.strictEqual(initialChecks, 2);
        } finally {
            cache.dispose();
        }
    });

    for (const invalidation of ['remove', 'clear', 'dispose'] as const) {
        it(`does not repopulate an entry when ${invalidation} interrupts an initial probe`, async () => {
            const probe = deferred<number>();
            let initialChecks = 0;
            let factoryCalls = 0;
            const cache = new PromiseCache({
                initialExpiryToken: () => ++initialChecks === 1 ? probe.promise : 2,
                expireWhenChange: () => 2,
                factory: async () => ++factoryCalls,
                life: 0,
                nonExpireLife: 0,
            });
            try {
                const pending = cache.get('shared');
                await nextTurn();
                if (invalidation === 'remove') { cache.remove('shared'); }
                else { cache[invalidation](); }
                probe.resolve(1);
                assert.strictEqual(await pending, 1);
                assert.strictEqual(await cache.get('shared'), 2);
                assert.strictEqual(initialChecks, 2);
            } finally {
                cache.dispose();
            }
        });
    }

    for (const invalidation of ['remove', 'clear'] as const) {
        for (const reject of [false, true]) {
            it(`preserves a replacement after ${invalidation} when the old probe ${reject ? 'rejects' : 'resolves'}`, async () => {
                const probe = deferred<number>();
                let initialChecks = 0;
                let factoryCalls = 0;
                const cache = new PromiseCache({
                    initialExpiryToken: () => ++initialChecks === 1 ? probe.promise : 2,
                    expireWhenChange: () => 2,
                    factory: async () => ++factoryCalls,
                    life: 0,
                    nonExpireLife: 0,
                });
                try {
                    const pending = cache.get('shared');
                    const rejection = reject ? assert.rejects(pending, /old probe failure/) : undefined;
                    await nextTurn();
                    if (invalidation === 'remove') { cache.remove('shared'); }
                    else { cache.clear(); }
                    assert.strictEqual(await cache.get('shared'), 1);
                    if (reject) {
                        probe.reject(new Error('old probe failure'));
                        await rejection;
                    } else {
                        probe.resolve(1);
                        assert.strictEqual(await pending, 2);
                    }
                    assert.strictEqual(await cache.get('shared'), 1);
                    assert.strictEqual(initialChecks, 2);
                    assert.strictEqual(factoryCalls, reject ? 1 : 2);
                } finally {
                    cache.dispose();
                }
            });
        }
    }

    it('preserves the default sliding non-expiring window', async () => {
        const originalNow = Date.now;
        let now = 1_000;
        Date.now = () => now;
        let version = 1;
        let factoryCalls = 0;
        const cache = new PromiseCache({
            initialExpiryToken: () => version,
            expireWhenChange: () => version,
            factory: async () => ++factoryCalls,
            life: 0,
        });
        try {
            assert.strictEqual(await cache.get('shared'), 1);
            version = 2;
            now += 150;
            assert.strictEqual(await cache.get('shared'), 1);
            now += 150;
            assert.strictEqual(await cache.get('shared'), 1);
            now += 201;
            assert.strictEqual(await cache.get('shared'), 2);
        } finally {
            Date.now = originalNow;
            cache.dispose();
        }
    });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
