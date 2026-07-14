import * as assert from 'assert';
import {
    areFocusIdGroupsEqual,
    findBestMatchingFocusIdGroupIndex,
    normalizeParentFocusIds,
    updatePrerequisiteGroupsAfterLinkApply,
} from '../../src/previewdef/focustree/prerequisitelink';

describe('focustree prerequisite link state', () => {
    it('does not treat duplicate ids as a missing distinct id', () => {
        assert.strictEqual(areFocusIdGroupsEqual(['ROOT', 'ROOT'], ['ROOT', 'OTHER']), false);
    });

    it('prefers an exact group over an earlier overlap', () => {
        const groups = [
            ['ROOT', 'THIRD'],
            ['ROOT', 'OTHER'],
        ];

        assert.strictEqual(findBestMatchingFocusIdGroupIndex(groups, ['ROOT', 'OTHER']), 1);
        assert.deepStrictEqual(
            updatePrerequisiteGroupsAfterLinkApply(groups, ['ROOT', 'OTHER'], 'ROOT', 'ROOT'),
            {
                prerequisiteGroups: [['ROOT', 'THIRD']],
                relativePositionId: undefined,
            },
        );
    });

    it('extends the first overlapping group when no exact group exists', () => {
        assert.deepStrictEqual(
            updatePrerequisiteGroupsAfterLinkApply([['ROOT', 'THIRD']], ['ROOT', 'OTHER'], 'ROOT', 'ANCHOR'),
            {
                prerequisiteGroups: [['ROOT', 'THIRD', 'OTHER']],
                relativePositionId: 'ROOT',
            },
        );
    });

    it('normalizes optimistic parent ids the same way as the host edit', () => {
        assert.deepStrictEqual(
            normalizeParentFocusIds('ROOT', ['ROOT', 'CHILD', 'ROOT', 'OTHER'], 'CHILD'),
            ['ROOT', 'OTHER'],
        );
        assert.deepStrictEqual(
            updatePrerequisiteGroupsAfterLinkApply(
                [['ROOT', 'OTHER']],
                normalizeParentFocusIds('ROOT', ['ROOT', 'CHILD', 'ROOT', 'OTHER'], 'CHILD'),
                'ROOT',
                'ROOT',
            ),
            {
                prerequisiteGroups: [],
                relativePositionId: undefined,
            },
        );
    });
});
