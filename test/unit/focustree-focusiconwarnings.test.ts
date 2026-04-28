import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;

nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if ((request.endsWith('/util/i18n') || request === '../../util/i18n')
        && parent?.filename?.includes('focustree')) {
        return {
            localize: (_key: string, message: string, ...args: unknown[]) =>
                message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { addMissingFocusIconWarnings } = require('../../src/previewdef/focustree/focusiconwarnings') as typeof import('../../src/previewdef/focustree/focusiconwarnings');

describe('focus tree icon warnings', () => {
    after(() => {
        nodeModule._load = originalLoad;
    });

    it('adds one warning per focus and unresolved icon name', () => {
        const focusTree = {
            id: 'tree_a',
            focuses: {
                FOCUS_A: {
                    id: 'FOCUS_A',
                    icon: [
                        { icon: 'GFX_missing', condition: true },
                        { icon: 'GFX_missing', condition: true },
                        { icon: 'GFX_present', condition: true },
                    ],
                    file: 'common/national_focus/test.txt',
                    token: { start: 12, end: 34 },
                },
            },
            warnings: [],
        } as any;

        addMissingFocusIconWarnings([focusTree], ['GFX_missing', 'GFX_other_missing']);

        assert.strictEqual(focusTree.warnings.length, 1);
        assert.strictEqual(focusTree.warnings[0].code, 'focus-icon-gfx-missing');
        assert.strictEqual(focusTree.warnings[0].source, 'FOCUS_A');
        assert.strictEqual(focusTree.warnings[0].text, 'Focus FOCUS_A references missing icon GFX GFX_missing.');
        assert.deepStrictEqual(focusTree.warnings[0].relatedFocusIds, ['FOCUS_A']);
        assert.deepStrictEqual(focusTree.warnings[0].navigations, [{
            file: 'common/national_focus/test.txt',
            start: 12,
            end: 34,
        }]);
    });
});
