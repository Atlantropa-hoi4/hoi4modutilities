import * as assert from 'assert';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    featureFlags: [],
                }),
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const { extractFocusSpacing } = require('../../src/previewdef/focustree/focusspacing') as typeof import('../../src/previewdef/focustree/focusspacing');

describe('focus tree focus spacing helpers', () => {
    it('extracts focus spacing from national focus gui definitions', () => {
        const spacing = extractFocusSpacing(parseHoi4File(`
guiTypes = {
    containerWindowType = {
        name = national_focus
        focus_spacing = {
            x = 144
            y = 170
        }
    }
}`));

        assert.deepStrictEqual(spacing, { x: 144, y: 170 });
    });

    it('falls back when focus spacing is absent or incomplete', () => {
        const spacing = extractFocusSpacing(parseHoi4File(`
guiTypes = {
    containerWindowType = {
        name = national_focus
        focus_spacing = {
            x = 144
        }
    }
}`));

        assert.strictEqual(spacing, undefined);
    });
});
