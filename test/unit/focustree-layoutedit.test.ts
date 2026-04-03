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
const { applyTextChanges, buildFocusLayoutTextChanges } = require('../../src/previewdef/focustree/layouteditservice') as typeof import('../../src/previewdef/focustree/layouteditservice');

describe('focus layout edit service', () => {
    it('updates focus, continuous focus, and inlay layout fields with minimal patches', () => {
        const filePath = 'common/national_focus/layout-edit.txt';
        const content = readFixture('focus', 'layout-edit.txt');
        const trees = getFocusTree(parseHoi4File(content), [], filePath);
        const tree = trees.find(tree => tree.kind === 'focus');

        assert.ok(tree);

        const root = tree?.focuses.ROOT;
        const child = tree?.focuses.CHILD;
        const inserted = tree?.focuses.INSERTED;
        const inlayRef = tree?.inlayWindowRefs[0];

        assert.ok(root?.layout);
        assert.ok(child?.layout);
        assert.ok(inserted?.layout);
        assert.ok(tree?.continuousFocusLayout);
        assert.ok(inlayRef?.layout);

        const draft = {
            baseVersion: 1,
            focuses: {
                [root!.layout!.editKey]: {
                    kind: 'focus' as const,
                    editKey: root!.layout!.editKey,
                    focusId: root!.id,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: root!.layout!.sourceRange,
                    x: 4,
                    y: 5,
                    relativePositionId: null,
                    offsets: [
                        {
                            editKey: root!.layout!.offsets[0].editKey,
                            x: 11,
                            y: 12,
                            hasTrigger: true,
                        },
                        {
                            editKey: `offset:new:${root!.layout!.editKey}:1`,
                            x: -1,
                            y: 2,
                            hasTrigger: false,
                            isNew: true,
                        },
                    ],
                },
                [child!.layout!.editKey]: {
                    kind: 'focus' as const,
                    editKey: child!.layout!.editKey,
                    focusId: child!.id,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: child!.layout!.sourceRange,
                    x: 9,
                    y: 10,
                    relativePositionId: null,
                    offsets: [],
                },
                [inserted!.layout!.editKey]: {
                    kind: 'focus' as const,
                    editKey: inserted!.layout!.editKey,
                    focusId: inserted!.id,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: inserted!.layout!.sourceRange,
                    x: 7,
                    y: 8,
                    relativePositionId: 'ROOT',
                    offsets: [],
                },
            },
            continuous: {
                [tree!.continuousFocusLayout!.editKey]: {
                    kind: 'continuous' as const,
                    editKey: tree!.continuousFocusLayout!.editKey,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: tree!.continuousFocusLayout!.sourceRange,
                    x: 600,
                    y: 700,
                    label: tree!.continuousFocusLayout!.label,
                },
            },
            inlayRefs: {
                [inlayRef!.layout!.editKey]: {
                    kind: 'inlayRef' as const,
                    editKey: inlayRef!.layout!.editKey,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: inlayRef!.layout!.sourceRange,
                    x: 123,
                    y: 456,
                    label: inlayRef!.layout!.label,
                },
            },
        };

        const updated = applyTextChanges(content, buildFocusLayoutTextChanges(content, filePath, draft));
        const childBlock = /focus = \{\r?\n\s*id = CHILD[\s\S]*?\r?\n\s*\}/.exec(updated)?.[0] ?? '';
        const insertedBlock = /focus = \{\r?\n\s*id = INSERTED[\s\S]*?\r?\n\s*\}/.exec(updated)?.[0] ?? '';

        assert.match(updated, /id = ROOT[\s\S]*?x = 4[\s\S]*?y = 5/);
        assert.match(updated, /offset = \{[\s\S]*?x = 11[\s\S]*?y = 12[\s\S]*?trigger = \{/);
        assert.match(updated, /offset = \{\r?\n\s*x = -1\r?\n\s*y = 2\r?\n\s*\}/);
        assert.match(childBlock, /id = CHILD[\s\S]*?x = 9[\s\S]*?y = 10/);
        assert.doesNotMatch(childBlock, /relative_position_id = ROOT/);
        assert.match(insertedBlock, /id = INSERTED[\s\S]*?x = 7[\s\S]*?y = 8[\s\S]*?relative_position_id = ROOT/);
        assert.match(updated, /continuous_focus_position = \{[\s\S]*?x = 600[\s\S]*?y = 700/);
        assert.match(updated, /inlay_window = \{[\s\S]*?position = \{[\s\S]*?x = 123[\s\S]*?y = 456/);
    });

    it('patches only the targeted offset block for an offset-only draft change', () => {
        const filePath = 'common/national_focus/layout-edit.txt';
        const content = readFixture('focus', 'layout-edit.txt');
        const trees = getFocusTree(parseHoi4File(content), [], filePath);
        const tree = trees.find(tree => tree.kind === 'focus');
        const root = tree?.focuses.ROOT;

        assert.ok(root?.layout);
        assert.ok(root.layout.offsets[0]);

        const draft = {
            baseVersion: 1,
            focuses: {
                [root.layout.editKey]: {
                    kind: 'focus' as const,
                    editKey: root.layout.editKey,
                    focusId: root.id,
                    editable: true,
                    sourceFile: filePath,
                    sourceRange: root.layout.sourceRange,
                    x: root.layout.basePosition.x,
                    y: root.layout.basePosition.y,
                    relativePositionId: root.layout.relativePositionId ?? null,
                    offsets: [
                        {
                            editKey: root.layout.offsets[0].editKey,
                            x: 13,
                            y: 14,
                            hasTrigger: true,
                        },
                    ],
                },
            },
            continuous: {},
            inlayRefs: {},
        };

        const updated = applyTextChanges(content, buildFocusLayoutTextChanges(content, filePath, draft));
        const rootBlock = /focus = \{\r?\n\s*id = ROOT[\s\S]*?\r?\n\s*\}/.exec(updated)?.[0] ?? '';

        assert.match(rootBlock, /id = ROOT[\s\S]*?x = 1[\s\S]*?y = 2/);
        assert.match(rootBlock, /offset = \{[\s\S]*?x = 13[\s\S]*?y = 14[\s\S]*?trigger = \{/);
        assert.doesNotMatch(updated, /continuous_focus_position = \{[\s\S]*?x = 600/);
        assert.doesNotMatch(updated, /inlay_window = \{[\s\S]*?position = \{[\s\S]*?x = 123/);
    });
});
