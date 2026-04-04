import * as assert from 'assert';

const { getDirectlyRelatedFocusIds } = require('../../src/previewdef/focustree/hoverrelations') as typeof import('../../src/previewdef/focustree/hoverrelations');

describe('focus tree hover relation helpers', () => {
    it('collects hovered focus plus direct prerequisite, child, and exclusive relations', () => {
        const related = getDirectlyRelatedFocusIds({
            ROOT: {
                prerequisite: [],
                exclusive: ['RIVAL'],
            },
            CHILD: {
                prerequisite: [['ROOT', 'ALT_PARENT']],
                exclusive: [],
                relativePositionId: 'ROOT',
            },
            ALT_PARENT: {
                prerequisite: [],
                exclusive: [],
            },
            RIVAL: {
                prerequisite: [],
                exclusive: ['ROOT'],
            },
            UNRELATED: {
                prerequisite: [],
                exclusive: [],
            },
        }, 'ROOT').sort();

        assert.deepStrictEqual(related, ['CHILD', 'RIVAL', 'ROOT']);
    });

    it('returns an empty list when the hovered focus is missing', () => {
        assert.deepStrictEqual(getDirectlyRelatedFocusIds({}, 'MISSING'), []);
        assert.deepStrictEqual(getDirectlyRelatedFocusIds({
            ROOT: {
                prerequisite: [],
                exclusive: [],
            },
        }, undefined), []);
    });
});
