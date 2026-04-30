import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

const mainFocusFile = 'common/national_focus/main.txt';
const sharedFocusFile = 'common/national_focus/shared.txt';
const focusTreeGuiFile = 'interface/nationalfocusview.gui';
const indexedGfxFile = 'interface/indexed_icons.gfx';
const fileContents: Record<string, string> = {
    [mainFocusFile]: `
        focus_tree = {
            id = MAIN
            shared_focus = SHARED_EXT
            focus = {
                id = LOCAL
                icon = GFX_LOCAL
                x = 0
                y = 0
                cost = 1
            }
        }
    `,
    [sharedFocusFile]: `
        shared_focus = {
            id = SHARED_EXT
            icon = GFX_SHARED
            x = 0
            y = 0
            cost = 1
        }
    `,
    [focusTreeGuiFile]: 'guiTypes = {}',
};
const focusIconResolutionCalls: string[][] = [];
const gfxIndexLookups: string[] = [];
const focusIconFallbackLimits: Array<number | undefined> = [];

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class EventEmitter<T> {
            public event = (_listener: (value: T) => unknown) => ({ dispose: () => undefined });
            public fire(_value: T): void { }
        }

        return {
            EventEmitter,
            window: { showErrorMessage: () => undefined },
            l10n: { t: (_key: string, fallback: string) => fallback },
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                    previewLocalisation: 'English',
                }),
            },
        };
    }

    if (request.endsWith('/util/fileloader')
        || request.endsWith('/fileloader')
        || request === '../../util/fileloader'
        || request === '../fileloader') {
        return {
            readFileFromModOrHOI4: async (file: string) => [Buffer.from(fileContents[file] ?? ''), file],
            hoiFileExpiryToken: async (file: string) => `token:${file}`,
            listFilesFromModOrHOI4: async () => [],
        };
    }

    if (request.endsWith('/util/featureflags')
        || request.endsWith('/featureflags')
        || request === '../../util/featureflags') {
        return {
            isSharedFocusIndexEnabled: () => true,
        };
    }

    if (request.endsWith('/util/sharedFocusIndex')
        || request.endsWith('/sharedFocusIndex')
        || request === '../../util/sharedFocusIndex') {
        return {
            findFileByFocusKey: async (focusId: string) => focusId === 'SHARED_EXT' ? sharedFocusFile : undefined,
        };
    }

    if (request.endsWith('/util/gfxindex')
        || request.endsWith('/gfxindex')
        || request === '../../util/gfxindex') {
        return {
            getGfxContainerFile: async (gfxName: string) => {
                gfxIndexLookups.push(gfxName);
                return gfxName === 'GFX_LOCAL' ? indexedGfxFile : undefined;
            },
        };
    }

    if ((request.endsWith('/focusicongfx') || request === './focusicongfx')
        && parent?.filename?.includes('focustree')) {
        return {
            createEmptyFocusIconAssetResolution: () => ({
                gfxFiles: [],
                textureFiles: [],
                gfxFileByIconName: {},
                unresolvedIconNames: [],
                textureExpiryByIconName: {},
            }),
            resolveFocusIconGfxAssets: async (iconNames: string[], resolver: { resolveIndexedFile: (gfxName: string) => Promise<string | undefined> }) => {
                focusIconResolutionCalls.push([...iconNames]);
                focusIconFallbackLimits.push((resolver as { fallbackScanLimit?: number }).fallbackScanLimit);
                const gfxFileByIconName: Record<string, string> = {};
                for (const iconName of iconNames) {
                    const gfxFile = await resolver.resolveIndexedFile(iconName);
                    if (gfxFile) {
                        gfxFileByIconName[iconName] = gfxFile;
                    }
                }

                return {
                    gfxFiles: Object.values(gfxFileByIconName),
                    textureFiles: [],
                    gfxFileByIconName,
                    unresolvedIconNames: [],
                    textureExpiryByIconName: {},
                };
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve('../../src/util/loader/loader')];
delete require.cache[require.resolve('../../src/previewdef/focustree/focusspacing')];
delete require.cache[require.resolve('../../src/previewdef/focustree/loader')];

const {
    FocusTreeLoader,
} = require('../../src/previewdef/focustree/loader') as typeof import('../../src/previewdef/focustree/loader');
const {
    LoaderSession,
} = require('../../src/util/loader/loader') as typeof import('../../src/util/loader/loader');

nodeModule._load = originalLoad;

describe('focustree loader', () => {
    beforeEach(() => {
        focusIconResolutionCalls.length = 0;
        gfxIndexLookups.length = 0;
        focusIconFallbackLimits.length = 0;
    });

    it('propagates deferred asset loading to shared focus dependencies', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'deferred');
        const result = await loader.load(new LoaderSession(true));

        assert.strictEqual(result.result.deferredAssetLoad, true);
        assert.ok(result.dependencies.includes(sharedFocusFile));
        assert.deepStrictEqual(focusIconResolutionCalls, []);
    });

    it('keeps full asset loading for full shared focus dependency hydration', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        await loader.load(new LoaderSession(true));

        assert.ok(focusIconResolutionCalls.length >= 1);
        assert.ok(focusIconResolutionCalls.flat().includes('GFX_SHARED'));
    });

    it('uses the GFX index during full asset loading so icons do not require explicit dependency headers', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        const result = await loader.load(new LoaderSession(true));

        assert.ok(gfxIndexLookups.includes('GFX_LOCAL'));
        assert.strictEqual(result.result.focusIconGfxFileByName.GFX_LOCAL, indexedGfxFile);
        assert.ok(result.result.gfxFiles.includes(indexedGfxFile));
    });

    it('does not bound full focus icon fallback scans when icons are not indexed or explicitly declared', async () => {
        const loader = new FocusTreeLoader(mainFocusFile, undefined, 'full');
        await loader.load(new LoaderSession(true));

        assert.ok(focusIconFallbackLimits.length >= 1);
        assert.ok(focusIconFallbackLimits.every(limit => limit === undefined));
    });
});
