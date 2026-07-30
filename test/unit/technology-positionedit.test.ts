import * as assert from 'assert';
import {
    applyTechnologyTextChanges,
    buildCreateChildTechnologyTextChanges,
    buildDeleteTechnologiesTextChanges,
    buildTechnologyPathTextChanges,
    buildTechnologyPositionTextChanges,
    buildTechnologyXorTextChanges,
} from '../../src/previewdef/technology/editservice';
import { collectTechnologyFileMetadata } from '../../src/previewdef/technology/editmetadata';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';

const filePath = 'common/technologies/edit.txt';
const roots = {
    availableTreeRootsByFolder: { infantry: ['root'] },
    gridLayoutsByFolder: {
        infantry: {
            root: {
                format: 'up' as const,
                gridSize: { width: 1000, height: 1000 },
                slotSize: { width: 50, height: 50 },
                positionsByTechnologyId: {
                    root: { x: 0, y: 0 },
                    left: { x: 0, y: 1 },
                    right: { x: 1, y: 1 },
                },
            },
        },
    },
};
const noRoots = { availableTreeRootsByFolder: {}, gridLayoutsByFolder: {} };

describe('technology position edit helpers', () => {
    it('updates only the selected folder and preserves CRLF plus BOM', () => {
        const content = '\uFEFFtechnologies = {\r\n    root = {\r\n        folder = { name = infantry position = { x = 1 y = 2 } }\r\n        folder = { name = armor position = { x = 7 y = 8 } }\r\n    }\r\n}';
        const metadata = collectTechnologyFileMetadata(parseHoi4File(content.slice(1)), filePath, 1);
        const folder = metadata.technologies[0].folders.find(item => item.name === 'infantry')!;
        const result = buildTechnologyPositionTextChanges(content, filePath, 'infantry', [{ technologyId: 'root', editKey: folder.editKey, x: 4, y: 5 }], roots);
        assert.ifError(result.error);
        const updated = applyTechnologyTextChanges(content, result.changes ?? []);
        assert.match(updated, /name = infantry position = \{ x = 4 y = 5 \}/);
        assert.match(updated, /name = armor position = \{ x = 7 y = 8 \}/);
        assert.ok(updated.startsWith('\uFEFFtechnologies = {\r\n'));
    });

    it('inserts a missing position block', () => {
        const content = `technologies = {
    root = {
        folder = {
            name = infantry
        }
    }
}`;
        const metadata = collectTechnologyFileMetadata(parseHoi4File(content), filePath);
        const folder = metadata.technologies[0].folders[0];
        const result = buildTechnologyPositionTextChanges(content, filePath, 'infantry', [{ technologyId: 'root', editKey: folder.editKey, x: 3, y: 6 }], roots);
        assert.ifError(result.error);
        assert.match(applyTechnologyTextChanges(content, result.changes ?? []), /name = infantry\s+position = \{ x = 3 y = 6 \}/);
    });

    it('edits positions that use uniquely defined numeric constants without rewriting unchanged axes', () => {
        const content = `technologies = {
    @year_1936 = 2
    root = {
        folder = { name = infantry position = { x = 1 y = @year_1936 } }
    }
}`;
        const metadata = collectTechnologyFileMetadata(parseHoi4File(content), filePath);
        const folder = metadata.technologies[0].folders[0];
        assert.strictEqual(folder.editable, true);
        assert.deepStrictEqual({ x: folder.xValue, y: folder.yValue }, { x: 1, y: 2 });
        const horizontal = buildTechnologyPositionTextChanges(content, filePath, 'infantry', [{
            technologyId: 'root', editKey: folder.editKey, x: 3, y: 2,
        }], roots);
        assert.ifError(horizontal.error);
        assert.match(applyTechnologyTextChanges(content, horizontal.changes ?? []), /position = \{ x = 3 y = @year_1936 \}/);
    });

    it('rejects non-finite, out-of-bounds, and colliding host-side position edits', () => {
        const content = graphFixture();
        const metadata = collectTechnologyFileMetadata(parseHoi4File(content), filePath);
        const leftFolder = metadata.technologies.find(technology => technology.id === 'left')!.folders[0];
        const request = (x: number, y: number) => buildTechnologyPositionTextChanges(
            content,
            filePath,
            'infantry',
            [{ technologyId: 'left', editKey: leftFolder.editKey, x, y }],
            roots,
        );

        assert.match(request(Number.NaN, 2).error ?? '', /finite numeric/i);
        assert.match(request(999999, 999999).error ?? '', /outside/i);
        assert.match(request(1, 1).error ?? '', /occupied/i);
    });

    it('keeps ambiguous numeric constants read-only', () => {
        const content = `technologies = {
    @year = 2
    @year = 3
    root = { folder = { name = infantry position = { x = 1 y = @year } } }
}`;
        const folder = collectTechnologyFileMetadata(parseHoi4File(content), filePath).technologies[0].folders[0];
        assert.strictEqual(folder.editable, false);
    });

    it('adds and removes paths while preventing cycles and orphan roots', () => {
        const content = graphFixture();
        const add = buildTechnologyPathTextChanges(content, filePath, 'left', 'right', 'infantry', roots);
        assert.ifError(add.error);
        const linked = applyTechnologyTextChanges(content, add.changes ?? []);
        assert.match(linked, /left = \{[\s\S]*?path = \{ leads_to_tech = right \}/);
        assert.match(buildTechnologyPathTextChanges(content, filePath, 'left', 'root', 'infantry', roots).error ?? '', /cycle/i);
        assert.match(buildTechnologyPathTextChanges(content, filePath, 'root', 'left', 'infantry', noRoots).error ?? '', /root without/i);
    });

    it('normalizes and toggles symmetric XOR links for siblings', () => {
        const content = graphFixture();
        const add = buildTechnologyXorTextChanges(content, filePath, 'left', 'right', 'infantry');
        assert.ifError(add.error);
        const linked = applyTechnologyTextChanges(content, add.changes ?? []);
        assert.match(linked, /left = \{[\s\S]*?xor = right/);
        assert.match(linked, /right = \{[\s\S]*?xor = left/);
        const remove = buildTechnologyXorTextChanges(linked, filePath, 'left', 'right', 'infantry');
        assert.ifError(remove.error);
        const unlinked = applyTechnologyTextChanges(linked, remove.changes ?? []);
        assert.doesNotMatch(unlinked, /xor =/);
    });

    it('creates a minimal child and its parent path atomically', () => {
        const content = graphFixture();
        const result = buildCreateChildTechnologyTextChanges(content, filePath, 'left', 'new_child', 'infantry', 4, 5, roots);
        assert.ifError(result.error);
        const updated = applyTechnologyTextChanges(content, result.changes ?? []);
        assert.match(updated, /left = \{[\s\S]*?path = \{ leads_to_tech = new_child \}/);
        assert.match(updated, /new_child = \{[\s\S]*?name = infantry[\s\S]*?position = \{ x = 4 y = 5 \}/);
    });

    it('rejects child creation at invalid or occupied grid positions', () => {
        const content = graphFixture();
        assert.match(
            buildCreateChildTechnologyTextChanges(content, filePath, 'left', 'new_child', 'infantry', Number.NaN, 5, roots).error ?? '',
            /finite numeric/i,
        );
        assert.match(
            buildCreateChildTechnologyTextChanges(content, filePath, 'left', 'new_child', 'infantry', 999999, 5, roots).error ?? '',
            /outside/i,
        );
        assert.match(
            buildCreateChildTechnologyTextChanges(content, filePath, 'left', 'new_child', 'infantry', 1, 1, roots).error ?? '',
            /occupied/i,
        );
    });

    it('deletes technologies and current-file references but blocks orphaning children', () => {
        const content = graphFixture().replace('right = {', 'right = {\n        xor = left\n        sub_technologies = { left }');
        const blocked = buildDeleteTechnologiesTextChanges(content, filePath, ['root'], roots);
        assert.match(blocked.error ?? '', /root without/i);

        const deleted = buildDeleteTechnologiesTextChanges(content, filePath, ['left'], roots);
        assert.ifError(deleted.error);
        const updated = applyTechnologyTextChanges(content, deleted.changes ?? []);
        assert.doesNotMatch(updated, /left = \{/);
        assert.doesNotMatch(updated, /xor = left/);
        assert.doesNotMatch(updated, /sub_technologies = \{ left \}/);
    });

    it('preserves unrelated inline fields and list references while removing a target', () => {
        const content = `technologies = { root = { path = { leads_to_tech = left } path = { leads_to_tech = right } folder = { name = infantry position = { x = 0 y = 0 } } } left = { folder = { name = infantry position = { x = 0 y = 1 } } } right = { xor = left sub_technologies = { left retained } folder = { name = infantry position = { x = 1 y = 1 } } } }`;
        const result = buildDeleteTechnologiesTextChanges(content, filePath, ['left'], roots);
        assert.ifError(result.error);
        const updated = applyTechnologyTextChanges(content, result.changes ?? []);
        assert.match(updated, /root = \{/);
        assert.match(updated, /path = \{ leads_to_tech = right \}/);
        assert.match(updated, /sub_technologies = \{\s*retained\s*\}/);
        assert.doesNotMatch(updated, /xor = left/);
    });
});

function graphFixture(): string {
    return `technologies = {
    root = {
        path = { leads_to_tech = left }
        path = { leads_to_tech = right }
        folder = { name = infantry position = { x = 0 y = 0 } }
    }
    left = {
        folder = { name = infantry position = { x = 0 y = 1 } }
    }
    right = {
        folder = { name = infantry position = { x = 1 y = 1 } }
    }
}`;
}
