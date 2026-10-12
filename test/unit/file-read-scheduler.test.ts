import * as assert from 'assert';
import { FileReadScheduler } from '../../src/util/fileReadScheduler';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 100; i++) {
        await Promise.resolve();
    }
}

describe('file read scheduler', () => {
    it('bounds both priorities to the same twelve slots', async () => {
        const scheduler = new FileReadScheduler(12);
        const gates = Array.from({ length: 30 }, () => deferred<void>());
        let active = 0;
        let maximum = 0;
        const started: number[] = [];
        const jobs = gates.map((gate, index) => scheduler.schedule(async () => {
            active++;
            maximum = Math.max(maximum, active);
            started.push(index);
            await gate.promise;
            active--;
            return index;
        }, index % 2 ? 'background' : 'interactive'));
        await flushMicrotasks();
        assert.strictEqual(started.length, 12);
        assert.strictEqual(active, 12);
        for (const gate of gates) {
            gate.resolve();
        }
        assert.deepStrictEqual(await Promise.all(jobs.map(job => job.promise)), gates.map((_, index) => index));
        assert.strictEqual(maximum, 12);
        assert.strictEqual(active, 0);
    });

    for (const promotedIndex of [0, 1, 2]) {
        it(`promotes background queue position ${promotedIndex} in place without duplicate work`, async () => {
            const scheduler = new FileReadScheduler(1);
            const blocker = deferred<void>();
            const first = scheduler.schedule(() => blocker.promise, 'background');
            const started: number[] = [];
            const priorities: string[] = [];
            const jobs = [0, 1, 2].map(index => scheduler.schedule(async priority => {
                started.push(index);
                priorities.push(priority);
                return index;
            }, 'background'));
            assert.strictEqual(jobs[promotedIndex].promote(), true);
            assert.strictEqual(jobs[promotedIndex].promote(), false);
            await flushMicrotasks();
            assert.deepStrictEqual(started, []);
            blocker.resolve();
            await Promise.all([first.promise, ...jobs.map(job => job.promise)]);
            assert.deepStrictEqual(started, [promotedIndex, ...[0, 1, 2].filter(index => index !== promotedIndex)]);
            assert.deepStrictEqual(priorities, ['interactive', 'background', 'background']);
            assert.strictEqual(jobs[promotedIndex].promote(), false);
        });
    }

    it('admits a new interactive read before pending background reads', async () => {
        const scheduler = new FileReadScheduler(1);
        const blocker = deferred<void>();
        const first = scheduler.schedule(() => blocker.promise, 'background');
        const order: string[] = [];
        const background = Array.from({ length: 20 }, (_, index) => scheduler.schedule(async () => {
            order.push(`background-${index}`);
        }, 'background'));
        const interactive = scheduler.schedule(async () => { order.push('preview'); });
        blocker.resolve();
        await Promise.all([first.promise, interactive.promise, ...background.map(job => job.promise)]);
        assert.strictEqual(order[0], 'preview');
        assert.deepStrictEqual(order.slice(1), background.map((_, index) => `background-${index}`));
    });

    it('advances background work after at most three interactive admissions', async () => {
        const scheduler = new FileReadScheduler(1);
        const blocker = deferred<void>();
        const first = scheduler.schedule(() => blocker.promise);
        const order: string[] = [];
        const background = [0, 1].map(index => scheduler.schedule(async () => {
            order.push(`background-${index}`);
        }, 'background'));
        const interactive = Array.from({ length: 8 }, (_, index) => scheduler.schedule(async () => {
            order.push(`interactive-${index}`);
        }));
        blocker.resolve();
        await Promise.all([first.promise, ...background.map(job => job.promise), ...interactive.map(job => job.promise)]);
        assert.deepStrictEqual(order, [
            'interactive-0', 'interactive-1', 'interactive-2', 'background-0',
            'interactive-3', 'interactive-4', 'interactive-5', 'background-1',
            'interactive-6', 'interactive-7',
        ]);
    });

    it('reports queued wait separately using the effective promoted priority', async () => {
        const scheduler = new FileReadScheduler(1);
        const blocker = deferred<void>();
        const originalNow = Date.now;
        let now = 1000;
        Date.now = () => now;
        try {
            const first = scheduler.schedule(() => blocker.promise, 'background');
            await flushMicrotasks();
            const observed: Array<{ priority: string; wait: number }> = [];
            const queued = scheduler.schedule(async (priority, wait) => {
                observed.push({ priority, wait });
            }, 'background');
            assert.strictEqual(queued.queued, true);
            assert.strictEqual(queued.promote(), true);
            now += 75;
            blocker.resolve();
            await Promise.all([first.promise, queued.promise]);
            assert.deepStrictEqual(observed, [{ priority: 'interactive', wait: 75 }]);
        } finally {
            blocker.resolve();
            Date.now = originalNow;
        }
    });

    it('releases slots after synchronous throws and asynchronous rejections without recursive draining', async () => {
        const scheduler = new FileReadScheduler(1);
        const blocker = deferred<void>();
        const first = scheduler.schedule(() => blocker.promise);
        const expected = new Error('read failed');
        const failures = Array.from({ length: 2000 }, (_, index) => {
            const job = scheduler.schedule(() => {
                if (index % 2 === 0) {
                    throw expected;
                }
                return Promise.reject(expected);
            }, index % 3 ? 'background' : 'interactive');
            return job.promise.then(() => assert.fail('failing read succeeded'), error => assert.strictEqual(error, expected));
        });
        const survivor = scheduler.schedule(async () => 'completed', 'background');
        blocker.resolve();
        await Promise.all([first.promise, ...failures]);
        assert.strictEqual(await survivor.promise, 'completed');
        assert.strictEqual(await scheduler.schedule(async () => 'next').promise, 'next');
    });
});
