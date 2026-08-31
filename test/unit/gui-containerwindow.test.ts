import * as assert from 'assert';
import Module = require('module');
import { GuiFile, guiFileSchema } from '../../src/hoiformat/gui';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { convertNodeToJson, HOIPartial } from '../../src/hoiformat/schema';
import type { ContainerWindowType } from '../../src/hoiformat/gui';
import { StyleTable } from '../../src/util/styletable';

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return { env: { language: 'en' } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const containerRenderer = require('../../src/util/hoi4gui/containerwindow') as typeof import('../../src/util/hoi4gui/containerwindow');
nodeModule._load = originalLoad;

describe('GUI container rendering', () => {
    it('preserves source order across common control types', async () => {
        const container = parseContainer(`
            buttonType = { name = "button" }
            editBoxType = { name = "edit" }
            dropDownBoxType = { name = "dropdown" }
            overlappingElementsBoxType = { name = "overlap" }
            smoothListBoxType = { name = "smooth" }
            listBoxType = { name = "list" }
            scrollbarType = { name = "scrollbar" }
            extendedScrollbarType = { name = "extended" }
            iconType = { name = "icon" }
            instantTextBoxType = { name = "text" }
            gridBoxType = { name = "grid" }
            containerWindowType = { name = "container" }
        `);
        const rendered = await containerRenderer.renderContainerWindowChildren(container, {
            size: { width: 500, height: 400 }, orientation: 'upper_left',
        }, {
            styleTable: new StyleTable(),
            onRenderChild: async (type, child) => `[${type}:${child.name}]`,
        });
        assert.deepStrictEqual(rendered.match(/\[[^\]]+\]/g), [
            '[button:button]', '[editbox:edit]', '[dropdownbox:dropdown]',
            '[overlappingelementsbox:overlap]', '[smoothlistbox:smooth]', '[listbox:list]',
            '[scrollbar:scrollbar]', '[extendedscrollbar:extended]', '[icon:icon]',
            '[instanttextbox:text]', '[gridbox:grid]', '[containerwindow:container]',
        ]);
    });
});

function parseContainer(children: string): HOIPartial<ContainerWindowType> {
    const gui = convertNodeToJson<GuiFile>(parseHoi4File(`guiTypes = { containerWindowType = { name = "root" size = { x = 500 y = 400 } ${children} } }`), guiFileSchema);
    return gui.guitypes[0].containerwindowtype[0];
}
