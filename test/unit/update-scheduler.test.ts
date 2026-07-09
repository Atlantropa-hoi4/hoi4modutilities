import * as assert from 'assert';
import { UpdateScheduler } from '../../src/services/updateScheduler';

describe('update scheduler', () => {
    it('runs only the latest pending action for a serialized key', async () => {
        const scheduler = new UpdateScheduler<string>(key => key);
        const calls: string[] = [];

        scheduler.schedule('same', 0, () => { calls.push('first'); });
        scheduler.schedule('same', 0, () => { calls.push('second'); });
        await flushScheduledActions();

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
        await flushScheduledActions();

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
        await flushScheduledActions();

        assert.deepStrictEqual(calls, []);
    });
});

async function flushScheduledActions(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
}
