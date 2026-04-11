import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';

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

const { getFocusTree } = require('../../src/previewdef/focustree/schema') as typeof import('../../src/previewdef/focustree/schema');

describe('focus tree structural lint', () => {
    it('detects asymmetric mutually exclusive links and aggregates lint counts on both focuses', () => {
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                focus = {
                    id = FOCUS_A
                    x = 0
                    y = 0
                    mutually_exclusive = { focus = FOCUS_B }
                }
                focus = {
                    id = FOCUS_B
                    x = 1
                    y = 0
                }
            }
        `), [], 'common/national_focus/test.txt');

        assert.ok(tree);
        const warning = tree.warnings.find((entry: any) => entry.code === 'exclusive-asymmetric');
        assert.ok(warning);
        assert.strictEqual(warning?.kind, 'lint');
        assert.deepStrictEqual(warning?.relatedFocusIds, ['FOCUS_A', 'FOCUS_B']);
        assert.strictEqual(tree.focuses.FOCUS_A.lintWarningCount, 1);
        assert.strictEqual(tree.focuses.FOCUS_B.lintWarningCount, 1);
    });

    it('detects relative position id without matching prerequisite', () => {
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                focus = {
                    id = ROOT
                    x = 0
                    y = 0
                }
                focus = {
                    id = CHILD
                    x = 1
                    y = 1
                    relative_position_id = ROOT
                }
            }
        `), [], 'common/national_focus/test.txt');

        assert.ok(tree.warnings.some((entry: any) => entry.code === 'relative-position-prerequisite-mismatch'));
        assert.ok(tree.focuses.CHILD.lintMessages?.some(message => message.includes('relative_position_id ROOT')));
    });

    it('detects missing prerequisite and mutually exclusive targets', () => {
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                focus = {
                    id = BROKEN
                    x = 0
                    y = 0
                    prerequisite = { focus = MISSING_PARENT }
                    mutually_exclusive = { focus = MISSING_EXCLUSIVE }
                }
            }
        `), [], 'common/national_focus/test.txt');

        assert.ok(tree.warnings.some((entry: any) => entry.code === 'missing-prerequisite-target'));
        assert.ok(tree.warnings.some((entry: any) => entry.code === 'missing-exclusive-target'));
    });

    it('marks prerequisite cycles without roots as candidate unreachable info', () => {
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                focus = {
                    id = LOOP_A
                    x = 0
                    y = 0
                    prerequisite = { focus = LOOP_B }
                }
                focus = {
                    id = LOOP_B
                    x = 1
                    y = 0
                    prerequisite = { focus = LOOP_A }
                }
            }
        `), [], 'common/national_focus/test.txt');

        const warnings = tree.warnings.filter((entry: any) => entry.code === 'focus-unreachable-candidate');
        assert.strictEqual(warnings.length, 2);
        assert.ok(warnings.every((entry: any) => entry.severity === 'info'));
        assert.strictEqual(tree.focuses.LOOP_A.lintInfoCount, 1);
        assert.strictEqual(tree.focuses.LOOP_B.lintInfoCount, 1);
    });

    it('does not flag imported shared targets as missing references', () => {
        const sharedTrees = getFocusTree(parseHoi4File(`
            shared_focus = {
                id = SHARED_ROOT
                x = 0
                y = 0
            }
        `), [], 'common/national_focus/shared.txt');

        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                shared_focus = SHARED_ROOT
                focus = {
                    id = LOCAL_CHILD
                    x = 1
                    y = 1
                    prerequisite = { focus = SHARED_ROOT }
                    mutually_exclusive = { focus = SHARED_ROOT }
                }
            }
        `), sharedTrees, 'common/national_focus/test.txt');

        assert.ok(!tree.warnings.some((entry: any) =>
            entry.code === 'missing-prerequisite-target' || entry.code === 'missing-exclusive-target'));
    });

    it('orders lint warnings before parse warnings', () => {
        const [tree] = getFocusTree(parseHoi4File(`
            focus_tree = {
                id = test_tree
                focus = {
                    x = 0
                    y = 0
                    mutually_exclusive = { focus = MISSING_EXCLUSIVE }
                }
                focus = {
                    id = STABLE_FOCUS
                    x = 1
                    y = 0
                }
            }
        `), [], 'common/national_focus/test.txt');

        assert.ok(tree.warnings.length >= 2);
        assert.strictEqual(tree.warnings[0].kind, 'lint');
        assert.strictEqual(tree.warnings[0].code, 'missing-exclusive-target');
        assert.strictEqual(tree.warnings.some((entry: any) => entry.code === 'focus-missing-id'), true);
    });
});
