import * as assert from 'assert';
import Module = require('module');

let readCount = 0;
const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            ProgressLocation: { Window: 1 },
            workspace: {
                fs: {
                    stat: async () => ({ size: 4 }),
                    readFile: async () => {
                        readCount++;
                        return new Uint8Array(5);
                    },
                },
            },
            window: {
                withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
            },
        };
    }

    if (request.endsWith('/image/previewlimits') || request.endsWith('\\image\\previewlimits')) {
        return {
            maxCustomEditorImageBytes: 4,
            isImagePreviewWithinLimit: (size: number) => size <= 4,
            formatByteSize: (size: number) => `${size} B`,
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { DDSViewProvider } = (() => {
    try {
        return require('../../src/ddsviewprovider') as typeof import('../../src/ddsviewprovider');
    } finally {
        nodeModule._load = originalLoad;
        delete require.cache[require.resolve('../../src/util/html')];
        delete require.cache[require.resolve('../../src/util/vsccommon')];
    }
})();

describe('custom image view provider', () => {
    it('blocks a file that grows beyond the limit after stat without decoding it', async () => {
        const provider = new TestDDSViewProvider();
        const webview = { options: {}, html: '' };
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose() {} }),
        };

        await provider.resolveCustomEditor(
            { uri: {} } as never,
            { webview } as never,
            token as never,
        );

        assert.strictEqual(readCount, 1);
        assert.strictEqual(provider.decodeCount, 0);
        assert.match(webview.html, /files&nbsp;larger&nbsp;than&nbsp;4&nbsp;B/);
        assert.match(webview.html, /This&nbsp;file&nbsp;is&nbsp;5&nbsp;B/);
    });
});

class TestDDSViewProvider extends DDSViewProvider {
    public decodeCount = 0;

    protected onOpen(): void {}

    protected getPng(_buffer: Buffer): never {
        this.decodeCount++;
        throw new Error('decode should not run');
    }
}
