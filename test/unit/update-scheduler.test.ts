import * as assert from 'assert';
import { UpdateScheduler } from '../../src/services/updateScheduler';
import { FakeUpdateClock } from './fake-update-clock';

describe('update scheduler', () => {
    let clock: FakeUpdateClock;
    beforeEach(() => {
        clock = new FakeUpdateClock();
        clock.install();
    });
    afterEach(() => clock.restore());

    it('runs only the latest pending action for a serialized key', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];

        scheduler.schedule('same', 0, () => { calls.push('first'); });
        scheduler.schedule('same', 0, () => { calls.push('second'); });
        await clock.advance();

        assert.deepStrictEqual(calls, ['second']);
        scheduler.dispose();
    });

    it('reports synchronous throws and asynchronous rejections', async () => {
        const errors: unknown[] = [];
        const scheduler = new UpdateScheduler<string>(key => key, error => errors.push(error));
        const syncError = new Error('sync failure');
        const asyncError = new Error('async failure');

        scheduler.schedule('sync', 0, () => { throw syncError; });
        scheduler.schedule('async', 0, async () => { throw asyncError; });
        await clock.advance();

        assert.deepStrictEqual(errors, [syncError, asyncError]);
        scheduler.dispose();
    });

    it('does not run cancelled or disposed actions', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];

        scheduler.schedule('cancelled', 0, () => { calls.push('cancelled'); });
        scheduler.cancel('cancelled');
        scheduler.schedule('disposed', 0, () => { calls.push('disposed'); });
        scheduler.dispose();
        await clock.advance();

        assert.deepStrictEqual(calls, []);
    });

    it('coalesces a typing burst until the latest request reaches its trailing deadline', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: number[] = [];
        scheduler.schedule('focus', 35, () => { calls.push(1); }, { serialize: true });
        await clock.advance(20);
        scheduler.schedule('focus', 35, () => { calls.push(2); }, { serialize: true });
        await clock.advance(20);
        scheduler.schedule('focus', 35, () => { calls.push(3); }, { serialize: true });
        await clock.advance(34);
        assert.deepStrictEqual(calls, []);
        await clock.advance(1);
        assert.deepStrictEqual(calls, [3]);
        scheduler.dispose();
    });

    it('bounds serialized work to one running action and the latest pending action', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];
        let finish!: () => void;
        scheduler.schedule('focus', 0, () => {
            calls.push('running');
            return new Promise<void>(resolve => { finish = resolve; });
        }, { serialize: true });
        await clock.advance();
        scheduler.schedule('focus', 35, () => { calls.push('superseded'); }, { serialize: true });
        await clock.advance(35);
        scheduler.schedule('focus', 0, () => { calls.push('undo'); }, { serialize: true });
        await clock.advance();
        assert.deepStrictEqual(calls, ['running']);
        finish();
        await clock.advance();
        assert.deepStrictEqual(calls, ['running', 'undo']);
        scheduler.dispose();
    });

    it('allows unrelated keys and nonserialized actions to continue while an action is running', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];
        let finish!: () => void;
        scheduler.schedule('focus', 0, () => new Promise<void>(resolve => { finish = resolve; }), { serialize: true });
        await clock.advance();
        scheduler.schedule('other', 0, () => { calls.push('other'); }, { serialize: true });
        scheduler.schedule('focus', 0, () => { calls.push('nonserialized'); });
        await clock.advance();
        assert.deepStrictEqual(calls, ['other', 'nonserialized']);
        finish();
        await clock.advance();
        scheduler.dispose();
    });

    it('rejects superseded, cancelled and disposed callbacks after their timers have fired', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];
        scheduler.schedule('focus', 0, () => { calls.push('stale'); });
        clock.fireTimers(0);
        scheduler.schedule('focus', 0, () => { calls.push('latest'); });
        await clock.advance();
        assert.deepStrictEqual(calls, ['latest']);

        scheduler.schedule('focus', 0, () => { calls.push('cancelled'); });
        clock.fireTimers(0);
        scheduler.cancel('focus');
        await clock.advance();
        scheduler.schedule('focus', 0, () => { calls.push('disposed'); });
        clock.fireTimers(0);
        scheduler.dispose();
        scheduler.schedule('focus', 0, () => { calls.push('after-dispose'); });
        await clock.advance();
        assert.deepStrictEqual(calls, ['latest']);
    });

    it('drops ready pending work on disposal and continues after a serialized action fails', async () => {
        const errors: unknown[] = [];
        const scheduler = new UpdateScheduler<string>(key => key, error => errors.push(error));
        const calls: string[] = [];
        let fail!: (error: Error) => void;
        const failure = new Error('running failure');
        scheduler.schedule('focus', 0, () => new Promise<void>((_resolve, reject) => { fail = reject; }), { serialize: true });
        await clock.advance();
        scheduler.schedule('focus', 0, () => { calls.push('after-failure'); }, { serialize: true });
        await clock.advance();
        fail(failure);
        await clock.advance();
        assert.deepStrictEqual(errors, [failure]);
        assert.deepStrictEqual(calls, ['after-failure']);

        let finish!: () => void;
        scheduler.schedule('focus', 0, () => new Promise<void>(resolve => { finish = resolve; }), { serialize: true });
        await clock.advance();
        scheduler.schedule('focus', 0, () => { calls.push('disposed-pending'); }, { serialize: true });
        await clock.advance();
        scheduler.dispose();
        finish();
        await clock.advance();
        assert.deepStrictEqual(calls, ['after-failure']);
    });
});
