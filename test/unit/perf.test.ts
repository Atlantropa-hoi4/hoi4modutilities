import * as assert from 'assert';
import {
    getPerfSnapshot,
    incrementPerfCounter,
    measureAsync,
    measureSync,
    resetPerfMetrics,
} from '../../src/util/perf';

describe('perf utility', () => {
    beforeEach(() => {
        resetPerfMetrics();
    });

    it('records successful async durations', async () => {
        const value = await measureAsync('test.async.success', { stage: 'unit' }, async () => 42);

        assert.strictEqual(value, 42);
        const snapshot = getPerfSnapshot();
        assert.strictEqual(snapshot.entries.length, 1);
        assert.strictEqual(snapshot.entries[0].label, 'test.async.success');
        assert.deepStrictEqual(snapshot.entries[0].tags, { stage: 'unit' });
        assert.strictEqual(snapshot.entries[0].ok, true);
        assert.ok(snapshot.entries[0].durationMs >= 0);
    });

    it('records rejected async durations before rethrowing', async () => {
        await assert.rejects(
            () => measureAsync('test.async.reject', { stage: 'unit' }, async () => {
                throw new Error('boom');
            }),
            /boom/,
        );

        const snapshot = getPerfSnapshot();
        assert.strictEqual(snapshot.entries.length, 1);
        assert.strictEqual(snapshot.entries[0].label, 'test.async.reject');
        assert.strictEqual(snapshot.entries[0].ok, false);
        assert.strictEqual(snapshot.entries[0].error, 'boom');
    });

    it('records sync failures before rethrowing', () => {
        assert.throws(
            () => measureSync('test.sync.throw', { stage: 'unit' }, () => {
                throw new Error('sync boom');
            }),
            /sync boom/,
        );

        const snapshot = getPerfSnapshot();
        assert.strictEqual(snapshot.entries.length, 1);
        assert.strictEqual(snapshot.entries[0].label, 'test.sync.throw');
        assert.strictEqual(snapshot.entries[0].ok, false);
        assert.strictEqual(snapshot.entries[0].error, 'sync boom');
    });

    it('aggregates counters by label and tags', () => {
        incrementPerfCounter('test.counter', { cache: 'sprite' });
        incrementPerfCounter('test.counter', { cache: 'sprite' }, 2);
        incrementPerfCounter('test.counter', { cache: 'image' });

        const counters = getPerfSnapshot().counters;
        const spriteCounter = counters.find(counter => counter.tags.cache === 'sprite');
        const imageCounter = counters.find(counter => counter.tags.cache === 'image');

        assert.strictEqual(spriteCounter?.count, 3);
        assert.strictEqual(imageCounter?.count, 1);
    });
});
