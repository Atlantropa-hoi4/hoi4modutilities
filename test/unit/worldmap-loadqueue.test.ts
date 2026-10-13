import * as assert from 'assert';
import { WorldMapLoadQueue, WorldMapLoadRequest } from '../../src/previewdef/worldmap/worldmaploadqueue';

describe('world map load queue', () => {
    it('runs one load at a time and keeps only the latest pending generation', async () => {
        const started: WorldMapLoadRequest[] = [];
        const completions: (() => void)[] = [];
        let active = 0;
        let maxActive = 0;
        const queue = new WorldMapLoadQueue(async request => {
            started.push(request);
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>(resolve => completions.push(resolve));
            active--;
        });

        const first = queue.enqueue({ loadGeneration: 1, force: false });
        await Promise.resolve();
        void queue.enqueue({ loadGeneration: 2, force: false });
        void queue.enqueue({ loadGeneration: 3, force: false });

        assert.deepStrictEqual(started.map(request => request.loadGeneration), [1]);
        completions.shift()!();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepStrictEqual(started.map(request => request.loadGeneration), [1, 3]);
        assert.strictEqual(maxActive, 1);

        completions.shift()!();
        await first;
    });

    it('preserves a force request when a later generation supersedes it', async () => {
        const started: WorldMapLoadRequest[] = [];
        const completions: (() => void)[] = [];
        const queue = new WorldMapLoadQueue(async request => {
            started.push(request);
            await new Promise<void>(resolve => completions.push(resolve));
        });

        const first = queue.enqueue({ loadGeneration: 1, force: true });
        await Promise.resolve();
        void queue.enqueue({ loadGeneration: 2, force: false });
        completions.shift()!();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepStrictEqual(started[1], { loadGeneration: 2, force: true });
        completions.shift()!();
        await first;
    });

    it('cancels superseded active work but starts only the latest pending generation after retirement', async () => {
        const generations: number[] = [];
        const signals: AbortSignal[] = [];
        let latestStarted!: () => void;
        let finishLatest!: () => void;
        const latest = new Promise<void>(resolve => { latestStarted = resolve; });
        const queue = new WorldMapLoadQueue(async (request, signal) => {
            generations.push(request.loadGeneration);
            signals.push(signal);
            if (request.loadGeneration === 1) {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
                signal.throwIfAborted();
            } else {
                latestStarted();
                await new Promise<void>(resolve => { finishLatest = resolve; });
            }
        });
        const drained = queue.enqueue({ loadGeneration: 1, force: true });
        void queue.enqueue({ loadGeneration: 2, force: false });
        void queue.enqueue({ loadGeneration: 3, force: false });
        assert.strictEqual(signals[0].aborted, true);
        await latest;
        assert.deepStrictEqual(generations, [1, 3]);
        assert.strictEqual(signals[1].aborted, false);
        finishLatest();
        await drained;
        assert.strictEqual(queue.isRunning, false);
    });

    it('cancels active work and discards pending work when the panel is disposed', async () => {
        const generations: number[] = [];
        let signal: AbortSignal | undefined;
        const queue = new WorldMapLoadQueue(async (request, ownedSignal) => {
            generations.push(request.loadGeneration);
            signal = ownedSignal;
            await new Promise<void>(resolve => ownedSignal.addEventListener('abort', () => resolve(), { once: true }));
            ownedSignal.throwIfAborted();
        });
        const drained = queue.enqueue({ loadGeneration: 1, force: false });
        void queue.enqueue({ loadGeneration: 2, force: false });
        queue.clearPending();
        assert.strictEqual(signal?.aborted, true);
        await drained;
        assert.deepStrictEqual(generations, [1]);
        assert.strictEqual(queue.isRunning, false);
    });
});
