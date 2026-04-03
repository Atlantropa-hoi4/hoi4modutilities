import * as assert from 'assert';
import {
    applyDraggedLayoutPosition,
    calculateDraggedLayoutPosition,
    findOffsetDraftByKey,
    LayoutTargetDescriptor,
} from '../../src/previewdef/focustree/layouteditdrag';

describe('focus layout drag helpers', () => {
    it('finds the matching offset draft by edit key across focus drafts', () => {
        const draft = {
            baseVersion: 1,
            focuses: {
                'focus:file:ROOT': {
                    kind: 'focus' as const,
                    editKey: 'focus:file:ROOT',
                    focusId: 'ROOT',
                    editable: true,
                    sourceFile: 'file',
                    x: 1,
                    y: 2,
                    relativePositionId: null,
                    offsets: [
                        {
                            editKey: 'offset:file:1',
                            x: 3,
                            y: 4,
                            hasTrigger: true,
                        },
                    ],
                },
                'focus:file:CHILD': {
                    kind: 'focus' as const,
                    editKey: 'focus:file:CHILD',
                    focusId: 'CHILD',
                    editable: true,
                    sourceFile: 'file',
                    x: 5,
                    y: 6,
                    relativePositionId: null,
                    offsets: [
                        {
                            editKey: 'offset:file:2',
                            x: 7,
                            y: 8,
                            hasTrigger: true,
                        },
                    ],
                },
            },
            continuous: {},
            inlayRefs: {},
        };

        const resolved = findOffsetDraftByKey(draft, 'offset:file:2');

        assert.ok(resolved);
        assert.strictEqual(resolved?.focusEditKey, 'focus:file:CHILD');
        assert.strictEqual(resolved?.offsetDraft.x, 7);
        assert.strictEqual(resolved?.offsetDraft.y, 8);
    });

    it('uses grid drag math for offset targets and mutates only the matching offset draft', () => {
        const draft = {
            baseVersion: 1,
            focuses: {
                'focus:file:ROOT': {
                    kind: 'focus' as const,
                    editKey: 'focus:file:ROOT',
                    focusId: 'ROOT',
                    editable: true,
                    sourceFile: 'file',
                    x: 1,
                    y: 2,
                    relativePositionId: null,
                    offsets: [
                        {
                            editKey: 'offset:file:1',
                            x: 3,
                            y: 4,
                            hasTrigger: true,
                        },
                    ],
                },
                'focus:file:CHILD': {
                    kind: 'focus' as const,
                    editKey: 'focus:file:CHILD',
                    focusId: 'CHILD',
                    editable: true,
                    sourceFile: 'file',
                    x: 5,
                    y: 6,
                    relativePositionId: null,
                    offsets: [
                        {
                            editKey: 'offset:file:2',
                            x: 7,
                            y: 8,
                            hasTrigger: true,
                        },
                    ],
                },
            },
            continuous: {},
            inlayRefs: {},
        };
        const target: LayoutTargetDescriptor = {
            key: 'offset:file:2',
            kind: 'offset',
            label: 'CHILD offset',
            editable: true,
            sourceFile: 'file',
            currentPosition: { x: 7, y: 8 },
            focusId: 'CHILD',
        };

        const nextPosition = calculateDraggedLayoutPosition(target, 192, -130, {
            scale: 1,
            xGridSize: 96,
            yGridSize: 130,
        });
        const changed = applyDraggedLayoutPosition(draft, target, nextPosition);

        assert.deepStrictEqual(nextPosition, { x: 9, y: 7 });
        assert.strictEqual(changed, true);
        assert.deepStrictEqual(draft.focuses['focus:file:ROOT'].offsets[0], {
            editKey: 'offset:file:1',
            x: 3,
            y: 4,
            hasTrigger: true,
        });
        assert.deepStrictEqual(draft.focuses['focus:file:CHILD'].offsets[0], {
            editKey: 'offset:file:2',
            x: 9,
            y: 7,
            hasTrigger: true,
        });
    });
});
