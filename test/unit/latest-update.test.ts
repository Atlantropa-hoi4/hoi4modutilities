import * as assert from 'assert';
import { LatestGeneration, LatestUpdateCoordinator } from '../../src/util/latestUpdate';

describe('latest update coordinator', () => {
    it('serializes one path and commits only its newest requested update', async () => {
        const coordinator = new LatestUpdateCoordinator<string>();
        const first = createDeferred<string>();
        const second = createDeferred<string>();
        const commits: string[] = [];
        let startedLoads = 0;

        const firstUpdate = coordinator.update('same-file', async () => {
            startedLoads += 1;
            return first.promise;
        }, value => commits.push(value));
        await waitFor(() => startedLoads === 1);
        const secondUpdate = coordinator.update('same-file', async () => {
            startedLoads += 1;
            return second.promise;
        }, value => commits.push(value));

        await waitForMicrotasks();
        assert.strictEqual(startedLoads, 1);
        first.resolve('old');
        await firstUpdate;
        await waitFor(() => startedLoads === 2);
        assert.strictEqual(startedLoads, 2);
        assert.deepStrictEqual(commits, []);

        second.resolve('new');
        await Promise.all([firstUpdate, secondUpdate]);
        assert.deepStrictEqual(commits, ['new']);
    });

    it('prevents a pending add from committing after the path is deleted', async () => {
        const coordinator = new LatestUpdateCoordinator<string>();
        const load = createDeferred<string>();
        let activeValue: string | undefined = 'existing';
        let started = false;
        const addUpdate = coordinator.update('deleted-file', async () => {
            started = true;
            return load.promise;
        }, value => {
            activeValue = value;
        });
        await waitFor(() => started);

        const deleteUpdate = coordinator.update('deleted-file', async () => undefined, () => {
            activeValue = undefined;
        });
        load.resolve('stale');
        await Promise.all([addUpdate, deleteUpdate]);

        assert.strictEqual(activeValue, undefined);
    });

    it('discards pre-reset work and serializes a new-epoch update behind it', async () => {
        const coordinator = new LatestUpdateCoordinator<string>();
        const stale = createDeferred<string>();
        const current = createDeferred<string>();
        const commits: string[] = [];
        let staleStarted = false;
        let currentStarted = false;
        const staleUpdate = coordinator.update('same-file', async () => {
            staleStarted = true;
            return stale.promise;
        }, value => commits.push(value));
        await waitFor(() => staleStarted);

        coordinator.invalidateAll();
        const currentUpdate = coordinator.update('same-file', async () => {
            currentStarted = true;
            return current.promise;
        }, value => commits.push(value));
        await waitForMicrotasks();
        assert.strictEqual(currentStarted, false);

        stale.resolve('stale');
        await staleUpdate;
        await waitFor(() => currentStarted);
        assert.strictEqual(currentStarted, true);
        assert.deepStrictEqual(commits, []);

        current.resolve('current');
        await Promise.all([staleUpdate, currentUpdate]);
        assert.deepStrictEqual(commits, ['current']);
    });

    it('skips stale queued loads before starting the latest one', async () => {
        const coordinator = new LatestUpdateCoordinator<string>();
        const first = createDeferred<string>();
        const commits: string[] = [];
        const startedLoads: string[] = [];
        const firstUpdate = coordinator.update('same-file', async () => {
            startedLoads.push('first');
            return first.promise;
        }, value => commits.push(value));
        await waitFor(() => startedLoads.length === 1);

        const staleQueuedUpdate = coordinator.update('same-file', async () => {
            startedLoads.push('stale-queued');
            return 'stale-queued';
        }, value => commits.push(value));
        const latestUpdate = coordinator.update('same-file', async () => {
            startedLoads.push('latest');
            return 'latest';
        }, value => commits.push(value));

        first.resolve('first');
        await Promise.all([firstUpdate, staleQueuedUpdate, latestUpdate]);
        assert.deepStrictEqual(startedLoads, ['first', 'latest']);
        assert.deepStrictEqual(commits, ['latest']);
    });
});

describe('latest generation', () => {
    it('invalidates stale async setup and disposal callbacks', () => {
        const generation = new LatestGeneration();
        const first = generation.next();
        const second = generation.next();

        assert.strictEqual(first(), false);
        assert.strictEqual(second(), true);

        generation.invalidate();
        assert.strictEqual(second(), false);
    });
});

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function waitForMicrotasks(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await Promise.resolve();
    }
}

async function waitFor(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 20 && !condition(); i++) {
        await Promise.resolve();
    }
    assert.strictEqual(condition(), true);
}
