import * as assert from 'assert';
import Module = require('module');
import type { Point } from '../../src/previewdef/worldmap/definitions';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        class EventEmitter<T> {
            public event = (_listener: (value: T) => unknown) => ({ dispose: () => undefined });
            public fire(_value: T): void { }
        }

        return {
            EventEmitter,
            l10n: { t: (_key: string, fallback: string) => fallback },
            env: { language: 'en' },
            workspace: {
                getConfiguration: () => ({}),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { concatEdgesForTest } = require('../../src/previewdef/worldmap/loader/provincebmp') as typeof import('../../src/previewdef/worldmap/loader/provincebmp');

function point(x: number, y: number): Point {
    return { x, y };
}

describe('world map province bmp edge helpers', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('concatenates adjacent edge segments without scanning the whole list repeatedly', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(1, 0), point(2, 0)],
        ]);

        assert.deepStrictEqual(result, [[point(0, 0), point(2, 0)]]);
    });

    it('keeps disconnected edge segments as separate paths', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(5, 0), point(6, 0)],
        ]);

        assert.deepStrictEqual(result, [
            [point(0, 0), point(1, 0)],
            [point(5, 0), point(6, 0)],
        ]);
    });

    it('preserves loop-like paths while compacting straight runs', () => {
        const result = concatEdgesForTest([
            [point(0, 0), point(1, 0)],
            [point(1, 0), point(1, 1)],
            [point(1, 1), point(0, 1)],
            [point(0, 1), point(0, 0)],
        ]);

        assert.strictEqual(result.length, 1);
        assert.deepStrictEqual(result[0][0], result[0][result[0].length - 1]);
        assert.deepStrictEqual(
            new Set(result[0].map(p => `${p.x},${p.y}`)),
            new Set(['0,0', '1,0', '1,1', '0,1']),
        );
    });
});
