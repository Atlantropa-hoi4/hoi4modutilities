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
const { buildFocusPositionTextChanges, buildFocusLinkTextChanges, buildCreateFocusTemplateTextChanges, applyTextChanges } = require('../../src/previewdef/focustree/positioneditservice') as typeof import('../../src/previewdef/focustree/positioneditservice');
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

    it('does not duplicate an existing parent link when the child is already linked', () => {
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
        const result = buildFocusLinkTextChanges(content, 'ROOT', 'CHILD');

        assert.ifError(result.error);
        assert.strictEqual(result.changes?.length ?? 0, 0);
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

        assert.match(updated, /id = ROOT[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID[\s\S]*?log = "\[GetLogRoot\]: Focus Completed MEO_FOCUS_ID"[\s\S]*?\n    \}\n\}/);
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

        assert.match(updated, /shared_focus = \{[\s\S]*?id = SHARED_ROOT[\s\S]*?\}\n\nshared_focus = \{[\s\S]*?id = TAG_FOCUS_ID[\s\S]*?icon = GFX[\s\S]*?cost = 1[\s\S]*?x = 7[\s\S]*?y = 8[\s\S]*?completion_reward = \{[\s\S]*?log = "\[GetLogRoot\]: Focus Completed TAG_FOCUS_ID"[\s\S]*?\}\n\}\n\njoint_focus = \{/);
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

        assert.match(twiceUpdated, /id = ROOT[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID[\s\S]*?\n    \}\n\n    focus = \{[\s\S]*?id = MEO_FOCUS_ID_2[\s\S]*?x = 7[\s\S]*?y = 8/);
        assert.match(twiceUpdated, /log = "\[GetLogRoot\]: Focus Completed MEO_FOCUS_ID_2"/);
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
});
