import * as assert from 'assert';
import { getSharedOptionChildGroups } from '../../src/previewdef/event/sharedchildren';

describe('event contentbuilder shared option children', () => {
    it('groups identical child events reached from different options into one shared subtree candidate', () => {
        const firstOption = {
            optionName: 'opt_a',
            file: 'events/test.txt',
            token: undefined,
            children: [
                {
                    toScope: '{event_target}',
                    toNode: 'shared.2',
                    days: 0,
                    hours: 0,
                    randomDays: 0,
                    randomHours: 0,
                },
            ],
        };
        const secondOption = {
            optionName: 'opt_b',
            file: 'events/test.txt',
            token: undefined,
            children: [
                {
                    toScope: '{event_target}',
                    toNode: 'shared.2',
                    days: 0,
                    hours: 0,
                    randomDays: 0,
                    randomHours: 0,
                },
            ],
        };
        const delayedOption = {
            optionName: 'opt_c',
            file: 'events/test.txt',
            token: undefined,
            children: [
                {
                    toScope: '{event_target}',
                    toNode: 'shared.2',
                    days: 2,
                    hours: 0,
                    randomDays: 0,
                    randomHours: 0,
                },
            ],
        };

        const groups = getSharedOptionChildGroups(
            [firstOption as any, secondOption as any, delayedOption as any],
            { fromStack: [], currentScopeName: 'EVENT_TARGET' },
        );

        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0]?.optionNodes.length, 2);
        assert.strictEqual(groups[0]?.edge.toNode, 'shared.2');
        assert.deepStrictEqual(groups[0]?.optionNodes.map(option => option.optionName), ['opt_a', 'opt_b']);
    });
});
