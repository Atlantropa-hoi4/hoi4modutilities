import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class Disposable {
            constructor(private readonly fn: () => void = () => undefined) {}
            dispose(): void {
                this.fn();
            }
        }

        return {
            Disposable,
            env: {
                language: 'en',
            },
            l10n: {
                bundle: {},
                t: (message: string, ...args: unknown[]) =>
                    message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
            },
            commands: {
                executeCommand: async () => undefined,
            },
            workspace: {
                getConfiguration: () => ({
                    get: (_key: string, defaultValue: unknown) => defaultValue,
                }),
                workspaceFolders: [],
                textDocuments: [],
            },
            Uri: {
                parse: (value: string) => ({
                    scheme: value.slice(0, value.indexOf(':')),
                    path: value,
                    toString: () => value,
                }),
                joinPath: (...parts: Array<{ toString?: () => string } | string>) => ({
                    toString: () => parts.map(part => typeof part === 'string' ? part : part.toString?.() ?? '').join('/'),
                }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { parseHoi4File } = require('../../src/hoiformat/hoiparser') as typeof import('../../src/hoiformat/hoiparser');
const { getCharactersFromFile } = require('../../src/previewdef/characters/schema') as typeof import('../../src/previewdef/characters/schema');
const { getCharacterPreviewPriority } = require('../../src/previewdef/characters/detect') as typeof import('../../src/previewdef/characters/detect');
const { renderCharacterPreviewBody } = require('../../src/previewdef/characters/contentbuilder') as typeof import('../../src/previewdef/characters/contentbuilder');
const { normalizeCharacterPortraitImagePath } = require('../../src/previewdef/characters/portraitassets') as typeof import('../../src/previewdef/characters/portraitassets');
const { StyleTable } = require('../../src/util/styletable') as typeof import('../../src/util/styletable');

nodeModule._load = originalLoad;
clearStubbedModuleCache();

describe('character preview', () => {
    after(() => {
        clearStubbedModuleCache();
    });

    it('detects direct common/characters text files', () => {
        assert.strictEqual(
            getCharacterPreviewPriority('file:///workspace/common/characters/TAG.txt', '/workspace/common/characters/TAG.txt'),
            0,
        );
        assert.strictEqual(
            getCharacterPreviewPriority('file:///workspace/common/characters/nested/TAG.txt', '/workspace/common/characters/nested/TAG.txt'),
            undefined,
        );
        assert.strictEqual(
            getCharacterPreviewPriority('file:///workspace/common/national_focus/TAG.txt', '/workspace/common/national_focus/TAG.txt'),
            undefined,
        );
    });

    it('parses characters, names, multiple portraits, and source tokens in source order', () => {
        const content = `
characters = {
    TAG_first_character = {
        name = TAG_first_character_name
        portraits = {
            civilian = {
                large = GFX_portrait_TAG_first_civilian
                small = GFX_portrait_TAG_first_civilian_small
            }
            army = {
                large = GFX_portrait_TAG_first_army
            }
            advisor = {
                large = "gfx/Leaders/ZZZ/ZZZ_anarchy.png"
            }
        }
    }
}`;
        const characters = getCharactersFromFile(parseHoi4File(content), 'common/characters/sample.txt');

        assert.strictEqual(characters.length, 1);
        assert.strictEqual(characters[0].id, 'TAG_first_character');
        assert.strictEqual(characters[0].name, 'TAG_first_character_name');
        assert.strictEqual(characters[0].token?.start, content.indexOf('TAG_first_character'));
        assert.deepStrictEqual(
            characters[0].portraits.map(portrait => `${portrait.role}:${portrait.size}:${portrait.sprite}`),
            [
                'civilian:large:GFX_portrait_TAG_first_civilian',
                'civilian:small:GFX_portrait_TAG_first_civilian_small',
                'army:large:GFX_portrait_TAG_first_army',
                'advisor:large:gfx/Leaders/ZZZ/ZZZ_anarchy.png',
            ],
        );
    });

    it('recognizes direct portrait image paths', () => {
        assert.strictEqual(
            normalizeCharacterPortraitImagePath('gfx\\Leaders\\ZZZ\\ZZZ_anarchy.png'),
            'gfx/Leaders/ZZZ/ZZZ_anarchy.png',
        );
        assert.strictEqual(
            normalizeCharacterPortraitImagePath('/gfx/Leaders/ZZZ/ZZZ_anarchy.dds'),
            'gfx/Leaders/ZZZ/ZZZ_anarchy.dds',
        );
        assert.strictEqual(
            normalizeCharacterPortraitImagePath('GFX_portrait_TAG_first_civilian'),
            undefined,
        );
    });

    it('renders multiple portraits above the name and keeps missing portraits navigable', async () => {
        const content = `
characters = {
    TAG_first_character = {
        name = TAG_first_character_name
        portraits = {
            civilian = { large = GFX_portrait_TAG_first_civilian }
            army = { small = GFX_missing_portrait }
        }
    }
}`;
        const [character] = getCharactersFromFile(parseHoi4File(content), 'common/characters/sample.txt');
        const result = await renderCharacterPreviewBody([character], new StyleTable(), {
            resolveDisplayName: async () => 'Localized Character Name',
            resolvePortraitAsset: async spriteName => ({
                image: spriteName === 'GFX_missing_portrait'
                    ? undefined
                    : { uri: `data:image/png;base64,${Buffer.from(spriteName).toString('base64')}` } as any,
                dependencies: [`interface/portraits/${spriteName}.gfx`, `gfx/leaders/${spriteName}.dds`],
            }),
        });

        assert.ok(result.body.includes('Localized Character Name'));
        assert.ok(result.body.includes('<img'));
        assert.ok(result.body.includes('civilian large'));
        assert.ok(result.body.includes('army small'));
        assert.ok(result.body.includes('GFX_missing_portrait'));
        assert.ok(result.body.includes(`start="${character.token?.start}"`));
        assert.ok(result.body.indexOf('civilian large') < result.body.indexOf('Localized Character Name'));
        assert.deepStrictEqual(result.dependencies, [
            'interface/portraits/GFX_portrait_TAG_first_civilian.gfx',
            'gfx/leaders/GFX_portrait_TAG_first_civilian.dds',
            'interface/portraits/GFX_missing_portrait.gfx',
            'gfx/leaders/GFX_missing_portrait.dds',
        ]);
    });
});

function clearStubbedModuleCache(): void {
    [
        '../../src/previewdef/characters/contentbuilder',
        '../../src/previewdef/characters/portraitassets',
        '../../src/util/html',
        '../../src/context',
        '../../src/util/i18n',
        '../../src/services/localizer',
        '../../src/util/localisationIndex',
        '../../src/util/featureflags',
        '../../src/util/vsccommon',
        '../../src/util/fileloader',
        '../../src/util/gfxindex',
        '../../src/util/image/imagecache',
    ].forEach(modulePath => {
        delete require.cache[require.resolve(modulePath)];
    });
}
