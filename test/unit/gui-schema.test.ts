import * as assert from 'assert';
import { GuiFile, guiFileSchema } from '../../src/hoiformat/gui';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson } from '../../src/hoiformat/schema';

describe('GUI schema', () => {
    it('parses fullscreen windows', () => {
        const gui = convertNodeToJson<GuiFile>(parseHoi4File(`
            guiTypes = {
                windowType = {
                    name = "fullscreen_window"
                    fullscreen = yes
                }
            }
        `), guiFileSchema);

        assert.strictEqual(gui.guitypes[0].windowtype[0].fullscreen, true);
    });

    it('parses common layout, input, dropdown, and scrollbar controls', () => {
        const gui = convertNodeToJson<GuiFile>(parseHoi4File(`
            guiTypes = {
                containerWindowType = {
                    name = "controls"
                    editBoxType = { name = "name" borderSize = { x = 3 y = 2 } }
                    listBoxType = { name = "list" }
                    smoothListBoxType = { name = "smooth" }
                    overlappingElementsBoxType = { name = "overlap" }
                    dropDownBoxType = {
                        name = "dropdown"
                        editBoxType = { name = "dropdown_edit" }
                        expandButton = { name = "expand" spriteType = "GFX_button" }
                        expandedWindow = { name = "expanded" show_position = { x = 0 y = 25 } }
                    }
                    extendedScrollbarType = { name = "extended" slider = { name = "slider" spriteType = "GFX_slider" } }
                }
                scrollbarType = {
                    name = "top_level" horizontal = 1 slider = "slider" track = "track"
                    leftButton = "left" rightButton = "right"
                    guiButtonType = { parent = "slider" name = "down" }
                }
            }
        `), guiFileSchema);
        const types = gui.guitypes[0];
        const container = types.containerwindowtype[0];

        assert.strictEqual(container.editboxtype[0].bordersize!.x?._value, 3);
        assert.strictEqual(container.listboxtype.length, 1);
        assert.strictEqual(container.smoothlistboxtype.length, 1);
        assert.strictEqual(container.overlappingelementsboxtype.length, 1);
        assert.strictEqual(container.dropdownboxtype[0].expandbutton!.name, 'expand');
        assert.strictEqual(container.dropdownboxtype[0].expandedwindow!.show_position!.y?._value, 25);
        assert.strictEqual(container.extendedscrollbartype[0].slider!.name, 'slider');
        assert.strictEqual(types.scrollbartype[0].horizontal, 1);
        assert.strictEqual(types.scrollbartype[0].guibuttontype[0].parent, 'slider');
    });
});
