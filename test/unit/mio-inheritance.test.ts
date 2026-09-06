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
});
