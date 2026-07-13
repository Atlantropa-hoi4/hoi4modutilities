import * as assert from 'assert';
import { ConditionComplexExpr, ConditionItem } from '../../src/hoiformat/condition';
import { Technology } from '../../src/previewdef/technology/schema';
import { arrayToMap } from '../../src/util/common';
import { findTechnologyXorGroups, getAllowedTechnologies } from '../../webviewsrc/technology/conditionfilter';

const folder = 'test_folder';

describe('technology condition filtering', () => {
    it('hides descendants when their only parent branch is disabled', () => {
        const rootCondition = condition('show_root');
        const childCondition = condition('show_child');
        const technologies = [
            technology('root', ['child'], rootCondition),
            technology('child', ['grandchild'], childCondition),
            technology('grandchild'),
        ];

        const allowed = getAllowedTechnologies(technologies, [childCondition]);

        assert.deepStrictEqual(allowed.map(technology => technology.id), []);
    });

    it('keeps a shared descendant when at least one parent branch remains visible', () => {
        const hiddenCondition = condition('show_hidden');
        const technologies = [
            technology('hidden_root', ['shared'], hiddenCondition),
            technology('visible_root', ['shared']),
            technology('shared'),
        ];

        const allowed = getAllowedTechnologies(technologies, []);

        assert.deepStrictEqual(allowed.map(technology => technology.id), ['visible_root', 'shared']);
    });

    it('does not build an XOR joint through a hidden conditional sibling', () => {
        const parent = technology('parent', ['left', 'right']);
        const left = technology('left');
        left.xor = ['right'];
        const right = technology('right');
        right.xor = ['left'];
        const technologyMap = arrayToMap([parent, left, right], 'id');

        assert.strictEqual(
            findTechnologyXorGroups(technologyMap, parent, folder, new Set(['parent', 'left'])),
            undefined,
        );

        const visibleJoint = findTechnologyXorGroups(
            technologyMap,
            parent,
            folder,
            new Set(['parent', 'left', 'right']),
        );
        assert.deepStrictEqual(visibleJoint?.xorGroups.map(group => group.map(technology => technology.id)), [
            ['left', 'right'],
        ]);
    });
});

function condition(nodeContent: string): ConditionItem {
    return { scopeName: '', nodeContent };
}

function technology(
    id: string,
    leadsToTechs: string[] = [],
    allowBranch?: ConditionComplexExpr,
): Technology {
    return {
        id,
        folders: {
            [folder]: { name: folder, x: 0, y: 0 },
        },
        leadsToTechs,
        xor: [],
        inAllowBranch: [],
        allowBranch,
        startYear: 0,
        enableEquipments: false,
        forceUseSmallTechLayout: false,
        subTechnologies: [],
        token: undefined,
    };
}
