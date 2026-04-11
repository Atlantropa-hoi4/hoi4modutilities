import * as assert from 'assert';
import { resolveInlayGfxNames, resolveInlayGuiWindowLookup } from '../../src/previewdef/focustree/inlayshared';

describe('focus tree inlay helpers', () => {
    it('keeps indexed inlay gfx files and only scans unresolved names', async () => {
        const scannedFiles: string[] = [];
        const result = await resolveInlayGfxNames(
            ['GFX_indexed', 'GFX_missing_one', 'GFX_missing_two', 'GFX_indexed'],
            {
                resolveIndexedFile: async gfxName => gfxName === 'GFX_indexed' ? 'interface/indexed.gfx' : undefined,
                listInterfaceGfxFiles: async () => [
                    'interface/first.gfx',
                    'interface/second.gfx',
                    'interface/third.gfx',
                ],
                readSpriteNames: async gfxFile => {
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

        assert.deepStrictEqual(result, {
            GFX_indexed: 'interface/indexed.gfx',
            GFX_missing_one: 'interface/first.gfx',
            GFX_missing_two: 'interface/second.gfx',
        });
        assert.deepStrictEqual(scannedFiles, [
            'interface/first.gfx',
            'interface/second.gfx',
        ]);
    });

    it('applies resolved gui windows and only returns matched gui dependencies', () => {
        const resolvedWindow = { name: 'sample_window' } as any;
        const inlays = [
            {
                id: 'test_inlay',
                file: 'common/focus_inlay_windows/test.txt',
                windowName: 'sample_window',
                scriptedImages: [],
                scriptedButtons: [],
                conditionExprs: [],
                position: { x: 0, y: 0 },
                visible: true,
                internal: false,
            },
            {
                id: 'missing_inlay',
                file: 'common/focus_inlay_windows/test.txt',
                windowName: 'missing_window',
                scriptedImages: [],
                scriptedButtons: [],
                conditionExprs: [],
                position: { x: 0, y: 0 },
                visible: true,
                internal: false,
            },
        ] as any[];

        const result = resolveInlayGuiWindowLookup(inlays as any, {
            sample_window: {
                file: 'interface/sample.gui',
                window: resolvedWindow,
            },
        });

        assert.deepStrictEqual(result.guiFiles, ['interface/sample.gui']);
        assert.strictEqual(result.warnings.length, 1);
        assert.strictEqual(result.warnings[0]?.code, 'inlay-gui-window-missing');
        assert.strictEqual(inlays[0].guiFile, 'interface/sample.gui');
        assert.strictEqual(inlays[0].guiWindow, resolvedWindow);
        assert.strictEqual(inlays[1].guiFile, undefined);
        assert.strictEqual(inlays[1].guiWindow, undefined);
    });
});
