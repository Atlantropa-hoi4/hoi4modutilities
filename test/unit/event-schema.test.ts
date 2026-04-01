import * as assert from 'assert';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { getEvents } from '../../src/previewdef/event/schema';
import { readFixture } from '../testUtils';

describe('event schema fixtures', () => {
    it('extracts namespaces and child events from modern event files', () => {
        const events = getEvents(parseHoi4File(readFixture('events', 'modern-events.txt')), 'events/modern-events.txt');
        const modernEvents = events.eventItemsByNamespace.modern;

        assert.ok(modernEvents);
        assert.strictEqual(modernEvents.length, 4);

        const firstEvent = modernEvents.find(event => event.id === 'modern.1');
        const newsEvent = modernEvents.find(event => event.id === 'modern.2');
        const operativeEvent = modernEvents.find(event => event.id === 'modern.3');

        assert.ok(firstEvent);
        assert.ok(newsEvent);
        assert.ok(operativeEvent);
        assert.deepStrictEqual(firstEvent?.immediate.childEvents, [
            {
                scopeName: '{event_target}',
                eventName: 'modern.2',
                days: 0,
                hours: 0,
                randomDays: 0,
                randomHours: 0,
            },
        ]);
        assert.deepStrictEqual(firstEvent?.options[0]?.childEvents, [
            {
                scopeName: '{event_target}',
                eventName: 'modern.3',
                days: 0,
                hours: 6,
                randomDays: 0,
                randomHours: 2,
            },
        ]);
        assert.strictEqual(newsEvent?.type, 'news');
        assert.deepStrictEqual(operativeEvent?.immediate.childEvents, [
            {
                scopeName: 'test_vendor',
                eventName: 'modern.4',
                days: 2,
                hours: 0,
                randomDays: 1,
                randomHours: 0,
            },
        ]);
    });
});
