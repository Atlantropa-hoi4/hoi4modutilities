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
nodeModule._load = originalLoad;

describe('focus tree focus spacing helpers', () => {
    it('reads the original named position type with case-insensitive GUI field names', () => {
        const spacing = extractFocusSpacing(parseHoi4File(`
            GuiTypes = {
                PositionType = { NaMe = "FOCUS_SPACING" PoSiTiOn = { X = 144.5 Y = 170.25 } }
            }
        `));
        assert.deepStrictEqual(spacing, { x: 144.5, y: 170.25 });
    });

    it('resolves GUI constants in the position name and coordinate values', () => {
        const spacing = extractFocusSpacing(parseHoi4File(`
            @spacing_name = "focus_spacing"
            @spacing_x = 144
            @spacing_y = 170
            guiTypes = {
                positionType = { name = @spacing_name position = { x = @spacing_x y = @spacing_y } }
            }
        `));
        assert.deepStrictEqual(spacing, { x: 144, y: 170 });
    });

    it('prefers a valid named position over the legacy direct block and preserves the legacy fallback', () => {
        const direct = 'containerWindowType = { name = national_focus focus_spacing = { x = 100 y = 150 } }';
        assert.deepStrictEqual(extractFocusSpacing(parseHoi4File(`guiTypes = {
            ${direct} positionType = { name = focus_spacing position = { x = 144 y = 170 } }
        }`)), { x: 144, y: 170 });
        assert.deepStrictEqual(extractFocusSpacing(parseHoi4File(`guiTypes = {
            ${direct} positionType = { name = focus_spacing position = { x = invalid y = 170 } }
        }`)), { x: 100, y: 150 });
    });

    it('leaves invalid, incomplete and unrelated positions to the existing renderer defaults', () => {
        for (const value of ['NaN', 'Infinity', '1%', '@missing', '"144"', '9'.repeat(400)]) {
            assert.strictEqual(extractFocusSpacing(parseHoi4File(`guiTypes = {
                positionType = { name = focus_spacing position = { x = ${value} y = 170 } }
            }`)), undefined, value);
        }
        assert.strictEqual(extractFocusSpacing(parseHoi4File('guiTypes = { positionType = { name = focus_spacing position = { x = 144 } } }')), undefined);
        assert.strictEqual(extractFocusSpacing(parseHoi4File('guiTypes = { positionType = { name = other_spacing position = { x = 144 y = 170 } } }')), undefined);
    });

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
