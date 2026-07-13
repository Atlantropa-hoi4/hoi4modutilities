import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { readFixture } from '../testUtils';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
const mockLoad = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                }),
            },
        };
    }

    return originalLoad.call(nodeModule, request, parent, isMain);
};
nodeModule._load = mockLoad;

describe('focus tree schema fixtures', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('extracts only shared and joint focus ids for indexing', () => {
        const { extractFocusIds } = loadFocusTreeSchema();
        const ids = extractFocusIds(parseHoi4File(readFixture('focus', 'modern-focuses.txt')));

        assert.deepStrictEqual(ids, ['SHARED_ROOT', 'JOINT_ALPHA']);
    });

    it('creates separate joint focus trees and links them from focus_tree shared_focus references', () => {
        const { convertFocusFileNodeToJson, getFocusTreeWithFocusFile } = loadFocusTreeSchema();
        const constants = {};
        const file = convertFocusFileNodeToJson(parseHoi4File(readFixture('focus', 'modern-focuses.txt')), constants);
        const trees = getFocusTreeWithFocusFile(file, [], 'common/national_focus/modern-focuses.txt', constants);

        assert.strictEqual(trees.length, 3);
        assert.deepStrictEqual(trees.map(tree => tree.kind), ['shared', 'joint', 'focus']);

        const jointTree = trees.find(tree => tree.kind === 'joint');
        const focusTree = trees.find(tree => tree.kind === 'focus');

        assert.ok(jointTree);
        assert.ok(focusTree);
        assert.ok(jointTree?.focuses.JOINT_ALPHA);
        assert.ok(focusTree?.focuses.JOINT_ALPHA);
        assert.strictEqual(focusTree?.inlayWindowRefs.length, 1);
        assert.strictEqual(focusTree?.inlayWindowRefs[0]?.id, 'test_inlay');
        assert.deepStrictEqual(focusTree?.inlayWindowRefs[0]?.position, { x: 150, y: 275 });
    });

    it('marks imported shared focuses as read-only for current file drag editing', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const sharedTrees = getFocusTree(
            parseHoi4File(`
                shared_focus = {
                    id = SHARED_EXTERNAL
                    x = 2
                    y = 3
                }
            `),
            [],
            'common/national_focus/shared.txt',
        );
        const trees = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = main_tree
                    shared_focus = SHARED_EXTERNAL
                    focus = {
                        id = LOCAL_ONLY
                        x = 1
                        y = 1
                    }
                }
            `),
            sharedTrees,
            'common/national_focus/main.txt',
        );

        const focusTree = trees.find(tree => tree.kind === 'focus');
        assert.ok(focusTree);
        assert.strictEqual(focusTree?.focuses.LOCAL_ONLY.isInCurrentFile, true);
        assert.strictEqual(focusTree?.focuses.LOCAL_ONLY.layout?.sourceFile, 'common/national_focus/main.txt');
        assert.strictEqual(focusTree?.focuses.SHARED_EXTERNAL.isInCurrentFile, false);
        assert.strictEqual(focusTree?.focuses.SHARED_EXTERNAL.layout?.sourceFile, 'common/national_focus/shared.txt');
    });

    it('keeps local focus when imported shared focus has the same id', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const sharedTrees = getFocusTree(
            parseHoi4File(`
                shared_focus = {
                    id = SHARED_EXTERNAL
                    x = 2
                    y = 3
                }
            `),
            [],
            'common/national_focus/shared.txt',
        );
        const trees = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = main_tree
                    shared_focus = SHARED_EXTERNAL
                    focus = {
                        id = SHARED_EXTERNAL
                        x = 9
                        y = 9
                    }
                }
            `),
            sharedTrees,
            'common/national_focus/main.txt',
        );

        const focusTree = trees.find(tree => tree.kind === 'focus');
        const focus = focusTree?.focuses.SHARED_EXTERNAL;
        assert.ok(focusTree);
        assert.ok(focus);
        assert.strictEqual(focus.isInCurrentFile, true);
        assert.strictEqual(focus.file, 'common/national_focus/main.txt');
        assert.strictEqual(focus.x, 9);
        assert.strictEqual(focus.y, 9);
        assert.ok(focusTree?.warnings.some((entry: any) =>
            entry.code === 'focus-duplicate-id'
            && entry.source === 'SHARED_EXTERNAL',
        ));
    });

    it('does not import regular focus tree focuses through shared_focus references', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const importedTrees = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = other_tree
                    focus = {
                        id = REGULAR_EXTERNAL
                        x = 2
                        y = 3
                    }
                }
            `),
            [],
            'common/national_focus/other.txt',
        );
        const trees = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = main_tree
                    shared_focus = REGULAR_EXTERNAL
                    focus = {
                        id = LOCAL_ONLY
                        x = 1
                        y = 1
                    }
                }
            `),
            importedTrees,
            'common/national_focus/main.txt',
        );

        const focusTree = trees.find(tree => tree.kind === 'focus');
        assert.ok(focusTree);
        assert.strictEqual(focusTree?.focuses.REGULAR_EXTERNAL, undefined);
        assert.strictEqual(focusTree?.focuses.LOCAL_ONLY.isInCurrentFile, true);
        assert.ok(focusTree?.warnings.some((entry: any) =>
            entry.code === 'shared-focus-target-not-shared'
            && entry.source === 'REGULAR_EXTERNAL'));
    });

    it('reports focus_tree shared_focus references that cannot be resolved', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const [tree] = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = main_tree
                    shared_focus = MISSING_SHARED
                    focus = {
                        id = LOCAL_ONLY
                        x = 1
                        y = 1
                    }
                }
            `),
            [],
            'common/national_focus/main.txt',
        );

        assert.ok(tree);
        assert.ok(tree.warnings.some((entry: any) =>
            entry.code === 'shared-focus-target-missing'
            && entry.source === 'MISSING_SHARED'));
    });

    it('captures editable continuous focus position metadata for local focus trees', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const trees = getFocusTree(
            parseHoi4File(readFixture('focus', 'layout-edit.txt')),
            [],
            'common/national_focus/layout-edit.txt',
        );
        const focusTree = trees.find(tree => tree.kind === 'focus');

        assert.ok(focusTree);
        assert.strictEqual(focusTree?.continuousLayout?.editKey, 'focus-tree:common/national_focus/layout-edit.txt:focus:0');
        assert.strictEqual(focusTree?.continuousLayout?.sourceFile, 'common/national_focus/layout-edit.txt');
        assert.deepStrictEqual(focusTree?.continuousLayout?.basePosition, { x: 150, y: 275 });
        assert.ok(focusTree?.continuousLayout?.sourceRange);
        assert.ok(focusTree?.continuousLayout?.x);
        assert.ok(focusTree?.continuousLayout?.y);
    });

    it('keeps continuous focus coordinates undefined when the tree does not define continuous_focus_position', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const [tree] = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = no_continuous_tree
                    focus = {
                        id = ROOT
                        x = 0
                        y = 0
                    }
                }
            `),
            [],
            'common/national_focus/no-continuous-tree.txt',
        );

        assert.ok(tree);
        assert.strictEqual(tree.continuousFocusPositionX, undefined);
        assert.strictEqual(tree.continuousFocusPositionY, undefined);
    });

    it('collects Conditions options from conditional icons and allow_branch triggers', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const [tree] = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = condition_tree
                    focus = {
                        id = ROOT
                        x = 0
                        y = 0
                        allow_branch = { has_global_flag = BRANCH_FLAG }
                        icon = {
                            trigger = { has_war = no }
                            value = GFX_focus_generic_construct_civ_factory
                        }
                        offset = {
                            x = 1
                            y = 0
                            trigger = { owns_state = 977 }
                        }
                    }
                }
            `),
            [],
            'common/national_focus/condition-tree.txt',
        );

        assert.ok(tree);
        assert.deepStrictEqual(tree.conditionExprs, [
            {
                scopeName: '',
                nodeContent: 'has_war = no',
            },
            {
                scopeName: '',
                nodeContent: 'has_global_flag = BRANCH_FLAG',
            },
        ]);
    });

    it('parses alternate, conditional-map, and overlay focus artwork', () => {
        const { getFocusTree } = loadFocusTreeSchema();
        const [tree] = getFocusTree(
            parseHoi4File(`
                focus_tree = {
                    id = artwork_tree
                    focus = {
                        id = ROOT
                        x = 0
                        y = 0
                        icon = GFX_focus_primary
                        icon = {
                            trigger = { has_war = yes }
                            value = GFX_focus_conditional
                        }
                        icon = {
                            GFX_focus_map = { has_country_flag = custom_icon }
                        }
                        alternate_icon = GFX_focus_alternate
                        overlay = GFX_focus_overlay
                    }
                }
            `),
            [],
            'common/national_focus/artwork-tree.txt',
        );

        const focus = tree?.focuses.ROOT;
        assert.ok(focus);
        assert.deepStrictEqual(focus.icon.map(icon => icon.icon), [
            'GFX_focus_alternate',
            'GFX_focus_primary',
            'GFX_focus_conditional',
            'GFX_focus_map',
        ]);
        assert.deepStrictEqual(tree.conditionExprs.map(condition => condition.nodeContent), [
            'has_war = yes',
            'has_country_flag = custom_icon',
            'Show alternate icon',
        ]);
        assert.notStrictEqual(focus.icon[0].condition, true);
        assert.notStrictEqual(focus.icon[2].condition, true);
        assert.notStrictEqual(focus.icon[3].condition, true);
        assert.strictEqual(focus.overlay, 'GFX_focus_overlay');
    });
});

function purgeFocusTreeSchemaModules(): void {
    for (const modulePath of [
        '../../src/previewdef/focustree/schema',
        '../../src/previewdef/focustree/focustreeschemahelpers',
        '../../src/previewdef/focustree/focustreeschematypes',
        '../../src/previewdef/focustree/focuslint',
        '../../src/util/featureflags',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

function loadFocusTreeSchema(): typeof import('../../src/previewdef/focustree/schema') {
    nodeModule._load = mockLoad;
    purgeFocusTreeSchemaModules();
    return require('../../src/previewdef/focustree/schema') as typeof import('../../src/previewdef/focustree/schema');
}
