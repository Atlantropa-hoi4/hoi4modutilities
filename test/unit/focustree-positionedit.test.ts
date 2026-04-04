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

const { getFocusTree } = require('../../src/previewdef/focustree/schema') as typeof import('../../src/previewdef/focustree/schema');
const { buildFocusPositionTextChanges, buildContinuousFocusPositionTextChanges, buildFocusLinkTextChanges, buildFocusExclusiveLinkTextChanges, buildCreateFocusTemplateTextChanges, buildDeleteFocusTextChanges, applyTextChanges } = require('../../src/previewdef/focustree/positioneditservice') as typeof import('../../src/previewdef/focustree/positioneditservice');
const { getFocusPosition, getLocalPositionFromRenderedAbsolute } = require('../../src/previewdef/focustree/positioning') as typeof import('../../src/previewdef/focustree/positioning');

describe('focus tree position edit helpers', () => {
    it('replaces existing x and y values for a focus block', () => {
        const content = readFixture('focus', 'layout-edit.txt');
        const result = buildFocusPositionTextChanges(content, 'ROOT', 12, 34);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = ROOT[\s\S]*?x = 12[\s\S]*?y = 34/);
        assert.match(updated, /offset = \{[\s\S]*?x = 3[\s\S]*?y = 4/);
    });

    it('inserts missing x and y before the first offset block', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        offset = {
            x = 3
            y = 4
        }
    }
}`;
        const result = buildFocusPositionTextChanges(content, 'ROOT', 7, 8);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = ROOT[\s\S]*?x = 7[\s\S]*?y = 8[\s\S]*?offset = \{/);
    });

    it('preserves parser offsets when the source file starts with a BOM', () => {
        const content = '\uFEFFfocus_tree = {\n    focus = {\n        id = ROOT\n        x = 1\n        y = 2\n    }\n}';
        const result = buildFocusPositionTextChanges(content, 'ROOT', 9, 10);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /^\uFEFFfocus_tree = \{/);
        assert.match(updated, /id = ROOT[\s\S]*?x = 9[\s\S]*?y = 10/);
    });

    it('replaces an existing continuous_focus_position block in the current focus tree', () => {
        const content = readFixture('focus', 'layout-edit.txt');
        const result = buildContinuousFocusPositionTextChanges(
            content,
            'common/national_focus/layout-edit.txt',
            'focus-tree:common/national_focus/layout-edit.txt:focus:0',
            222,
            333,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /continuous_focus_position = \{[\s\S]*?x = 222[\s\S]*?y = 333/);
    });

    it('inserts a missing continuous_focus_position block inside the focus tree', () => {
        const content = `focus_tree = {
    id = TREE
    focus = {
        id = ROOT
        x = 1
        y = 2
    }
}`;
        const result = buildContinuousFocusPositionTextChanges(
            content,
            'common/national_focus/no-continuous.txt',
            'focus-tree:common/national_focus/no-continuous.txt:focus:0',
            120,
            340,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /focus = \{[\s\S]*?y = 2[\s\S]*?\}\n\s*continuous_focus_position = \{[\s\S]*?x = 120[\s\S]*?y = 340[\s\S]*?\}\n\}/);
    });

    it('preserves parser offsets when inserting continuous_focus_position into a BOM file', () => {
        const content = '\uFEFFfocus_tree = {\n    id = TREE\n}';
        const result = buildContinuousFocusPositionTextChanges(
            content,
            'common/national_focus/bom-continuous.txt',
            'focus-tree:common/national_focus/bom-continuous.txt:focus:0',
            50,
            1000,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /^\uFEFFfocus_tree = \{/);
        assert.match(updated, /continuous_focus_position = \{[\s\S]*?x = 50[\s\S]*?y = 1000/);
    });

    it('rejects continuous position edits for non-focus-tree edit keys', () => {
        const content = `shared_focus = {
    id = SHARED
    x = 1
    y = 2
}`;
        const result = buildContinuousFocusPositionTextChanges(
            content,
            'common/national_focus/shared.txt',
            'focus-tree:common/national_focus/shared.txt:shared:top-level',
            1,
            2,
        );

        assert.match(result.error ?? '', /not editable/i);
    });

    it('derives the local x and y from rendered absolute drop positions', () => {
        const trees = getFocusTree(
            parseHoi4File(readFixture('focus', 'layout-edit.txt')),
            [],
            'common/national_focus/layout-edit.txt',
        );
        const focusTree = trees.find(tree => tree.kind === 'focus');
        const child = focusTree?.focuses.CHILD;

        assert.ok(focusTree);
        assert.ok(child);

        const exprs = [{ scopeName: '', nodeContent: 'has_government = democratic' }];
        const renderedPosition = getFocusPosition(child, {}, focusTree!, exprs);
        assert.deepStrictEqual(renderedPosition, { x: 9, y: 12 });

        const localPosition = getLocalPositionFromRenderedAbsolute(child!, focusTree!, exprs, { x: 20, y: 30 });
        assert.deepStrictEqual(localPosition, { x: 16, y: 24 });
    });

    it('applies unconditional offsets in both rendered and inverse position calculations', () => {
        const trees = getFocusTree(
            parseHoi4File(`focus_tree = {
    focus = {
        id = ROOT
        x = 1
        y = 2
        offset = {
            x = 3
            y = 4
        }
    }
}`),
            [],
            'common/national_focus/unconditional-offset.txt',
        );
        const focusTree = trees.find(tree => tree.kind === 'focus');
        const root = focusTree?.focuses.ROOT;

        assert.ok(focusTree);
        assert.ok(root);

        const renderedPosition = getFocusPosition(root!, {}, focusTree!, []);
        assert.deepStrictEqual(renderedPosition, { x: 4, y: 6 });

        const localPosition = getLocalPositionFromRenderedAbsolute(root!, focusTree!, [], { x: 10, y: 20 });
        assert.deepStrictEqual(localPosition, { x: 7, y: 16 });
    });

    it('inserts prerequisite and relative_position_id for a newly linked child focus while updating local x and y', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = CHILD
        x = 4
        y = 5
    }
}`;
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD', 9, 11);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = CHILD[\s\S]*?prerequisite = \{ focus = ROOT \}[\s\S]*?relative_position_id = ROOT[\s\S]*?x = 9[\s\S]*?y = 11/);
    });

    it('adds a new prerequisite while replacing an existing relative_position_id target and local coordinates', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = OLD_PARENT
        x = 1
        y = 1
    }
    focus = {
        id = CHILD
        prerequisite = { focus = OLD_PARENT }
        relative_position_id = OLD_PARENT
        x = 4
        y = 5
    }
}`;
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD', 7, 8);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = CHILD[\s\S]*?prerequisite = \{ focus = OLD_PARENT \}[\s\S]*?prerequisite = \{ focus = ROOT \}[\s\S]*?relative_position_id = ROOT[\s\S]*?x = 7[\s\S]*?y = 8/);
    });

    it('toggles an existing parent link off while updating local coordinates for the unlinked child', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = CHILD
        prerequisite = { focus = ROOT }
        relative_position_id = ROOT
        x = 4
        y = 5
    }
}`;
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD', 11, 13);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /prerequisite = \{ focus = ROOT \}/);
        assert.doesNotMatch(updated, /relative_position_id = ROOT/);
        assert.match(updated, /id = CHILD[\s\S]*?x = 11[\s\S]*?y = 13/);
    });

    it('writes multi-selected parent links into a single prerequisite block while keeping one anchor relative_position_id', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = OTHER
        x = 1
        y = 1
    }
    focus = {
        id = CHILD
        x = 4
        y = 5
    }
}`;
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD', 9, 11, ['ROOT', 'OTHER']);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(
            updated,
            /id = CHILD[\s\S]*?prerequisite = \{\s*\n\s*focus = ROOT\s*\n\s*focus = OTHER\s*\n\s*\}[\s\S]*?relative_position_id = ROOT[\s\S]*?x = 9[\s\S]*?y = 11/,
        );
        assert.strictEqual((updated.match(/prerequisite = \{/g) ?? []).length, 1);
    });

    it('toggles an exact multi-parent prerequisite block off when the same grouped link is applied again', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = OTHER
        x = 1
        y = 1
    }
    focus = {
        id = CHILD
        prerequisite = {
            focus = ROOT
            focus = OTHER
        }
        relative_position_id = ROOT
        x = 4
        y = 5
    }
}`;
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD', 12, 14, ['ROOT', 'OTHER']);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /focus = ROOT/);
        assert.doesNotMatch(updated, /focus = OTHER/);
        assert.doesNotMatch(updated, /relative_position_id = ROOT/);
        assert.match(updated, /id = CHILD[\s\S]*?x = 12[\s\S]*?y = 14/);
    });

    it('rejects invalid link requests such as self-links or non-local child focuses', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
}`;
        const selfLink = buildFocusLinkTextChanges(content, 'ROOT', 'ROOT');
        const importedChild = buildFocusLinkTextChanges(content, 'ROOT', 'IMPORTED_CHILD');

        assert.match(selfLink.error ?? '', /cannot be linked to itself/i);
        assert.match(importedChild.error ?? '', /not editable/);
    });

    it('adds a mutually exclusive link to both editable focuses', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
    focus = {
        id = OTHER
        x = 4
        y = 5
    }
}`;
        const result = buildFocusExclusiveLinkTextChanges(content, 'ROOT', 'OTHER');

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = ROOT[\s\S]*?mutually_exclusive = \{ focus = OTHER \}[\s\S]*?x = 0[\s\S]*?y = 0/);
        assert.match(updated, /id = OTHER[\s\S]*?mutually_exclusive = \{ focus = ROOT \}[\s\S]*?x = 4[\s\S]*?y = 5/);
    });

    it('toggles an existing mutually exclusive link off on both focuses when reapplied', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        mutually_exclusive = { focus = OTHER }
        x = 0
        y = 0
    }
    focus = {
        id = OTHER
        mutually_exclusive = { focus = ROOT }
        x = 4
        y = 5
    }
}`;
        const result = buildFocusExclusiveLinkTextChanges(content, 'ROOT', 'OTHER');

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /mutually_exclusive = \{ focus = OTHER \}/);
        assert.doesNotMatch(updated, /mutually_exclusive = \{ focus = ROOT \}/);
        assert.match(updated, /id = ROOT[\s\S]*?x = 0[\s\S]*?y = 0/);
        assert.match(updated, /id = OTHER[\s\S]*?x = 4[\s\S]*?y = 5/);
    });

    it('rejects invalid mutually exclusive link requests such as self-links or non-local sources', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
}`;
        const selfLink = buildFocusExclusiveLinkTextChanges(content, 'ROOT', 'ROOT');
        const importedSource = buildFocusExclusiveLinkTextChanges(content, 'IMPORTED_CHILD', 'ROOT');

        assert.match(selfLink.error ?? '', /cannot be linked to itself/i);
        assert.match(importedSource.error ?? '', /not editable/);
    });

    it('creates the requested full focus template inside the selected local focus tree with a blank line separator and tag-derived prefix', () => {
        const content = `focus_tree = {
    id = TEST_TREE
    country = {
        factor = 0

        modifier = {
            add = 10
            tag = MEO
        }
    }
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
}`;
        const result = buildCreateFocusTemplateTextChanges(
            content,
            'common/national_focus/create-focus.txt',
            'focus-tree:common/national_focus/create-focus.txt:focus:0',
            5,
            6,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /id = ROOT[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID[\s\S]*?icon = GFX[\s\S]*?cost = 1[\s\S]*?x = 5[\s\S]*?y = 6[\s\S]*?completion_reward = \{\s*\n\s*\}\n    \}\n\}/);
    });

    it('creates the requested full shared focus template after the last local shared focus block', () => {
        const content = readFixture('focus', 'modern-focuses.txt');
        const result = buildCreateFocusTemplateTextChanges(
            content,
            'common/national_focus/modern-focuses.txt',
            'focus-tree:common/national_focus/modern-focuses.txt:shared:top-level',
            7,
            8,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.match(updated, /shared_focus = \{[\s\S]*?id = SHARED_ROOT[\s\S]*?\}\r?\n\r?\nshared_focus = \{[\s\S]*?id = TAG_FOCUS_ID[\s\S]*?icon = GFX[\s\S]*?cost = 1[\s\S]*?x = 7[\s\S]*?y = 8[\s\S]*?completion_reward = \{\s*\r?\n\s*\}\r?\n\}\r?\n\r?\njoint_focus = \{/);
    });

    it('returns a placeholder range that still points at the generated tag-based focus id in BOM files', () => {
        const content = '\uFEFFfocus_tree = {\n    id = TEST_TREE\n    country = {\n        modifier = {\n            tag = MEO\n        }\n    }\n}';
        const result = buildCreateFocusTemplateTextChanges(
            content,
            'common/national_focus/bom-create.txt',
            'focus-tree:common/national_focus/bom-create.txt:focus:0',
            2,
            3,
        );

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);
        const placeholder = result.placeholderRange
            ? updated.slice(result.placeholderRange.start, result.placeholderRange.end)
            : undefined;

        assert.strictEqual(placeholder, 'MEO_FOCUS_ID');
        assert.match(updated, /^\uFEFFfocus_tree = \{/);
    });

    it('can create focus templates consecutively without reusing the same placeholder id', () => {
        const content = `focus_tree = {
    id = TEST_TREE
    country = {
        factor = 0

        modifier = {
            add = 10
            tag = MEO
        }
    }
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
}`;
        const first = buildCreateFocusTemplateTextChanges(
            content,
            'common/national_focus/create-focus.txt',
            'focus-tree:common/national_focus/create-focus.txt:focus:0',
            5,
            6,
        );
        assert.ifError(first.error);
        const onceUpdated = applyTextChanges(content, first.changes ?? []);

        const second = buildCreateFocusTemplateTextChanges(
            onceUpdated,
            'common/national_focus/create-focus.txt',
            'focus-tree:common/national_focus/create-focus.txt:focus:0',
            7,
            8,
        );
        assert.ifError(second.error);
        const twiceUpdated = applyTextChanges(onceUpdated, second.changes ?? []);

        assert.match(twiceUpdated, /id = ROOT[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID_2[\s\S]*?x = 7[\s\S]*?y = 8[\s\S]*?completion_reward = \{\s*\n\s*\}\n    \}/);
    });

    it('rejects create requests for imported or unknown tree edit keys', () => {
        const content = `focus_tree = {
    id = TEST_TREE
}`;
        const result = buildCreateFocusTemplateTextChanges(
            content,
            'common/national_focus/create-focus.txt',
            'focus-tree:common/national_focus/other-file.txt:focus:0',
            1,
            1,
        );

        assert.match(result.error ?? '', /not editable/);
    });

    it('deletes a focus block and removes dependent prerequisite, mutually exclusive, and relative_position_id references from local children', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }

    focus = {
        id = CHILD
        prerequisite = { focus = ROOT }
        mutually_exclusive = { focus = ROOT }
        relative_position_id = ROOT
        x = 2
        y = 3
    }
}`;
        const result = buildDeleteFocusTextChanges(content, 'ROOT');

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /id = ROOT/);
        assert.doesNotMatch(updated, /focus = ROOT/);
        assert.doesNotMatch(updated, /relative_position_id = ROOT/);
        assert.match(updated, /id = CHILD[\s\S]*?x = 2[\s\S]*?y = 3/);
    });

    it('removes deleted focus ids from multi-focus prerequisite blocks while preserving the remaining dependency structure', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }

    focus = {
        id = CHILD
        prerequisite = {
            OR = {
                focus = ROOT
                focus = OTHER
            }
        }
        prerequisite = {
            focus = ROOT
            focus = SECOND
        }
        x = 2
        y = 3
    }
}`;
        const result = buildDeleteFocusTextChanges(content, 'ROOT');

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /focus = ROOT/);
        assert.match(updated, /prerequisite = \{[\s\S]*?OR = \{[\s\S]*?focus = OTHER[\s\S]*?\}/);
        assert.match(updated, /prerequisite = \{[\s\S]*?focus = SECOND[\s\S]*?\}/);
    });

    it('deletes a selected group of focuses in one operation and removes their references from remaining local focuses', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }

    focus = {
        id = OTHER
        x = 1
        y = 1
    }

    focus = {
        id = CHILD
        prerequisite = {
            focus = ROOT
            focus = OTHER
        }
        mutually_exclusive = { focus = ROOT }
        relative_position_id = ROOT
        x = 2
        y = 3
    }
}`;
        const result = buildDeleteFocusTextChanges(content, ['ROOT', 'OTHER']);

        assert.ifError(result.error);
        const updated = applyTextChanges(content, result.changes ?? []);

        assert.doesNotMatch(updated, /id = ROOT/);
        assert.doesNotMatch(updated, /id = OTHER/);
        assert.doesNotMatch(updated, /focus = ROOT/);
        assert.doesNotMatch(updated, /focus = OTHER/);
        assert.doesNotMatch(updated, /relative_position_id = ROOT/);
        assert.match(updated, /id = CHILD[\s\S]*?x = 2[\s\S]*?y = 3/);
    });

    it('rejects deleting imported or unknown focuses', () => {
        const content = `focus_tree = {
    focus = {
        id = ROOT
        x = 0
        y = 0
    }
}`;
        const result = buildDeleteFocusTextChanges(content, 'IMPORTED_CHILD');

        assert.match(result.error ?? '', /not editable/);
    });
});
