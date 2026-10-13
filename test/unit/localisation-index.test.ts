import * as assert from 'assert';
import Module = require('module');
import { FakeUpdateClock } from './fake-update-clock';
import type * as LocalisationIndexModule from '../../src/util/localisationIndex';
import type * as LocalisationIndexEventsModule from '../../src/util/localisationIndexEvents';
import type { TextDocumentChangeEvent, Uri } from 'vscode';

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
    applyLocalisationFileIndexUpdate,
    createGlobalLocalisationFileFilter,
    createLocalisedTextQuickIfReadyResolver,
    getLocalisationIndexLangKeyFromPath,
    isLocalisationIndexFilePath,
    mergeLocalisationIndexes,
    parseLocalisationFile,
    parseLocalisationFileContent,
    preprocessYamlContent,
    rebuildLocalisationIndexFromFileIndexes,
    resolveLocalisedTextFromIndex,
} = require('../../src/util/localisationIndex') as typeof LocalisationIndexModule;

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

    it('preserves an intentionally empty workspace override', () => {
        const globalIndex = {
            l_english: {
                HIDDEN_LABEL: 'Visible vanilla text',
            },
        };
        const workspaceIndex = {
            l_english: {
                HIDDEN_LABEL: '',
            },
        };

        assert.strictEqual(resolveLocalisedTextFromIndex('HIDDEN_LABEL', 'en', globalIndex, workspaceIndex), '');
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

    it('selects only the preview language and English using the supported filename pattern', () => {
        const languages: Record<string, string> = {
            'Brazilian Portuguese': 'l_braz_por',
            English: 'l_english',
            French: 'l_french',
            German: 'l_german',
            Japanese: 'l_japanese',
            Korean: 'l_korean',
            Polish: 'l_polish',
            Russian: 'l_russian',
            'Simplified Chinese': 'l_simp_chinese',
            Spanish: 'l_spanish',
        };
        for (const [profile, langKey] of Object.entries(languages)) {
            const includeFile = createGlobalLocalisationFileFilter(profile, 'ko');
            for (const candidate of Object.values(languages)) {
                const eligible = candidate === 'l_english' || candidate === langKey;
                for (const separator of [' ', '-', '_']) {
                    assert.strictEqual(includeFile(`nested/Test${separator}${candidate.toUpperCase()}.YML`), eligible);
                }
                assert.strictEqual(includeFile(`${candidate}.yml`), eligible);
                assert.strictEqual(includeFile(`nested/Test${candidate}.yml`), false);
                assert.strictEqual(includeFile(`nested/Test_${candidate}.yaml`), false);
            }
            assert.strictEqual(includeFile('test_l_portuguese.yml'), false);
            assert.strictEqual(includeFile('test_l_chinese.yml'), false);
        }
    });

    it('uses the environment language mapping when no preview profile is selected', () => {
        for (const [language, langKey] of [['KO', 'l_korean'], ['pt-BR', 'l_braz_por'], ['ZH-CN', 'l_simp_chinese']]) {
            const includeFile = createGlobalLocalisationFileFilter(undefined, language);
            assert.strictEqual(includeFile(`test_${langKey}.yml`), true);
            assert.strictEqual(includeFile('test_l_english.yml'), true);
            assert.strictEqual(includeFile('test_l_russian.yml'), false);
        }
        const includeFile = createGlobalLocalisationFileFilter(undefined, 'unsupported');
        assert.strictEqual(includeFile('test_l_english.yml'), true);
        assert.strictEqual(includeFile('test_l_korean.yml'), false);
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

    it('preserves file precedence when incrementally replacing an existing file index', () => {
        const fileIndexes = {
            'localisation/a_l_english.yml': {
                l_english: {
                    SHARED_KEY: 'A',
                },
            },
            'localisation/b_l_english.yml': {
                l_english: {
                    SHARED_KEY: 'B',
                },
            },
        };

        const rebuilt = applyLocalisationFileIndexUpdate(
            fileIndexes,
            'localisation/a_l_english.yml',
            { l_english: { SHARED_KEY: 'A updated' } },
        );

        assert.deepStrictEqual(Object.keys(fileIndexes), [
            'localisation/a_l_english.yml',
            'localisation/b_l_english.yml',
        ]);
        assert.strictEqual(rebuilt.l_english.SHARED_KEY, 'B');
    });

    it('preserves file precedence when a deleted localisation file is recreated', () => {
        const fileIndexes = {
            'localisation/a_l_english.yml': {
                l_english: {
                    SHARED_KEY: 'A',
                },
            },
            'localisation/b_l_english.yml': {
                l_english: {
                    SHARED_KEY: 'B',
                },
            },
        };

        applyLocalisationFileIndexUpdate(
            fileIndexes,
            'localisation/a_l_english.yml',
            undefined,
        );
        const rebuilt = applyLocalisationFileIndexUpdate(
            fileIndexes,
            'localisation/a_l_english.yml',
            { l_english: { SHARED_KEY: 'A recreated' } },
        );

        assert.deepStrictEqual(Object.keys(fileIndexes), [
            'localisation/a_l_english.yml',
            'localisation/b_l_english.yml',
        ]);
        assert.strictEqual(rebuilt.l_english.SHARED_KEY, 'B');
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
        const source = [
            'l_english:',
            ' FOCUS_BEFORE:0 "Before the malformed line"',
            ' CHARACTER_DESC:0 "He was known as "the expert" by his supporters."',
            ' BROKEN_ENTRY:0 "Missing the closing quote',
            ' FOCUS_AFTER:0 "After the malformed line\\nSecond line"',
        ].join('\n');
        const processed = preprocessYamlContent(source);

        assert.deepStrictEqual(parseLocalisationFile(processed), {
            l_english: {
                FOCUS_BEFORE: 'Before the malformed line',
                CHARACTER_DESC: 'He was known as "the expert" by his supporters.',
                FOCUS_AFTER: 'After the malformed line\nSecond line',
            },
        });
        assert.deepStrictEqual(parseLocalisationFileContent(source), parseLocalisationFile(processed));
    });
});

type LocalisationLayer = 'base' | 'dlc' | 'workspace';
type LocalisationIndexApi = typeof LocalisationIndexModule;

interface LocalisationHarness {
    previewLocalisation: string;
    files: Record<LocalisationLayer, Record<string, string>>;
    reads: string[];
    readFile?: (layer: LocalisationLayer, file: string) => Promise<string>;
    changePreviewLanguage(language: string): void;
    changeFile(file: string, content: string): void;
    committedLabels: Array<string | undefined>;
}

describe('localisation index language loading', () => {
    it('limits base and DLC inputs while keeping all workspace languages and precedence', async () => {
        await withLocalisationIndex(async (api, harness) => {
            await api.whenLocalisationIndexReady({ showStatusBar: false });

            assert.deepStrictEqual(harness.reads.sort(), [
                'base/base_l_english.yml', 'base/base_l_korean.yml',
                'dlc/dlc_l_english.yml', 'dlc/dlc_l_korean.yml',
                'workspace/mod_l_english.yml', 'workspace/mod_l_korean.yml', 'workspace/mod_l_russian.yml',
            ]);
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'ko'), 'Workspace Korean');
            assert.strictEqual(api.getLocalisedTextIfReady('DLC_OVERRIDE', 'en'), 'DLC English');
            assert.strictEqual(api.getLocalisedTextIfReady('WORKSPACE_ONLY', 'en'), 'Workspace Russian');
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_RUSSIAN_ONLY', 'ru'), 'GLOBAL_RUSSIAN_ONLY');
        });
    });

    it('rebuilds a ready global index on a preview language switch without rebuilding workspace', async () => {
        await withLocalisationIndex(async (api, harness) => {
            await api.whenLocalisationIndexReady({ showStatusBar: false });
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_KOREAN_ONLY', 'ko'), 'Base Korean');
            harness.reads.length = 0;

            harness.changePreviewLanguage('Russian');
            assert.strictEqual(api.isLocalisationIndexReady(), false);
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_KOREAN_ONLY', 'ko'), 'GLOBAL_KOREAN_ONLY');
            await api.whenLocalisationIndexReady({ showStatusBar: false });

            assert.deepStrictEqual(harness.reads.sort(), [
                'base/base_l_english.yml', 'base/base_l_russian.yml',
                'dlc/dlc_l_english.yml', 'dlc/dlc_l_russian.yml',
            ]);
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_RUSSIAN_ONLY', 'ru'), 'Base Russian');
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_KOREAN_ONLY', 'ko'), 'GLOBAL_KOREAN_ONLY');
            assert.strictEqual(api.getLocalisedTextIfReady('WORKSPACE_ONLY', 'en'), 'Workspace Russian');
        });
    });

    it('does not start an unused index when preview localisation changes', async () => {
        await withLocalisationIndex(async (api, harness) => {
            harness.changePreviewLanguage('English');
            await Promise.resolve();
            assert.deepStrictEqual(harness.reads, []);
            assert.strictEqual(api.isLocalisationIndexReady(), false);
        });
    });

    it('prevents an obsolete language build from committing after the new generation is ready', async () => {
        await withLocalisationIndex(async (api, harness) => {
            let releaseStale!: () => void;
            let markStarted!: () => void;
            const staleGate = new Promise<void>(resolve => { releaseStale = resolve; });
            const started = new Promise<void>(resolve => { markStarted = resolve; });
            let delayed = false;
            harness.readFile = async (layer, file) => {
                const content = harness.files[layer][file];
                if (layer === 'base' && file === 'base_l_english.yml' && !delayed) {
                    delayed = true;
                    markStarted();
                    await staleGate;
                }
                return content;
            };

            const staleReady = api.whenLocalisationIndexReady({ showStatusBar: false });
            await started;
            harness.files.base['base_l_english.yml'] = 'l_english:\n ENGLISH_ONLY:0 "Current English"';
            harness.changePreviewLanguage('Russian');
            try {
                await api.whenLocalisationIndexReady({ showStatusBar: false });
                assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_RUSSIAN_ONLY', 'ru'), 'Base Russian');
            } finally {
                releaseStale();
                await staleReady;
            }

            assert.strictEqual(api.getLocalisedTextIfReady('ENGLISH_ONLY', 'en'), 'Current English');
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_RUSSIAN_ONLY', 'ru'), 'Base Russian');
            assert.strictEqual(api.getLocalisedTextIfReady('GLOBAL_KOREAN_ONLY', 'ko'), 'GLOBAL_KOREAN_ONLY');
        });
    });
});

describe('localisation incremental freshness', () => {
    let clock: FakeUpdateClock;
    beforeEach(() => {
        clock = new FakeUpdateClock();
        clock.install();
    });
    afterEach(() => clock.restore());

    it('announces the committed label after a debounced unsaved edit and its Undo', async () => {
        await withLocalisationIndex(async (api, harness) => {
            await api.whenLocalisationIndexReady({ showStatusBar: false });
            harness.changeFile('mod_l_english.yml', 'l_english:\n SHARED:0 "Edited English"');
            await clock.advance(35);
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'en'), 'Workspace English');
            assert.deepStrictEqual(harness.committedLabels, []);

            await clock.advance(965);
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'en'), 'Edited English');
            assert.deepStrictEqual(harness.committedLabels, ['Edited English']);

            harness.changeFile('mod_l_english.yml', 'l_english:\n SHARED:0 "Workspace English"');
            await clock.advance(1000);
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'en'), 'Workspace English');
            assert.deepStrictEqual(harness.committedLabels, ['Edited English', 'Workspace English']);
        });
    });

    it('does not publish a stale parse during the next edit debounce window', async () => {
        await withLocalisationIndex(async (api, harness) => {
            await api.whenLocalisationIndexReady({ showStatusBar: false });
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            let started = false;
            harness.readFile = async (layer, file) => {
                const text = harness.files[layer][file];
                if (layer === 'workspace' && file === 'mod_l_english.yml' && !started) {
                    started = true;
                    await gate;
                }
                return text;
            };
            harness.changeFile('mod_l_english.yml', 'l_english:\n SHARED:0 "Obsolete English"');
            await clock.advance(1000);
            assert.strictEqual(started, true);
            harness.changeFile('mod_l_english.yml', 'l_english:\n SHARED:0 "Newest English"');
            release();
            await clock.advance();
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'en'), 'Workspace English');
            assert.deepStrictEqual(harness.committedLabels, []);

            await clock.advance(1000);
            assert.strictEqual(api.getLocalisedTextIfReady('SHARED', 'en'), 'Newest English');
            assert.deepStrictEqual(harness.committedLabels, ['Newest English']);
        });
    });
});

async function withLocalisationIndex(
    run: (api: LocalisationIndexApi, harness: LocalisationHarness) => Promise<void>,
): Promise<void> {
    const configurationListeners: Array<(event: { affectsConfiguration(key: string): boolean }) => void> = [];
    const documentListeners: Array<(event: TextDocumentChangeEvent) => void> = [];
    const harness: LocalisationHarness = {
        previewLocalisation: 'Korean',
        reads: [],
        committedLabels: [],
        files: {
            base: {
                'base_l_english.yml': 'l_english:\n ENGLISH_ONLY:0 "Old English"\n DLC_OVERRIDE:0 "Base English"',
                'base_l_korean.yml': 'l_korean:\n GLOBAL_KOREAN_ONLY:0 "Base Korean"\n SHARED:0 "Base Korean"',
                'base_l_russian.yml': 'l_russian:\n GLOBAL_RUSSIAN_ONLY:0 "Base Russian"',
            },
            dlc: {
                'dlc_l_english.yml': 'l_english:\n DLC_OVERRIDE:0 "DLC English"',
                'dlc_l_korean.yml': 'l_korean:\n SHARED:0 "DLC Korean"',
                'dlc_l_russian.yml': 'l_russian:\n DLC_RUSSIAN_ONLY:0 "DLC Russian"',
            },
            workspace: {
                'mod_l_english.yml': 'l_english:\n SHARED:0 "Workspace English"',
                'mod_l_korean.yml': 'l_korean:\n SHARED:0 "Workspace Korean"',
                'mod_l_russian.yml': 'l_russian:\n WORKSPACE_ONLY:0 "Workspace Russian"',
            },
        },
        changePreviewLanguage: language => {
            harness.previewLocalisation = language;
            configurationListeners.forEach(listener => listener({
                affectsConfiguration: key => key === 'hoi4ModUtilities.previewLocalisation',
            }));
        },
        changeFile: (file, content) => {
            harness.files.workspace[file] = content;
            // This fixture exercises only URI identity/version, never URI filesystem methods.
            const uri = { path: '/workspace/localisation/' + file,
                toString: () => 'file:///workspace/localisation/' + file } as unknown as Uri;
            const document = { uri, version: 2 };
            const change = { document, contentChanges: [{ text: content }] } as unknown as TextDocumentChangeEvent;
            documentListeners.forEach(listener => listener(change));
        },
    };
    class Disposable {
        constructor(private readonly callback: () => void = () => undefined) {}
        public dispose(): void { this.callback(); }
        public static from(...items: Disposable[]): Disposable {
            return new Disposable(() => items.forEach(item => item.dispose()));
        }
    }
    class EventEmitter<T> {
        private readonly listeners = new Set<(event: T) => unknown>();
        public readonly event = (listener: (event: T) => unknown): Disposable => {
            this.listeners.add(listener);
            return new Disposable(() => { this.listeners.delete(listener); });
        };
        public fire(value: T): void {
            this.listeners.forEach(listener => listener(value));
        }
        public dispose(): void {
            this.listeners.clear();
        }
    }
    const event = () => new Disposable();
    const getConfig = () => ({ featureFlags: ['localisationIndex'], previewLocalisation: harness.previewLocalisation });
    const layerFor = (options: { mod?: boolean; hoi4?: boolean }): LocalisationLayer =>
        options.mod ? 'workspace' : options.hoi4 ? 'base' : 'dlc';
    const mocks: Record<string, unknown> = {
        vscode: {
            Disposable,
            EventEmitter,
            env: { language: 'en' },
            workspace: {
                getConfiguration: getConfig,
                onDidChangeWorkspaceFolders: event,
                onDidChangeTextDocument: (listener: typeof documentListeners[number]) => {
                    documentListeners.push(listener);
                    return new Disposable(() => documentListeners.splice(documentListeners.indexOf(listener), 1));
                },
                getWorkspaceFolder: () => ({ uri: { path: '/workspace' } }),
                onDidCloseTextDocument: event, onDidCreateFiles: event,
                onDidDeleteFiles: event, onDidRenameFiles: event,
                onDidChangeConfiguration: (listener: typeof configurationListeners[number]) => {
                    configurationListeners.push(listener);
                    return new Disposable(() => configurationListeners.splice(configurationListeners.indexOf(listener), 1));
                },
                createFileSystemWatcher: () => ({ dispose: () => undefined, onDidChange: event, onDidCreate: event, onDidDelete: event }),
            },
        },
        vsccommon: { getConfiguration: getConfig },
        context: { contextContainer: { current: null } },
        telemetry: { sendEvent: () => undefined },
        fileloader: {
            getSelectedModRootFolders: async () => [],
            refreshFileContentSource: () => undefined,
            getFilePathFromMod: async (relative: string) => harness.files.workspace[relative.slice('localisation/'.length)] === undefined
                ? undefined : { path: '/workspace/' + relative, toString: () => 'file:///workspace/' + relative },
            listFilesFromModOrHOI4: async (_folder: string, options: { mod?: boolean; hoi4?: boolean }) =>
                Object.keys(harness.files[layerFor(options)]),
            readFileFromModOrHOI4: async (relative: string, options: { mod?: boolean; hoi4?: boolean }) => {
                const layer = layerFor(options);
                const file = relative.slice('localisation/'.length);
                harness.reads.push(`${layer}/${file}`);
                const content = harness.readFile ? await harness.readFile(layer, file) : harness.files[layer][file];
                return [Buffer.from(content)];
            },
        },
        modfile: { onDidChangeSelectedModSource: event },
    };
    const original = nodeModule._load;
    const cached = { ...require.cache };
    for (const name of ['../../src/util/localisationIndex', '../../src/util/localisationIndexEvents',
        '../../src/services/indexService', '../../src/services/indexCache']) {
        delete require.cache[require.resolve(name)];
    }
    nodeModule._load = function(request, parent, isMain) {
        const name = request.split(/[\\/]/).pop()!;
        return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, request, parent, isMain);
    };
    let registration: { dispose(): void } | undefined;
    let committedSubscription: { dispose(): void } | undefined;
    try {
        const api = require('../../src/util/localisationIndex') as LocalisationIndexApi;
        registration = api.registerLocalisationIndex();
        const events = require('../../src/util/localisationIndexEvents') as typeof LocalisationIndexEventsModule;
        committedSubscription = events.onDidCommitWorkspaceLocalisationIndex(() => {
            harness.committedLabels.push(api.getLocalisedTextIfReady('SHARED', 'en'));
        });
        await run(api, harness);
    } finally {
        committedSubscription?.dispose();
        registration?.dispose();
        nodeModule._load = original;
        for (const key of Object.keys(require.cache)) {
            if (!cached[key]) { delete require.cache[key]; }
        }
        Object.assign(require.cache, cached);
    }
}
