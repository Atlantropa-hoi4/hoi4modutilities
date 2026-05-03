import * as assert from 'assert';
import Module = require('module');
import { PNG } from 'pngjs';

const TGA = require('tga') as typeof import('tga');
const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            commands: {
                registerCommand: () => ({ dispose() {} }),
            },
            workspace: {
                fs: {},
                getWorkspaceFolder: () => undefined,
            },
            window: {},
            ProgressLocation: {
                Notification: 15,
            },
            Uri: {
                joinPath: () => undefined,
            },
        };
    }

    if (request.endsWith('/i18n') || request === './i18n') {
        return {
            localize: (_key: string, message: string, ...args: unknown[]) =>
                message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    createFlagResizePlan,
    isSupportedFlagImageName,
    resizeFlagImageBuffer,
} = require('../../src/util/flagAutoResizer') as typeof import('../../src/util/flagAutoResizer');

nodeModule._load = originalLoad;

describe('flag auto resizer utility', () => {
    it('recognizes supported flag image names', () => {
        assert.strictEqual(isSupportedFlagImageName('KOR.tga'), true);
        assert.strictEqual(isSupportedFlagImageName('USA.PNG'), true);
        assert.strictEqual(isSupportedFlagImageName('readme.txt'), false);
    });

    it('plans only missing medium and small outputs', () => {
        const plan = createFlagResizePlan(
            ['KOR.tga', 'USA.png', 'notes.txt'],
            ['kor.TGA'],
            [],
        );

        assert.strictEqual(plan.supportedSourceCount, 2);
        assert.deepStrictEqual(plan.unsupportedFileNames, ['notes.txt']);
        assert.strictEqual(plan.skippedMediumCount, 1);
        assert.strictEqual(plan.skippedSmallCount, 0);
        assert.deepStrictEqual(plan.sources, [
            { fileName: 'KOR.tga', targets: ['small'] },
            { fileName: 'USA.png', targets: ['medium', 'small'] },
        ]);
    });

    it('resizes png flag buffers to requested dimensions', () => {
        const source = new PNG({ width: 2, height: 2 });
        source.data.set([
            255, 0, 0, 255,
            0, 255, 0, 255,
            0, 0, 255, 255,
            255, 255, 255, 255,
        ]);

        const resized = PNG.sync.read(resizeFlagImageBuffer(PNG.sync.write(source), 'KOR.png', { width: 10, height: 7 }));

        assert.strictEqual(resized.width, 10);
        assert.strictEqual(resized.height, 7);
        assert.strictEqual(resized.data.length, 10 * 7 * 4);
    });

    it('resizes tga flag buffers to requested dimensions', () => {
        const sourcePixels = Uint8Array.from([
            255, 0, 0, 255,
            0, 255, 0, 255,
            0, 0, 255, 255,
            255, 255, 255, 255,
        ]);
        const resized = new TGA(resizeFlagImageBuffer(TGA.createTgaBuffer(2, 2, sourcePixels), 'KOR.tga', { width: 41, height: 26 }));

        assert.strictEqual(resized.width, 41);
        assert.strictEqual(resized.height, 26);
        assert.strictEqual(resized.pixels?.length, 41 * 26 * 4);
    });
});
