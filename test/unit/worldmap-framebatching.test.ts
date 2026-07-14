import * as assert from 'assert';
import { AnimationFrameScheduler } from '../../webviewsrc/worldmap/framescheduler';
import { WorldMapStateBatcher } from '../../webviewsrc/worldmap/statebatcher';
import { nextBehaviorSubjectIfChanged } from '../../webviewsrc/worldmap/subject';
import { BehaviorSubject } from 'rxjs';

describe('world map frame batching', () => {
    it('coalesces a burst into one animation-frame callback', () => {
        const frames: FrameRequestCallback[] = [];
        let callbackCount = 0;
        const scheduler = new AnimationFrameScheduler(
            () => callbackCount++,
            callback => (frames.push(callback), frames.length),
            () => undefined,
        );

        scheduler.schedule();
        scheduler.schedule();
        scheduler.schedule();
        assert.strictEqual(frames.length, 1);

        frames.shift()!(0);
        assert.strictEqual(callbackCount, 1);
        scheduler.schedule();
        assert.strictEqual(frames.length, 1);
    });

    it('batches persisted state keys and skips unchanged values', () => {
        const frames: FrameRequestCallback[] = [];
        const patches: Record<string, unknown>[] = [];
        const batcher = new WorldMapStateBatcher(
            patch => patches.push(patch),
            callback => (frames.push(callback), frames.length),
            () => undefined,
        );

        batcher.update('viewMode', 'province');
        batcher.update('viewMode', 'province');
        batcher.update('scale', 2);
        assert.strictEqual(frames.length, 1);

        frames.shift()!(0);
        assert.deepStrictEqual(patches, [{ viewMode: 'province', scale: 2 }]);
    });

    it('does not emit unchanged hover values', () => {
        const subject = new BehaviorSubject<number | undefined>(3);
        let emissions = 0;
        subject.subscribe(() => emissions++);

        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, 3), false);
        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, 4), true);
        assert.strictEqual(emissions, 2);
    });
});
