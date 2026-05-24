import * as assert from 'assert';
import { PreviewDependencyTracker } from '../../src/previewdef/previewdependencytracker';

describe('preview dependency tracker', () => {
    it('matches indexed dependencies while preserving wildcard fallback and removal', () => {
        const tracker = new PreviewDependencyTracker();
        const iconPreview = createPreview('icon');
        const sameNamePreview = createPreview('same-name');
        const wildcardPreview = createPreview('wildcard');

        tracker.add(iconPreview, ['gfx\\interface\\goals\\icon.dds']);
        tracker.add(sameNamePreview, ['gfx/interface/other/icon.dds']);
        tracker.add(wildcardPreview, ['common/national_focus/*']);

        assert.deepStrictEqual(
            tracker.getAffected('file:///workspace/gfx/interface/goals/icon.dds'),
            [iconPreview],
        );
        assert.deepStrictEqual(
            tracker.getAffected('file:///workspace/common/national_focus/tree.txt'),
            [wildcardPreview],
        );
        assert.deepStrictEqual(
            tracker.getAffected('file:///workspace/gfx/interface/goals/missing.dds'),
            [],
        );

        tracker.remove(iconPreview);

        assert.deepStrictEqual(
            tracker.getAffected('file:///workspace/gfx/interface/goals/icon.dds'),
            [],
        );
    });
});

function createPreview(name: string) {
    return { name } as any;
}
