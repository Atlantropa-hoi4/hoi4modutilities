import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    featureFlags: ['localisationIndex'],
                    previewLocalisation: undefined,
                }),
            },
            env: {
                language: 'en',
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    createLocalisedTextQuickIfReadyResolver,
    getLocalisationIndexLangKeyFromPath,
    isLocalisationIndexFilePath,
    mergeLocalisationIndexes,
    parseLocalisationFile,
    preprocessYamlContent,
    rebuildLocalisationIndexFromFileIndexes,
    resolveLocalisedTextFromIndex,
} = require('../../src/util/localisationIndex') as typeof import('../../src/util/localisationIndex');

nodeModule._load = originalLoad;
delete require.cache[require.resolve('../../src/util/featureflags')];
delete require.cache[require.resolve('../../src/util/fileloader')];
delete require.cache[require.resolve('../../src/util/modfile')];
delete require.cache[require.resolve('../../src/util/vsccommon')];

describe('localisation index helpers', () => {
    it('captures preview localisation configuration once for a lookup batch', () => {
        let configurationReadCount = 0;
        const resolveText = createLocalisedTextQuickIfReadyResolver(() => {
            configurationReadCount += 1;
            return {
                featureFlags: [],
                previewLocalisation: 'English',
            } as any;
        });

        for (let index = 0; index < 500; index += 1) {
            resolveText(`FOCUS_${index}`);
        }

        assert.strictEqual(configurationReadCount, 1);
    });

    it('prefers workspace overrides before vanilla in both requested-language and english fallback lookups', () => {
        const globalIndex = {
            l_korean: {
                FOCUS_A: '바닐라 한국어',
                FOCUS_OVERRIDE: '바닐라 한국어 오버라이드',
            },
            l_english: {
                FOCUS_A: 'Vanilla English',
                FOCUS_B: 'Vanilla English Fallback',
                FOCUS_FALLBACK_OVERRIDE: 'Vanilla English Override',
            },
        };
        const workspaceIndex = {
            l_korean: {
                FOCUS_C: '모드 한국어',
                FOCUS_OVERRIDE: '모드 한국어 오버라이드',
            },
            l_english: {
                FOCUS_D: 'Workspace English',
                FOCUS_FALLBACK_OVERRIDE: 'Workspace English Override',
            },
        };

        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_A', 'ko', globalIndex, workspaceIndex), '바닐라 한국어');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_OVERRIDE', 'ko', globalIndex, workspaceIndex), '모드 한국어 오버라이드');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_B', 'ko', globalIndex, workspaceIndex), 'Vanilla English Fallback');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_C', 'ko', globalIndex, workspaceIndex), '모드 한국어');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_D', 'ja', globalIndex, workspaceIndex), 'Workspace English');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_FALLBACK_OVERRIDE', 'ja', globalIndex, workspaceIndex), 'Workspace English Override');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_UNKNOWN', 'ko', globalIndex, workspaceIndex), 'FOCUS_UNKNOWN');
    });

    it('falls back to an available workspace language when requested and english text are missing', () => {
        const globalIndex = {};
        const workspaceIndex = {
            l_korean: {
                FOCUS_KOR_ONLY: '한국어만 있는 중점',
            },
        };

        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_KOR_ONLY', 'en', globalIndex, workspaceIndex), '한국어만 있는 중점');
    });

    it('can keep preview localisation settings from falling through to unrelated workspace languages', () => {
        const globalIndex = {
            l_english: {
                FOCUS_ENGLISH: 'English focus',
            },
        };
        const workspaceIndex = {
            l_korean: {
                FOCUS_KOR_ONLY: '한국어만 있는 중점',
                FOCUS_KOR_PRIORITY: '설정 한국어 우선',
            },
            l_english: {
                FOCUS_ENGLISH: 'Workspace English focus',
            },
        };

        const options = { allowAvailableWorkspaceLanguageFallback: false };

        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_KOR_PRIORITY', 'ko', globalIndex, workspaceIndex, options), '설정 한국어 우선');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_ENGLISH', 'ja', globalIndex, workspaceIndex, options), 'Workspace English focus');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_KOR_ONLY', 'en', globalIndex, workspaceIndex, options), 'FOCUS_KOR_ONLY');
    });

    it('accepts localisation index files with space or dash before the language suffix', () => {
        assert.strictEqual(isLocalisationIndexFilePath('english/test_l_english.yml'), true);
        assert.strictEqual(isLocalisationIndexFilePath('korean/MEO - New Soul l_korean.yml'), true);
        assert.strictEqual(isLocalisationIndexFilePath('korean/MEO - New Soul-l_korean.yml'), true);
        assert.strictEqual(isLocalisationIndexFilePath('korean/MEO - New Soul_l_korean.yml'), true);
        assert.strictEqual(isLocalisationIndexFilePath('korean/MEO - New Soul l_korean.yaml'), false);
        assert.strictEqual(isLocalisationIndexFilePath('korean/MEO - New Soul.yml'), false);
    });

    it('extracts the localisation language key from non-underscore file names', () => {
        assert.strictEqual(getLocalisationIndexLangKeyFromPath('korean/MEO - New Soul l_korean.yml'), 'l_korean');
        assert.strictEqual(getLocalisationIndexLangKeyFromPath('english/test_l_english.yml'), 'l_english');
    });

    it('rebuilds workspace localisation from per-file indexes without dropping same-language files', () => {
        const fileIndexes: Record<string, Record<string, Record<string, string>>> = {
            'localisation/a_l_english.yml': {
                l_english: {
                    KEY_A: 'A',
                },
            },
            'localisation/b_l_english.yml': {
                l_english: {
                    KEY_B: 'B',
                },
            },
            'localisation/c_l_korean.yml': {
                l_korean: {
                    KEY_C: 'C',
                },
            },
        };

        delete fileIndexes['localisation/a_l_english.yml'];
        const rebuilt = rebuildLocalisationIndexFromFileIndexes(fileIndexes);

        assert.deepStrictEqual(rebuilt, {
            l_english: {
                KEY_B: 'B',
            },
            l_korean: {
                KEY_C: 'C',
            },
        });
    });

    it('applies DLC localisation after base-game localisation regardless of file name', () => {
        const baseIndex = {
            l_english: {
                SHARED_KEY: 'Base value',
                BASE_ONLY: 'Base only',
            },
        };
        const dlcIndex = {
            l_english: {
                SHARED_KEY: 'DLC value',
                DLC_ONLY: 'DLC only',
            },
        };

        assert.deepStrictEqual(mergeLocalisationIndexes([baseIndex, dlcIndex]), {
            l_english: {
                SHARED_KEY: 'DLC value',
                BASE_ONLY: 'Base only',
                DLC_ONLY: 'DLC only',
            },
        });
    });

    it('keeps hash characters inside quoted localisation values', () => {
        const processed = preprocessYamlContent([
            'l_english:',
            ' TEST_HASH:0 "Keep # inside the value" # trailing comment',
        ].join('\n'));

        assert.strictEqual(processed, [
            'l_english:',
            ' TEST_HASH: "Keep # inside the value"',
        ].join('\n'));
    });

    it('recovers valid localisation entries when malformed prose makes the file invalid YAML', () => {
        const processed = preprocessYamlContent([
            'l_english:',
            ' FOCUS_BEFORE:0 "Before the malformed line"',
            ' CHARACTER_DESC:0 "He was known as "the expert" by his supporters."',
            ' BROKEN_ENTRY:0 "Missing the closing quote',
            ' FOCUS_AFTER:0 "After the malformed line\\nSecond line"',
        ].join('\n'));

        assert.deepStrictEqual(parseLocalisationFile(processed), {
            l_english: {
                FOCUS_BEFORE: 'Before the malformed line',
                CHARACTER_DESC: 'He was known as "the expert" by his supporters.',
                FOCUS_AFTER: 'After the malformed line\nSecond line',
            },
        });
    });
});
