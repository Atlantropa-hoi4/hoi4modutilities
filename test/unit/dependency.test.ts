import * as assert from 'assert';
import { getDependenciesFromText } from '../../src/util/dependencyheader';
import { readFixture } from '../testUtils';

describe('dependency headers', () => {
    it('normalizes supported dependency directives from fixtures', () => {
        const dependencies = getDependenciesFromText(readFixture('dependency', 'headers.txt'));

        assert.deepStrictEqual(dependencies, [
            { type: 'event', path: 'events/modern_events.txt' },
            { type: 'localisation', path: 'localisation/modern_events_l_english.yml' },
            { type: 'gfx', path: 'interface/event_pictures.gfx' },
            { type: 'png', path: 'interface/ignored.png' },
        ]);
    });
});
