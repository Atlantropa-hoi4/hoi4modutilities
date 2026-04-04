import * as assert from 'assert';
import { getMioPreviewPriority } from '../../src/previewdef/mio/detect';

describe('mio preview detection', () => {
    it('detects non-canonical files that define MIO traits', () => {
        const priority = getMioPreviewPriority(`
sample_organization = {
    trait = {
        token = sample_trait
        position = { x = 1 y = 1 }
        equipment_bonus = { naval_speed = 0.05 }
    }
}`);

        assert.notStrictEqual(priority, undefined);
    });

    it('detects non-canonical files that mutate included MIO traits', () => {
        const priority = getMioPreviewPriority(`
sample_organization = {
    include = generic_organization
    add_trait = {
        token = sample_trait
        position = { x = 2 y = 2 }
    }
}`);

        assert.notStrictEqual(priority, undefined);
    });

    it('ignores unrelated files that only happen to use overlapping keys', () => {
        const priority = getMioPreviewPriority(`
focus_tree = {
    focus = {
        id = sample_focus
        relative_position_id = other_focus
        mutually_exclusive = { focus = third_focus }
    }
}`);

        assert.strictEqual(priority, undefined);
    });
});
