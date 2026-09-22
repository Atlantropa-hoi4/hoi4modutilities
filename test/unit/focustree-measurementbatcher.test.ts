import * as assert from 'assert';
import { FocusSceneMeasurementBatcher } from '../../webviewsrc/focustree/measurementbatcher';

describe('focus scene measurement batching', () => {
    function setup(batchSize = 120) {
        const frames: FrameRequestCallback[] = [];
        const cancelled: number[] = [];
        const batches: string[][] = [];
        const batcher = new FocusSceneMeasurementBatcher(ids => batches.push([...ids]), batchSize,
            callback => (frames.push(callback), frames.length), handle => cancelled.push(handle));
        return { frames, cancelled, batches, batcher };
    }

    it('measures each focus only once when mounting and hydration overlap in a frame', () => {
        const { frames, batches, batcher } = setup();
        batcher.schedule(['a', 'b']);
        batcher.schedule(['b', 'c', 'a']);
        assert.strictEqual(frames.length, 1);
        frames.shift()!(0);
        assert.deepStrictEqual(batches, [['a', 'b', 'c']]);
        assert.strictEqual(frames.length, 0);
    });

    it('bounds a large visibility refresh while preserving queued focus order', () => {
        const { frames, batches, batcher } = setup(2);
        batcher.schedule(['a', 'b', 'c', 'd', 'e']);
        frames.shift()!(0);
        assert.deepStrictEqual(batches, [['a', 'b']]);
        assert.strictEqual(frames.length, 1);
        batcher.schedule(['c', 'f']);
        frames.shift()!(1);
        frames.shift()!(2);
        assert.deepStrictEqual(batches, [['a', 'b'], ['c', 'd'], ['e', 'f']]);
        assert.strictEqual(frames.length, 0);
    });

    it('cancels stale scene work without consuming the new scene batch', () => {
        const { frames, cancelled, batches, batcher } = setup();
        batcher.schedule(['old']);
        batcher.clear();
        assert.deepStrictEqual(cancelled, [1]);
        batcher.schedule(['new']);
        frames.shift()!(0);
        assert.deepStrictEqual(batches, []);
        frames.shift()!(1);
        assert.deepStrictEqual(batches, [['new']]);
    });

    it('does not schedule empty work', () => {
        const { frames, batcher } = setup();
        batcher.schedule([]);
        assert.strictEqual(frames.length, 0);
    });

    it('does not cache transient drag transforms and remeasures after commit or cancellation', () => {
        const { frames, batches, batcher } = setup();
        batcher.schedule(['dragged', 'other']);
        batcher.suspend('dragged');
        batcher.schedule(['dragged']);
        frames.shift()!(0);
        assert.deepStrictEqual(batches, [['other']]);
        batcher.resume('dragged');
        frames.shift()!(1);
        assert.deepStrictEqual(batches, [['other'], ['dragged']]);
    });

    it('clears suspended focus ids when switching scenes', () => {
        const { frames, batches, batcher } = setup();
        batcher.suspend('focus');
        batcher.clear();
        batcher.schedule(['focus']);
        frames.shift()!(0);
        assert.deepStrictEqual(batches, [['focus']]);
    });
});
