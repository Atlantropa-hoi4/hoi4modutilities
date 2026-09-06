import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File, resolveScriptVariables } from '../../src/hoiformat/hoiparser';
import { LoaderSession } from '../../src/util/loader/loadersession';
import { StyleTable } from '../../src/util/styletable';
import type { CharacterPreviewPayload } from '../../src/previewdef/character/payload';

const modules = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = modules._load;
const cacheBefore = new Set(Object.keys(require.cache));
const files: Record<string, string> = {
    'common/country_leader/traits.txt': 'leader_traits = { honest = { sprite = 2 stability_factor = 0.05 } }',
    'common/modifier_definitions/custom.txt': 'stability_factor = { value_type = percentage color_type = good precision = 1 }',
};
const localised: Record<string, string> = { TAG_name: 'Test leader', honest: 'Honest' };
const image = { uri: 'data:image/png;base64,AA==', width: 32, height: 32 };
const spriteLookups: string[] = [];
const uri = (value: string) => ({ toString: () => value });
for (const name of ['build', 'loader', 'contentbuilder']) {
    delete require.cache[require.resolve(`../../src/previewdef/character/${name}`)];
}
delete require.cache[require.resolve('../../src/util/characterTraits')];
delete require.cache[require.resolve('../../src/util/modifiers')];
delete require.cache[require.resolve('../../src/previewdef/localise')];

modules._load = function(request, parent, isMain) {
    if (request === 'vscode') {
        return {
            env: { language: 'en' },
            EventEmitter: class {
                event = () => ({ dispose: () => undefined });
                fire(): void {}
            },
            Uri: { joinPath: (base: { toString(): string }, suffix: string) => uri(`${base}/${suffix}`) },
        };
    }
    if (request.endsWith('/fileloader')) {
        return {
            listFilesFromModOrHOI4: async (directory: string) => Object.keys(files)
                .filter(file => file.startsWith(directory + '/')).map(file => file.slice(directory.length + 1)),
            readFileFromModOrHOI4: async (file: string) => [Buffer.from(files[file])],
            parseAndResolveHoi4FileCached: async (file: string) => resolveScriptVariables(parseHoi4File(files[file])),
        };
    }
    if (request.endsWith('/gfxindex')) {
        return { getGfxContainerFiles: async () => ['interface/portraits.gfx'] };
    }
    if (request.endsWith('/vsccommon')) {
        return { getLanguageIdInYml: () => 'l_english' };
    }
    if (request.endsWith('/localisationIndex')) {
        return { getLocalisedTextQuick: async (key: string) => localised[key] ?? key };
    }
    if (request.endsWith('/featureflags')) {
        return { isLocalisationIndexEnabled: () => true };
    }
    if (request.endsWith('/imagecache')) {
        return {
            getImageByPath: async () => image,
            getSpriteByGfxName: async (name: string) => {
                spriteLookups.push(name);
                return { image, frames: [image, { ...image, uri: 'data:image/png;base64,AQ==' }] };
            },
        };
    }
    if (request.endsWith('/portraitassets')) {
        return { normalizeCharacterPortraitImagePath: (value: string) => value.replace(/\\/g, '/') };
    }
    if (request.endsWith('/i18n')) {
        return {
            localize: (_key: string, message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)])),
            i18nTableAsScript: () => 'window.__i18ntable = {};',
        };
    }
    if (request.endsWith('/debug')) {
        return { debug: () => undefined };
    }
    if (request.endsWith('/context')) {
        return { contextContainer: { current: { extensionUri: uri('file:///extension'), extension: { id: 'test.extension' } } } };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const { CharactersLoader } = require('../../src/previewdef/character/loader') as typeof import('../../src/previewdef/character/loader');
const { buildCharacterPreviewPayload } = require('../../src/previewdef/character/build') as typeof import('../../src/previewdef/character/build');
const { renderCharacterFile } = require('../../src/previewdef/character/contentbuilder') as typeof import('../../src/previewdef/character/contentbuilder');
modules._load = originalLoad;
for (const key of Object.keys(require.cache)) {
    if (!cacheBefore.has(key)) {
        delete require.cache[key];
    }
}

class TestCharactersLoader extends CharactersLoader {
    public read(content: string) {
        return this.postLoad(content, [], undefined, new LoaderSession(false));
    }
}

const source = `characters = {
    TAG_leader = {
        name = TAG_name
        portraits = { civilian = { large = "gfx/leaders/test.dds" } }
        country_leader = { ideology = liberal traits = { "honest" missing } }
        advisor = { slot = political_advisor traits = { honest } cost = 100 }
    }
    TAG_draft = { }
}`;

describe('MD character payload integration', () => {
    it('loads traits and definition dependencies and builds distinct navigable role cards', async () => {
        const loader = new TestCharactersLoader('common/characters/test.txt');
        const loaded = await loader.read(source);
        assert.deepStrictEqual(new Set(loaded.dependencies), new Set([
            'common/characters/test.txt', 'common/country_leader/traits.txt',
            'common/modifier_definitions/custom.txt', 'interface/portraits.gfx', 'gfx/leaders/test.dds',
        ]));
        const styles = new StyleTable();
        const payload = await buildCharacterPreviewPayload(loaded.result, styles);
        assert.deepStrictEqual(payload.groups.map(group => group.kind), ['country_leader', 'advisor', 'none']);
        assert.strictEqual(new Set(payload.cards.map(card => card.cardId)).size, 3);
        const leader = payload.cards[0];
        assert.strictEqual(leader.name.text, 'Test leader');
        assert.deepStrictEqual(leader.otherRoles, ['advisor']);
        assert.strictEqual(leader.nav?.start, source.indexOf('country_leader'));
        assert.strictEqual(leader.traits[0].nav?.file, 'common/country_leader/traits.txt');
        assert.strictEqual(leader.traits[0].modifiers[0].value, '+5%');
        assert.strictEqual(leader.traits[1].known, false);
        assert.strictEqual(payload.toolbarFlags.hasUnknownTraits, true);
        assert.ok(spriteLookups.includes('GFX_idea_traits_strip'));
        assert.ok(styles.toRawCss().includes('data:image/png;base64,AQ=='));
    });

    it('forces dependency refresh and emits deterministic escaped HTML and update payloads', async () => {
        const loaded = await new TestCharactersLoader('common/characters/test.txt').read(source);
        const forces: boolean[] = [];
        const loader = { load: async (session: LoaderSession) => { forces.push(session.force); return loaded; } } as any;
        const view = { asWebviewUri: (value: unknown) => value, cspSource: 'test-resource:' } as any;
        localised.TAG_name = '</script><script>bad()</script>';
        try {
            const first = await renderCharacterFile(loader, uri('file:///test.txt') as any, view, { dependencyChanged: true });
            const second = await renderCharacterFile(loader, uri('file:///test.txt') as any, view);
            assert.deepStrictEqual(forces, [true, false]);
            assert.deepStrictEqual(first.update, second.update);
            assert.ok(first.html.includes('characterpreview.js'));
            assert.ok(first.html.includes('characterpreview.css'));
            assert.ok(!first.html.includes(localised.TAG_name));
            assert.strictEqual((first.update?.data.characterPreview as CharacterPreviewPayload).cards[0].name.text, localised.TAG_name);
        } finally {
            localised.TAG_name = 'Test leader';
        }
    });
});
