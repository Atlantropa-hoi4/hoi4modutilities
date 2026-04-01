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

const { convertFocusFileNodeToJson, extractFocusIds, getFocusTreeWithFocusFile } = require('../../src/previewdef/focustree/schema') as typeof import('../../src/previewdef/focustree/schema');

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
});
