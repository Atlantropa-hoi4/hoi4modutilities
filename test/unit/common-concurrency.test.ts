import * as assert from 'assert';
import { createConcurrencyLimiter, mapWithConcurrency } from '../../src/util/common';

describe('common concurrency helpers', () => {
    it('limits concurrent async work while preserving result order', async () => {
        let active = 0;
        let maxActive = 0;
        const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async item => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active -= 1;
            return item * 10;
        });

        assert.deepStrictEqual(results, [10, 20, 30, 40, 50]);
        assert.ok(maxActive <= 2);
    });

    it('rejects invalid concurrency values', async () => {
        await assert.rejects(
            () => mapWithConcurrency([1], 0, async item => item),
            /concurrency must be greater than 0/,
        );
    });

    it('limits separately queued async tasks', async () => {
        const runWithLimit = createConcurrencyLimiter(2);
        let active = 0;
        let maxActive = 0;

        await Promise.all([1, 2, 3, 4, 5].map(item => runWithLimit(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active -= 1;
            return item;
        })));

        assert.ok(maxActive <= 2);
    });

    it('rejects invalid limiter concurrency values', () => {
        assert.throws(
            () => createConcurrencyLimiter(0),
            /concurrency must be greater than 0/,
        );
    });
});
