import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import type { MioEditMessage } from '../../src/previewdef/mio/editcommon';

const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = modules._load;
const schemaPath = require.resolve('../../src/previewdef/mio/schema');
delete require.cache[schemaPath];
modules._load = function(request, parent, isMain) {
    if (request === '../../util/i18n' && parent?.filename === schemaPath) {
        return { localize: (_key: string, message: string) => message };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { getMiosFromFile } = require('../../src/previewdef/mio/schema') as typeof import('../../src/previewdef/mio/schema');
const { buildMioTextEdit } = require('../../src/previewdef/mio/editservice') as typeof import('../../src/previewdef/mio/editservice');
modules._load = originalLoad;

const baseMessage = {
    requestId: 'request',
    documentVersion: 1,
    mioId: 'child',
};

function getMio(content: string, id = 'child', dependencies: ReturnType<typeof getMiosFromFile> = []) {
    return getMiosFromFile(parseHoi4File(content.replace(/^\uFEFF/, '')), dependencies, 'common/military_industrial_organization/test.txt')
        .find(mio => mio.id === id)!;
}

function edit(content: string, message: MioEditMessage, dependencies: ReturnType<typeof getMiosFromFile> = []): string {
    const result = buildMioTextEdit(content, message, getMio(content, message.mioId, dependencies));
    assert.ifError(result.error);
    assert.notStrictEqual(result.updatedContent, undefined);
    return result.updatedContent!;
}

describe('MIO preview edit service', () => {
    it('updates nested positions while preserving BOM, CRLF and unrelated comments', () => {
        const content = '\uFEFFchild = {\r\n\ttrait = {\r\n\t\ttoken = local\r\n\t\t# keep me\r\n\t\tposition = { x = 1 y = 2 }\r\n\t}\r\n}\r\n';
        const updated = edit(content, {
            ...baseMessage,
            command: 'applyMioPositionEdits',
            edits: [{ traitId: 'local', x: 3, y: 4, absoluteX: 3, absoluteY: 4 }],
        });
        assert.match(updated, /^\uFEFFchild/);
        assert.match(updated, /# keep me\r\n/);
        assert.match(updated, /position = \{ x = 3 y = 4 \}/);
        assert.strictEqual(updated.replace(/\r\n/g, '').includes('\n'), false);
    });

    it('creates a minimal override when moving an inherited trait', () => {
        const baseContent = 'base = { trait = { token = inherited position = { x = 1 y = 1 } } }';
        const dependencies = getMiosFromFile(parseHoi4File(baseContent), [], 'common/military_industrial_organization/base.txt');
        const content = 'child = {\n    include = base\n}\n';
        const updated = edit(content, {
            ...baseMessage,
            command: 'applyMioPositionEdits',
            edits: [{ traitId: 'inherited', x: 2, y: 3, absoluteX: 2, absoluteY: 3 }],
        }, dependencies);
        assert.match(updated, /override_trait = \{[\s\S]*?token = inherited[\s\S]*?position = \{ x = 2 y = 3 \}/);
    });

    it('inserts overrides safely when the MIO was written on one line', () => {
        const baseContent = 'base = { trait = { token = inherited position = { x = 1 y = 1 } } }';
        const dependencies = getMiosFromFile(parseHoi4File(baseContent), [], 'base.txt');
        const content = 'child = { include = base }';
        const updated = edit(content, {
            ...baseMessage,
            command: 'applyMioPositionEdits',
            edits: [{ traitId: 'inherited', x: 2, y: 2, absoluteX: 2, absoluteY: 2 }],
        }, dependencies);
        assert.doesNotThrow(() => parseHoi4File(updated));
        assert.match(updated, /^child = \{ include = base[\s\S]*override_trait/);
    });

    it('moves a simple parent link between any and all and supports an explicit empty override', () => {
        const content = `child = {
    trait = { token = parent position = { x = 0 y = 0 } }
    trait = { token = child position = { x = 0 y = 1 } any_parent = { parent } }
}`;
        const moved = edit(content, {
            ...baseMessage,
            command: 'toggleMioParentLink',
            parentTraitId: 'parent',
            childTraitId: 'child',
            kind: 'all',
        });
        assert.match(moved, /token = child[\s\S]*?any_parent = \{\s*\}/);
        assert.match(moved, /token = child[\s\S]*?all_parents = \{ parent \}/);

        const removed = edit(moved, {
            ...baseMessage,
            command: 'toggleMioParentLink',
            parentTraitId: 'parent',
            childTraitId: 'child',
            kind: 'all',
        });
        assert.match(removed, /all_parents = \{\s*\}/);
    });

    it('maintains mutually exclusive links symmetrically', () => {
        const content = `child = {
    trait = { token = left position = { x = 0 y = 0 } }
    trait = { token = right position = { x = 1 y = 0 } }
}`;
        const updated = edit(content, {
            ...baseMessage,
            command: 'toggleMioExclusiveLink',
            sourceTraitId: 'left',
            targetTraitId: 'right',
        });
        assert.match(updated, /token = left[\s\S]*?mutually_exclusive = \{ right \}/);
        assert.match(updated, /token = right[\s\S]*?mutually_exclusive = \{ left \}/);
    });

    it('rejects parent links that would create a cycle', () => {
        const content = `child = {
    trait = { token = top position = { x = 0 y = 0 } any_parent = { bottom } }
    trait = { token = bottom position = { x = 0 y = 1 } }
}`;
        const result = buildMioTextEdit(content, {
            ...baseMessage,
            command: 'toggleMioParentLink',
            parentTraitId: 'top',
            childTraitId: 'bottom',
            kind: 'any',
        }, getMio(content));
        assert.match(result.error!, /create a cycle/);
    });

    it('creates trait or add_trait templates with unique placeholders', () => {
        const standalone = 'child = {\n    trait = { token = MIO_TRAIT_ID position = { x = 0 y = 0 } }\n}\n';
        const standaloneResult = buildMioTextEdit(standalone, {
            ...baseMessage,
            command: 'createMioTraitAtPosition',
            x: 2,
            y: 3,
        }, getMio(standalone));
        assert.ifError(standaloneResult.error);
        assert.strictEqual(standaloneResult.createdTraitId, 'MIO_TRAIT_ID_2');
        assert.match(standaloneResult.updatedContent!, /trait = \{[\s\S]*?token = MIO_TRAIT_ID_2[\s\S]*?position = \{ x = 2 y = 3 \}/);

        const baseContent = 'base = { trait = { token = inherited position = { x = 0 y = 0 } } }';
        const dependencies = getMiosFromFile(parseHoi4File(baseContent), [], 'base.txt');
        const included = 'child = {\n    include = base\n}\n';
        const includedResult = buildMioTextEdit(included, {
            ...baseMessage,
            command: 'createMioTraitAtPosition',
            x: 4,
            y: 2,
        }, getMio(included, 'child', dependencies));
        assert.ifError(includedResult.error);
        assert.match(includedResult.updatedContent!, /add_trait = \{/);
    });

    it('deletes local traits and removes inherited traits without touching dependency content', () => {
        const baseContent = 'base = { trait = { token = inherited position = { x = 0 y = 0 } } }';
        const dependencies = getMiosFromFile(parseHoi4File(baseContent), [], 'base.txt');
        const content = `child = {
    include = base
    add_trait = { token = local position = { x = 1 y = 0 } any_parent = { inherited } }
}`;
        const updated = edit(content, {
            ...baseMessage,
            command: 'deleteMioTraits',
            traitIds: ['local', 'inherited'],
        }, dependencies);
        assert.doesNotMatch(updated, /add_trait/);
        assert.match(updated, /remove_trait = \{ inherited \}/);
        assert.strictEqual(baseContent, 'base = { trait = { token = inherited position = { x = 0 y = 0 } } }');
    });

    it('does not remove the containing MIO when deleting an inline trait block', () => {
        const content = 'child = { trait = { token = local position = { x = 1 y = 1 } } icon = GFX_test }';
        const updated = edit(content, {
            ...baseMessage,
            command: 'deleteMioTraits',
            traitIds: ['local'],
        });
        assert.match(updated, /^child = \{/);
        assert.match(updated, /icon = GFX_test/);
        assert.doesNotMatch(updated, /token = local/);
        assert.doesNotThrow(() => parseHoi4File(updated));
    });

    it('preserves absolute positions while clearing relative references to deleted traits', () => {
        const content = `child = {
    trait = { token = root position = { x = 2 y = 3 } }
    trait = { token = local position = { x = 1 y = 2 } relative_position_id = root }
}`;
        const updated = edit(content, {
            ...baseMessage,
            command: 'deleteMioTraits',
            traitIds: ['root'],
        });
        assert.match(updated, /token = local position = \{ x = 3 y = 5 \}/);
        assert.doesNotMatch(updated, /relative_position_id = root/);
    });

    it('creates a minimal override to clear inherited relative references to deleted traits', () => {
        const baseContent = `base = {
    trait = { token = root position = { x = 2 y = 3 } }
    trait = { token = child_trait position = { x = 1 y = 2 } relative_position_id = root }
}`;
        const dependencies = getMiosFromFile(parseHoi4File(baseContent), [], 'base.txt');
        const content = 'child = { include = base }';
        const updated = edit(content, {
            ...baseMessage,
            command: 'deleteMioTraits',
            traitIds: ['root'],
        }, dependencies);
        assert.match(updated, /override_trait = \{[\s\S]*?token = child_trait[\s\S]*?position = \{ x = 3 y = 5 \}[\s\S]*?relative_position_id = ""/);
        assert.match(updated, /remove_trait = \{ root \}/);

        const reparsed = getMio(updated, 'child', dependencies);
        assert.strictEqual(reparsed.traits.child_trait.relativePositionId, undefined);
        assert.deepStrictEqual({ x: reparsed.traits.child_trait.x, y: reparsed.traits.child_trait.y }, { x: 3, y: 5 });
    });

    it('rejects absolute positions outside x 0..9 or above the tree', () => {
        const content = 'child = { trait = { token = local position = { x = 1 y = 1 } } }';
        const result = buildMioTextEdit(content, {
            ...baseMessage,
            command: 'applyMioPositionEdits',
            edits: [{ traitId: 'local', x: 10, y: 1, absoluteX: 10, absoluteY: 1 }],
        }, getMio(content));
        assert.match(result.error!, /outside the editable grid/);
        assert.strictEqual(result.updatedContent, undefined);
    });
});
