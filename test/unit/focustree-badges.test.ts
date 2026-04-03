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
const { evaluateFocusBadgeState } = require('../../src/previewdef/focustree/focusbadges') as typeof import('../../src/previewdef/focustree/focusbadges');

describe('focus tree status badge helpers', () => {
    const trees = getFocusTree(parseHoi4File(`
        focus_tree = {
            id = badge_tree
            focus = {
                id = ROOT
                x = 0
                y = 0
            }
            focus = {
                id = PREREQ_A
                x = 1
                y = 0
            }
            focus = {
                id = PREREQ_B
                x = 2
                y = 0
            }
            focus = {
                id = EXCLUSIVE_A
                x = 3
                y = 0
            }
            focus = {
                id = EXCLUSIVE_B
                x = 4
                y = 0
            }
            focus = {
                id = BADGED
                x = 5
                y = 1
                available = {
                    has_country_flag = badge_flag
                }
                available_if_capitulated = yes
                ai_will_do = {
                    factor = 1
                }
                completion_reward = {
                    add_political_power = 10
                }
                prerequisite = {
                    focus = PREREQ_A
                    focus = PREREQ_B
                }
                mutually_exclusive = {
                    focus = EXCLUSIVE_A
                    focus = EXCLUSIVE_B
                }
                allow_branch = {
                    always = yes
                }
            }
        }
    `), [], 'common/national_focus/badges.txt');
    const focusTree = trees.find(tree => tree.kind === 'focus');
    const badgedFocus = focusTree?.focuses.BADGED;

    it('parses badge-related focus metadata from schema', () => {
        assert.ok(badgedFocus);
        assert.ok(badgedFocus?.available);
        assert.strictEqual(badgedFocus?.availableIfCapitulated, true);
        assert.strictEqual(badgedFocus?.hasAiWillDo, true);
        assert.strictEqual(badgedFocus?.hasCompletionReward, true);
        assert.strictEqual(badgedFocus?.prerequisiteGroupCount, 1);
        assert.strictEqual(badgedFocus?.prerequisiteFocusCount, 2);
        assert.strictEqual(badgedFocus?.exclusiveCount, 2);
        assert.strictEqual(badgedFocus?.hasAllowBranch, true);
    });

    it('evaluates available and blocked badge state from current expressions', () => {
        assert.ok(badgedFocus);

        const blockedState = evaluateFocusBadgeState(badgedFocus!, [], { enableAvailability: true });
        assert.strictEqual(blockedState.showAvailability, true);
        assert.strictEqual(blockedState.isAvailable, false);

        const availableState = evaluateFocusBadgeState(
            badgedFocus!,
            [{ scopeName: '', nodeContent: 'has_country_flag = badge_flag' }],
            { enableAvailability: true },
        );
        assert.strictEqual(availableState.isAvailable, true);
    });

    it('disables availability badge evaluation when condition mode is off', () => {
        assert.ok(badgedFocus);

        const state = evaluateFocusBadgeState(badgedFocus!, [], { enableAvailability: false });
        assert.strictEqual(state.showAvailability, false);
        assert.strictEqual(state.isAvailable, true);
        assert.strictEqual(state.prerequisiteFocusCount, 2);
        assert.strictEqual(state.exclusiveCount, 2);
    });
});
