import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { readFixture } from '../testUtils';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { convertFocusFileNodeToJson, extractFocusIds, getFocusTree, getFocusTreeWithFocusFile } = require('../../src/previewdef/focustree/schema') as typeof import('../../src/previewdef/focustree/schema');

describe('focus tree schema fixtures', () => {
    it('extracts shared, joint, and national focus ids for indexing', () => {
        const ids = extractFocusIds(parseHoi4File(readFixture('focus', 'modern-focuses.txt')));

        assert.deepStrictEqual(ids, ['ROOT_FOCUS', 'SHARED_ROOT', 'JOINT_ALPHA']);
    });

    it('creates separate joint focus trees and links them from focus_tree shared_focus references', () => {
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
});
