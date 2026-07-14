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
});
