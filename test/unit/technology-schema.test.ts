import * as assert from 'assert';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { getTechnologyTrees } from '../../src/previewdef/technology/schema';

describe('technology tree schema', () => {
    it('extracts conditional branches and forced small layouts without duplicating technologies', () => {
        const trees = getTechnologyTrees(parseHoi4File(`
technologies = {
    conditional_root = {
        enable_equipments = yes
        force_use_small_tech_layout = yes
        allow_branch = { has_country_flag = BRANCH_ENABLED }
        path = { leads_to_tech = conditional_child }
        folder = {
            name = infantry_folder
            position = { x = 1 y = 2 }
        }
    }
    conditional_child = {
        folder = {
            name = infantry_folder
            position = { x = 1 y = 3 }
        }
    }
}
`));

        assert.strictEqual(trees.length, 1);
        const [tree] = trees;
        assert.strictEqual(tree.folder, 'infantry_folder');
        assert.strictEqual(tree.startTechnology, 'conditional_root');
        assert.deepStrictEqual(tree.conditionExprs, [
            {
                scopeName: '',
                nodeContent: 'has_country_flag = BRANCH_ENABLED',
            },
        ]);

        const technologyIds = tree.technologies.map(technology => technology.id);
        assert.deepStrictEqual(technologyIds, ['conditional_root', 'conditional_child']);

        const root = tree.technologies.find(technology => technology.id === 'conditional_root');
        const child = tree.technologies.find(technology => technology.id === 'conditional_child');
        assert.ok(root);
        assert.ok(child);
        assert.strictEqual(root.forceUseSmallTechLayout, true);
        assert.strictEqual(child.forceUseSmallTechLayout, false);
        assert.deepStrictEqual(root.inAllowBranch, ['conditional_root']);
        assert.deepStrictEqual(child.inAllowBranch, ['conditional_root']);
    });
});
