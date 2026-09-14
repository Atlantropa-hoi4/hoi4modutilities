import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';

const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = modules._load;
const modulePath = require.resolve('../../src/previewdef/mio/schema');
const previousModule = require.cache[modulePath];
delete require.cache[modulePath];
modules._load = function(request, parent, isMain) {
    if (request === '../../util/i18n' && parent?.filename === modulePath) {
        return { localize: (_key: string, message: string) => message };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { getMiosFromFile } = require('../../src/previewdef/mio/schema') as typeof import('../../src/previewdef/mio/schema');
modules._load = originalLoad;
if (previousModule) {
    require.cache[modulePath] = previousModule;
} else {
    delete require.cache[modulePath];
}

describe('MIO inherited-trait toolbar data', () => {
    it('distinguishes inherited, added and overridden traits without modifying the base MIO', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = {
                trait = { token = inherited position = { x = 0 y = 0 } }
                trait = { token = changed position = { x = 1 y = 0 } }
            }
            child = {
                include = base
                add_trait = { token = added position = { x = 2 y = 0 } }
                override_trait = { token = changed position = { x = 3 y = 0 } }
            }
        `), [], 'common/military_industrial_organization/test.txt');
        const base = mios.find(mio => mio.id === 'base')!;
        const child = mios.find(mio => mio.id === 'child')!;
        assert.strictEqual(base.traits.changed.x, 1);
        assert.strictEqual(base.traits.changed.sourceMioId, 'base');
        assert.strictEqual(child.traits.changed.x, 3);
        assert.strictEqual(child.traits.inherited.sourceMioId, 'base');
        assert.deepStrictEqual(Object.values(child.traits)
            .filter(trait => trait.sourceMioId === child.id).map(trait => trait.id), ['changed', 'added']);
    });

    it('treats explicit empty relationship fields in an override as clearing inherited values', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = {
                trait = { token = root position = { x = 0 y = 0 } }
                trait = {
                    token = child
                    position = { x = 0 y = 1 }
                    any_parent = { root }
                    mutually_exclusive = { root }
                }
            }
            child_mio = {
                include = base
                override_trait = {
                    token = child
                    any_parent = { }
                    mutually_exclusive = { }
                }
            }
        `), [], 'common/military_industrial_organization/test.txt');
        const child = mios.find(mio => mio.id === 'child_mio')!;
        assert.deepStrictEqual(child.traits.child.anyParent, []);
        assert.deepStrictEqual(child.traits.child.exclusive, []);
        assert.strictEqual(child.traits.child.edit.definitionKind, 'override_trait');
    });

    it('resolves same-file include chains independently of declaration order', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            grandchild = { include = child }
            child = { include = base add_trait = { token = child_trait position = { x = 1 y = 0 } } }
            base = { trait = { token = base_trait position = { x = 0 y = 0 } } }
        `), [], 'common/military_industrial_organization/test.txt');
        const grandchild = mios.find(mio => mio.id === 'grandchild')!;
        assert.deepStrictEqual(Object.keys(grandchild.traits).sort(), ['base_trait', 'child_trait']);
    });

    it('applies delete_included_values and new effects in overrides', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = {
                trait = {
                    token = inherited
                    position = { x = 3 y = 2 }
                    relative_position_id = anchor
                    any_parent = { anchor }
                    equipment_bonus = { reliability = 0.1 }
                }
            }
            child = {
                include = base
                override_trait = {
                    token = inherited
                    delete_included_values = { position relative_position_id any_parent equipment_bonus }
                    production_bonus = { production_cost_factor = -0.1 }
                }
            }
        `), [], 'common/military_industrial_organization/test.txt');
        const trait = mios.find(mio => mio.id === 'child')!.traits.inherited;
        assert.deepStrictEqual({ x: trait.x, y: trait.y }, { x: 0, y: 0 });
        assert.strictEqual(trait.relativePositionId, undefined);
        assert.deepStrictEqual(trait.anyParent, []);
        assert.deepStrictEqual(trait.effects, ['production']);
    });

    it('merges partial trait blocks into included traits like current HOI4 content', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = {
                trait = {
                    token = inherited
                    position = { x = 4 y = 3 }
                    any_parent = { anchor }
                    equipment_bonus = { reliability = 0.1 }
                }
            }
            child = {
                include = base
                trait = {
                    token = inherited
                    limit_to_equipment_type = { screen_ship }
                }
            }
        `), [], 'common/military_industrial_organization/test.txt');
        const child = mios.find(mio => mio.id === 'child')!;
        assert.deepStrictEqual({ x: child.traits.inherited.x, y: child.traits.inherited.y }, { x: 4, y: 3 });
        assert.deepStrictEqual(child.traits.inherited.anyParent, ['anchor']);
        assert.deepStrictEqual(child.traits.inherited.effects, ['equiment']);
        assert.strictEqual(child.traits.inherited.edit.definitionKind, 'trait');
        assert.strictEqual(child.warnings.length, 0);
    });
});
