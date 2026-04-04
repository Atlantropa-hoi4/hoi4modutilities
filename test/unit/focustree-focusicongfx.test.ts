import * as assert from 'assert';
import { resolveFocusIconGfxFiles } from '../../src/previewdef/focustree/focusicongfx';

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
});
