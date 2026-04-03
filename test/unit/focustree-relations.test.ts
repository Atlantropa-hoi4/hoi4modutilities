import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { StyleTable } from '../../src/util/styletable';
import { renderGridBoxConnection } from '../../src/util/hoi4gui/gridboxcommon';

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
const { collectFocusRelationVisualizationState } = require('../../src/previewdef/focustree/focusrelations') as typeof import('../../src/previewdef/focustree/focusrelations');

describe('focus tree relation visualization helpers', () => {
    const trees = getFocusTree(parseHoi4File(`
        focus_tree = {
            id = relation_tree
            focus = {
                id = ROOT_A
                x = 0
                y = 0
            }
            focus = {
                id = ROOT_B
                x = 1
                y = 0
            }
            focus = {
                id = EXCLUSIVE_A
                x = 2
                y = 0
            }
            focus = {
                id = EXCLUSIVE_B
                x = 3
                y = 0
            }
            focus = {
                id = CHILD_A
                x = 0
                y = 1
                prerequisite = {
                    focus = ROOT_A
                    focus = ROOT_B
                }
                mutually_exclusive = {
                    focus = EXCLUSIVE_A
                }
            }
            focus = {
                id = CHILD_B
                x = 1
                y = 1
                prerequisite = {
                    focus = ROOT_B
                }
                mutually_exclusive = {
                    focus = EXCLUSIVE_B
                }
            }
        }
    `), [], 'common/national_focus/relations.txt');
    const focusTree = trees.find(tree => tree.kind === 'focus');

    it('collects prerequisite and exclusive unions for multi-select focus visualization', () => {
        assert.ok(focusTree);
        const state = collectFocusRelationVisualizationState(focusTree!, ['CHILD_A', 'CHILD_B']);
        assert.deepStrictEqual(state.activeFocusIds.sort(), ['CHILD_A', 'CHILD_B']);
        assert.deepStrictEqual(state.prerequisiteParentIds.sort(), ['ROOT_A', 'ROOT_B']);
        assert.deepStrictEqual(state.exclusiveFocusIds.sort(), ['EXCLUSIVE_A', 'EXCLUSIVE_B']);
        assert.strictEqual(state.prerequisiteGroupCount, 2);
        assert.strictEqual(state.prerequisiteFocusCount, 2);
        assert.strictEqual(state.exclusiveCount, 2);
        assert.strictEqual(state.hasGroupedPrerequisite, true);
        assert.deepStrictEqual(
            state.relatedFocusIds.sort(),
            ['CHILD_A', 'CHILD_B', 'EXCLUSIVE_A', 'EXCLUSIVE_B', 'ROOT_A', 'ROOT_B'],
        );
    });

    it('renders relation line metadata as DOM attributes for visualization filtering', () => {
        const html = renderGridBoxConnection(
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            '1px dashed rgba(136, 170, 255, 0.5)',
            'parent',
            'up',
            { width: 96, height: 130 },
            {
                target: 'ROOT_A',
                targetType: 'parent',
                relationKind: 'prerequisite',
                sourceFocusId: 'CHILD_A',
                targetFocusId: 'ROOT_A',
                prerequisiteGroupIndex: 0,
                isGroupedPrerequisite: true,
            },
            new StyleTable(),
            0.5,
        );

        assert.ok(html.includes('data-relation-kind="prerequisite"'));
        assert.ok(html.includes('data-source-focus-id="CHILD_A"'));
        assert.ok(html.includes('data-target-focus-id="ROOT_A"'));
        assert.ok(html.includes('data-prerequisite-group-index="0"'));
        assert.ok(html.includes('data-is-grouped-prerequisite="true"'));
        assert.ok(html.includes('focus-relation-line'));
    });
});
