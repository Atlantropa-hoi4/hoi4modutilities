import { HOIPartial } from '../../hoiformat/schema';
import { calculateBBox, normalizeMargin, ParentInfo, removeHtmlOptions } from './common';
import { renderIcon } from './icon';
import { renderInstantTextBox } from './instanttextbox';
import { renderGridBox } from './gridbox';
import { ButtonType, ContainerWindowType, DropdownBoxType, EditBoxType, ExtendedScrollbarType, GridBoxType, IconType, InstantTextBoxType, ListBoxType, OverlappingElementsBoxType, ScrollbarType, SmoothListBoxType } from '../../hoiformat/gui';
import { renderBackground, RenderNodeCommonOptions } from './nodecommon';
import { renderButton } from './button';
import { renderDropdownBox } from './dropdownbox';
import { renderEditBox } from './editbox';
import { renderListBox, renderOverlappingElementsBox, renderSmoothListBox } from './layoutbox';
import { renderExtendedScrollbar, renderScrollbar } from './scrollbar';

export interface RenderChildTypeMap {
    containerwindow: HOIPartial<ContainerWindowType>; gridbox: HOIPartial<GridBoxType>;
    icon: HOIPartial<IconType>; instanttextbox: HOIPartial<InstantTextBoxType>; button: HOIPartial<ButtonType>;
    editbox: HOIPartial<EditBoxType>; dropdownbox: HOIPartial<DropdownBoxType>;
    overlappingelementsbox: HOIPartial<OverlappingElementsBoxType>; smoothlistbox: HOIPartial<SmoothListBoxType>;
    listbox: HOIPartial<ListBoxType>; scrollbar: HOIPartial<ScrollbarType>; extendedscrollbar: HOIPartial<ExtendedScrollbarType>;
}

export interface RenderContainerWindowOptions extends RenderNodeCommonOptions {
    noSize?: boolean; ignorePosition?: boolean; useShowPosition?: boolean;
    onRenderChild?<T extends keyof RenderChildTypeMap>(type: T, child: RenderChildTypeMap[T], parentInfo: ParentInfo): Promise<string | undefined>;
}

interface CommonChildCollection {
    containerwindowtype: HOIPartial<ContainerWindowType>[]; icontype: HOIPartial<IconType>[];
    instanttextboxtype: HOIPartial<InstantTextBoxType>[]; buttontype: HOIPartial<ButtonType>[]; editboxtype: HOIPartial<EditBoxType>[];
}

export async function renderContainerWindow(containerWindow: HOIPartial<ContainerWindowType>, parentInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<string> {
    const position = options.useShowPosition ? containerWindow.show_position ?? containerWindow.position : containerWindow.position;
    const [x, y, width, height, orientation] = calculateBBox({ ...containerWindow, position }, parentInfo);
    const size = { width, height };
    const margin = normalizeMargin(containerWindow.margin, size);
    const myInfo: ParentInfo = { size: { width: width - margin[1] - margin[3], height: height - margin[0] - margin[2] }, orientation };
    const background = await renderBackground(containerWindow.background, { size, orientation }, options);
    const children = await renderContainerWindowChildren(containerWindow, myInfo, { ...options, ignorePosition: undefined });
    return `<div ${options.id ? `id="${options.id}"` : ''} start="${containerWindow._token?.start}" end="${containerWindow._token?.end}" class="${options.classNames ?? ''} ${options.styleTable.style('positionAbsolute', () => `position:absolute;`)} ${options.styleTable.style('borderBox', () => `box-sizing:border-box;`)} ${options.styleTable.oneTimeStyle('containerwindow', () => `left:${options.ignorePosition ? 0 : x}px;top:${options.ignorePosition ? 0 : y}px;width:${options.noSize ? 0 : width}px;height:${options.noSize ? 0 : height}px;`)} ${options.enableNavigator ? 'navigator navigator-highlight' : ''}">${background}<div class="${options.styleTable.style('positionAbsolute', () => `position:absolute;`)} ${options.styleTable.oneTimeStyle('containerwindowChildren', () => `left:${margin[3]}px;top:${margin[0]}px;`)}">${children}</div></div>`;
}

export async function renderContainerWindowChildren(containerWindow: HOIPartial<ContainerWindowType>, myInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<string> {
    const common = renderCommonChildren({
        containerwindowtype: [...containerWindow.containerwindowtype, ...containerWindow.windowtype],
        icontype: containerWindow.icontype,
        instanttextboxtype: [...containerWindow.instanttextboxtype, ...containerWindow.textboxtype],
        buttontype: [...containerWindow.buttontype, ...containerWindow.checkboxtype, ...containerWindow.guibuttontype],
        editboxtype: containerWindow.editboxtype,
    }, myInfo, options);
    const grid = containerWindow.gridboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'gridbox', c, myInfo, child => renderGridBox(child, myInfo, removeHtmlOptions({ ...options, items: {} }))));
    const dropdown = containerWindow.dropdownboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'dropdownbox', c, myInfo, child => renderDropdownBox(child, myInfo, { ...removeHtmlOptions(options), renderChildren: (box, info) => renderDropdownBoxChildren(box, info, options) })));
    const overlap = containerWindow.overlappingelementsboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'overlappingelementsbox', c, myInfo, child => renderOverlappingElementsBox(child, myInfo, removeHtmlOptions(options))));
    const smooth = containerWindow.smoothlistboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'smoothlistbox', c, myInfo, child => renderSmoothListBox(child, myInfo, removeHtmlOptions(options))));
    const list = containerWindow.listboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'listbox', c, myInfo, child => renderListBox(child, myInfo, removeHtmlOptions(options))));
    const scroll = containerWindow.scrollbartype.map(c => onRenderChildOrDefault(options.onRenderChild, 'scrollbar', c, myInfo, child => renderScrollbar(child, myInfo, removeHtmlOptions(options))));
    const extended = containerWindow.extendedscrollbartype.map(c => onRenderChildOrDefault(options.onRenderChild, 'extendedscrollbar', c, myInfo, child => renderExtendedScrollbar(child, myInfo, removeHtmlOptions(options))));
    return joinChildrenInOrder([...common, ...grid, ...dropdown, ...overlap, ...smooth, ...list, ...scroll, ...extended]);
}

async function renderDropdownBoxChildren(box: HOIPartial<DropdownBoxType>, myInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<string> {
    const children = renderCommonChildren(box, myInfo, options);
    const expand = box.expandbutton ? onRenderChildOrDefault(options.onRenderChild, 'button', box.expandbutton, myInfo, button => renderButton(button, myInfo, { ...removeHtmlOptions(options), classNames: 'gui-dropdown-button', enableNavigator: undefined })) : undefined;
    const expanded = box.expandedwindow ? renderDropdownExpandedWindow(box.expandedwindow, myInfo, options) : undefined;
    return joinChildrenInOrder([...children, ...(expand ? [expand] : []), ...(expanded ? [expanded] : [])]);
}

function renderCommonChildren(children: CommonChildCollection, myInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<[number, string]>[] {
    return [
        ...children.containerwindowtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'containerwindow', c, myInfo, child => renderContainerWindow(child, myInfo, removeHtmlOptions(options)))),
        ...children.icontype.map(c => onRenderChildOrDefault(options.onRenderChild, 'icon', c, myInfo, child => renderIcon(child, myInfo, removeHtmlOptions(options)))),
        ...children.instanttextboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'instanttextbox', c, myInfo, child => renderInstantTextBox(child, myInfo, removeHtmlOptions(options)))),
        ...children.buttontype.map(c => onRenderChildOrDefault(options.onRenderChild, 'button', c, myInfo, child => renderButton(child, myInfo, removeHtmlOptions(options)))),
        ...children.editboxtype.map(c => onRenderChildOrDefault(options.onRenderChild, 'editbox', c, myInfo, child => renderEditBox(child, myInfo, removeHtmlOptions(options)))),
    ];
}

async function renderDropdownExpandedWindow(window: HOIPartial<ContainerWindowType>, myInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<[number, string]> {
    const [order, content] = await onRenderChildOrDefault(options.onRenderChild, 'containerwindow', window, myInfo, child => renderContainerWindow(child, myInfo, { ...removeHtmlOptions(options), useShowPosition: true }));
    return [order, `<div class="gui-dropdown-expanded" hidden>${content}</div>`];
}

async function joinChildrenInOrder(children: Promise<[number, string]>[]): Promise<string> {
    const result = await Promise.all(children); result.sort((a, b) => a[0] - b[0]); return result.map(value => value[1]).join('');
}

export async function onRenderChildOrDefault<T extends keyof RenderChildTypeMap>(onRenderChild: RenderContainerWindowOptions['onRenderChild'], type: T, child: RenderChildTypeMap[T], parentInfo: ParentInfo, defaultRenderer: (value: RenderChildTypeMap[T]) => Promise<string>): Promise<[number, string]> {
    const custom = onRenderChild ? await onRenderChild(type, child, parentInfo) : undefined;
    return [child._token?.start ?? 0, custom !== undefined ? custom : await defaultRenderer(child)];
}
