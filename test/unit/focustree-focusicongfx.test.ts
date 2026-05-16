import * as assert from 'assert';
import { resolveFocusIconGfxAssets, resolveFocusIconGfxFiles } from '../../src/previewdef/focustree/focusicongfx';

describe('focus icon gfx resolver', () => {
    it('keeps indexed files and only scans unresolved icon names', async () => {
        const scannedFiles: string[] = [];
        const result = await resolveFocusIconGfxFiles(
            ['GFX_indexed', 'GFX_missing_one', 'GFX_missing_two', 'GFX_indexed'],
            {
                resolveIndexedFile: async (gfxName) => gfxName === 'GFX_indexed' ? 'interface/indexed.gfx' : undefined,
                listInterfaceGfxFiles: async () => [
                    'interface/first.gfx',
                    'interface/second.gfx',
                    'interface/third.gfx',
                ],
                readSpriteNames: async (gfxFile) => {
                    scannedFiles.push(gfxFile);
                    if (gfxFile === 'interface/first.gfx') {
                        return ['GFX_missing_one'];
                    }
                    if (gfxFile === 'interface/second.gfx') {
                        return ['GFX_missing_two', 'GFX_other'];
                    }
                    return ['GFX_unused'];
                },
            },
        );

        assert.deepStrictEqual(result.sort(), [
            'interface/first.gfx',
            'interface/indexed.gfx',
            'interface/second.gfx',
        ]);
        assert.deepStrictEqual(scannedFiles, [
            'interface/first.gfx',
            'interface/second.gfx',
        ]);
    });

    it('returns unique files when multiple icons come from the same fallback gfx file', async () => {
        const result = await resolveFocusIconGfxFiles(
            ['GFX_alpha', 'GFX_beta'],
            {
                resolveIndexedFile: async () => undefined,
                listInterfaceGfxFiles: async () => ['interface/shared.gfx'],
                readSpriteNames: async () => ['GFX_alpha', 'GFX_beta'],
            },
        );

        assert.deepStrictEqual(result, ['interface/shared.gfx']);
    });

    it('does not scan interface gfx files for the edit-template placeholder icon name', async () => {
        const indexedLookups: string[] = [];
        let listedInterfaceFiles = false;
        const result = await resolveFocusIconGfxAssets(
            ['GFX', 'GFX_indexed'],
            {
                resolveIndexedFile: async (gfxName) => {
                    indexedLookups.push(gfxName);
                    return gfxName === 'GFX_indexed' ? 'interface/indexed.gfx' : undefined;
                },
                listInterfaceGfxFiles: async () => {
                    listedInterfaceFiles = true;
                    return ['interface/slow-scan.gfx'];
                },
                readSpriteNames: async () => ['GFX'],
                readSpriteTextureFiles: async () => ({
                    GFX_indexed: 'gfx/interface/goals/indexed.dds',
                }),
            },
        );

        assert.deepStrictEqual(indexedLookups, ['GFX_indexed']);
        assert.strictEqual(listedInterfaceFiles, false);
        assert.deepStrictEqual(result.gfxFileByIconName, {
            GFX_indexed: 'interface/indexed.gfx',
        });
        assert.deepStrictEqual(result.unresolvedIconNames, []);
    });

    it('skips unreadable or unparsable gfx files during fallback scanning', async () => {
        const scannedFiles: string[] = [];
        const result = await resolveFocusIconGfxFiles(
            ['GFX_target'],
            {
                resolveIndexedFile: async () => undefined,
                listInterfaceGfxFiles: async () => [
                    'interface/broken.gfx',
                    'interface/valid.gfx',
                ],
                readSpriteNames: async (gfxFile) => {
                    scannedFiles.push(gfxFile);
                    if (gfxFile === 'interface/broken.gfx') {
                        throw new Error('parse failure');
                    }
                    return ['GFX_target'];
                },
            },
        );

        assert.deepStrictEqual(result, ['interface/valid.gfx']);
        assert.deepStrictEqual(scannedFiles, [
            'interface/broken.gfx',
            'interface/valid.gfx',
        ]);
    });

    it('respects the fallback scan limit and leaves later matches unresolved', async () => {
        const scannedFiles: string[] = [];
        const result = await resolveFocusIconGfxAssets(
            ['GFX_first', 'GFX_late'],
            {
                resolveIndexedFile: async () => undefined,
                listInterfaceGfxFiles: async () => [
                    'interface/first.gfx',
                    'interface/second.gfx',
                    'interface/third.gfx',
                ],
                readSpriteNames: async (gfxFile) => {
                    scannedFiles.push(gfxFile);
                    if (gfxFile === 'interface/first.gfx') {
                        return ['GFX_first'];
                    }
                    if (gfxFile === 'interface/third.gfx') {
                        return ['GFX_late'];
                    }
                    return [];
                },
                fallbackScanLimit: 2,
            },
        );

        assert.deepStrictEqual(scannedFiles, [
            'interface/first.gfx',
            'interface/second.gfx',
        ]);
        assert.deepStrictEqual(result.gfxFileByIconName, {
            GFX_first: 'interface/first.gfx',
        });
        assert.deepStrictEqual(result.unresolvedIconNames, ['GFX_late']);
    });

    it('scans explicit priority gfx files before applying the fallback scan limit', async () => {
        const scannedFiles: string[] = [];
        const result = await resolveFocusIconGfxAssets(
            ['GFX_priority_a', 'GFX_priority_b'],
            {
                resolveIndexedFile: async () => undefined,
                listInterfaceGfxFiles: async () => [
                    'interface/first.gfx',
                    'interface/second.gfx',
                    'interface/priority_a.gfx',
                    'interface/priority_b.gfx',
                ],
                readSpriteNames: async (gfxFile) => {
                    scannedFiles.push(gfxFile);
                    if (gfxFile === 'interface/priority_a.gfx') {
                        return ['GFX_priority_a'];
                    }
                    if (gfxFile === 'interface/priority_b.gfx') {
                        return ['GFX_priority_b'];
                    }
                    return [];
                },
                priorityGfxFiles: ['interface/priority_a.gfx', 'interface/priority_b.gfx'],
                fallbackScanLimit: 1,
            },
        );

        assert.deepStrictEqual(scannedFiles, [
            'interface/priority_a.gfx',
            'interface/priority_b.gfx',
        ]);
        assert.deepStrictEqual(result.gfxFileByIconName, {
            GFX_priority_a: 'interface/priority_a.gfx',
            GFX_priority_b: 'interface/priority_b.gfx',
        });
        assert.deepStrictEqual(result.unresolvedIconNames, []);
    });

    it('lets explicit priority gfx files override stale indexed files', async () => {
        const scannedFiles: string[] = [];
        const indexedLookups: string[] = [];
        const result = await resolveFocusIconGfxAssets(
            ['GFX_icon'],
            {
                resolveIndexedFile: async (gfxName) => {
                    indexedLookups.push(gfxName);
                    return 'interface/indexed.gfx';
                },
                listInterfaceGfxFiles: async () => ['interface/indexed.gfx'],
                readSpriteNames: async (gfxFile) => {
                    scannedFiles.push(gfxFile);
                    return gfxFile === 'interface/priority.gfx' ? ['GFX_icon'] : [];
                },
                readSpriteTextureFiles: async (gfxFile) => {
                    if (gfxFile === 'interface/priority.gfx') {
                        return { GFX_icon: 'gfx/interface/goals/priority.dds' };
                    }
                    return { GFX_icon: 'gfx/interface/goals/indexed.dds' };
                },
                priorityGfxFiles: ['interface/priority.gfx'],
            },
        );

        assert.deepStrictEqual(scannedFiles, ['interface/priority.gfx']);
        assert.deepStrictEqual(indexedLookups, []);
        assert.deepStrictEqual(result.gfxFileByIconName, {
            GFX_icon: 'interface/priority.gfx',
        });
        assert.deepStrictEqual(result.textureFileByIconName, {
            GFX_icon: 'gfx/interface/goals/priority.dds',
        });
    });

    it('returns texture files for matched indexed and fallback sprites', async () => {
        const result = await resolveFocusIconGfxAssets(
            ['GFX_indexed', 'GFX_fallback', 'GFX_unresolved'],
            {
                resolveIndexedFile: async (gfxName) => gfxName === 'GFX_indexed' ? 'interface/indexed.gfx' : undefined,
                listInterfaceGfxFiles: async () => ['interface/fallback.gfx'],
                readSpriteNames: async () => ['GFX_fallback'],
                readSpriteTextureFiles: async (gfxFile) => {
                    if (gfxFile === 'interface/indexed.gfx') {
                        return { GFX_indexed: 'gfx/interface/goals/indexed.dds' };
                    }
                    if (gfxFile === 'interface/fallback.gfx') {
                        return {
                            GFX_fallback: 'gfx\\interface\\goals\\fallback.tga',
                            GFX_other: 'gfx/interface/goals/other.dds',
                        };
                    }
                    return {};
                },
            },
        );

        assert.deepStrictEqual(result.gfxFiles.sort(), [
            'interface/fallback.gfx',
            'interface/indexed.gfx',
        ]);
        assert.deepStrictEqual(result.gfxFileByIconName, {
            GFX_fallback: 'interface/fallback.gfx',
            GFX_indexed: 'interface/indexed.gfx',
        });
        assert.deepStrictEqual(result.textureFiles.sort(), [
            'gfx/interface/goals/fallback.tga',
            'gfx/interface/goals/indexed.dds',
        ]);
        assert.deepStrictEqual(result.unresolvedIconNames, ['GFX_unresolved']);
    });

    it('includes texture expiry tokens in the style signature', async () => {
        const first = await resolveFocusIconGfxAssets(
            ['GFX_icon'],
            {
                resolveIndexedFile: async () => 'interface/icons.gfx',
                listInterfaceGfxFiles: async () => [],
                readSpriteNames: async () => [],
                readSpriteTextureFiles: async () => ({ GFX_icon: 'gfx/interface/goals/icon.dds' }),
                readTextureExpiryToken: async () => 'mtime-1',
            },
        );
        const second = await resolveFocusIconGfxAssets(
            ['GFX_icon'],
            {
                resolveIndexedFile: async () => 'interface/icons.gfx',
                listInterfaceGfxFiles: async () => [],
                readSpriteNames: async () => [],
                readSpriteTextureFiles: async () => ({ GFX_icon: 'gfx/interface/goals/icon.dds' }),
                readTextureExpiryToken: async () => 'mtime-2',
            },
        );

        assert.deepStrictEqual(first.textureFileByIconName, {
            GFX_icon: 'gfx/interface/goals/icon.dds',
        });
        assert.deepStrictEqual(first.textureExpiryTokenByIconName, {
            GFX_icon: 'mtime-1',
        });
        assert.notStrictEqual(first.styleSignature, second.styleSignature);
    });
});
