import * as assert from 'assert';
import * as path from 'path';
import { getRelativePathWithinRoot } from '../../src/util/nodecommon';

describe('node path helpers', () => {
    it('resolves selected-root files without requiring a VS Code workspace folder', () => {
        const root = path.join('C:', 'mods', 'selected');

        assert.strictEqual(
            getRelativePathWithinRoot(root, path.join(root, 'interface', 'goals.gfx'), 'interface'),
            'interface/goals.gfx',
        );
        assert.strictEqual(
            getRelativePathWithinRoot(root, path.join(root, 'events', 'test.txt'), 'interface'),
            undefined,
        );
        assert.strictEqual(
            getRelativePathWithinRoot(root, path.join(root, 'localisation', 'test_l_english.yml'), 'localisation'),
            'localisation/test_l_english.yml',
        );
        assert.strictEqual(
            getRelativePathWithinRoot(
                root,
                path.join(root, 'common', 'national_focus', 'shared.txt'),
                'common/national_focus',
            ),
            'common/national_focus/shared.txt',
        );
        assert.strictEqual(
            getRelativePathWithinRoot(root, path.join(root, '..', 'other', 'interface', 'goals.gfx'), 'interface'),
            undefined,
        );
    });
});
