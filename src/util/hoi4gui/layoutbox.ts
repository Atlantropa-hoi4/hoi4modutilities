import { ListBoxType, OverlappingElementsBoxType, SmoothListBoxType } from '../../hoiformat/gui';
import { HOIPartial } from '../../hoiformat/schema';
import { calculateBBox, ParentInfo } from './common';
import { RenderNodeCommonOptions, renderSprite } from './nodecommon';

type LayoutBox = HOIPartial<ListBoxType> | HOIPartial<OverlappingElementsBoxType> | HOIPartial<SmoothListBoxType>;

export async function renderListBox(box: HOIPartial<ListBoxType>, parent: ParentInfo, options: RenderNodeCommonOptions): Promise<string> { return renderLayoutBox(box, parent, options, box.background); }
export async function renderOverlappingElementsBox(box: HOIPartial<OverlappingElementsBoxType>, parent: ParentInfo, options: RenderNodeCommonOptions): Promise<string> { return renderLayoutBox(box, parent, options); }
export async function renderSmoothListBox(box: HOIPartial<SmoothListBoxType>, parent: ParentInfo, options: RenderNodeCommonOptions): Promise<string> { return renderLayoutBox(box, parent, options); }

async function renderLayoutBox(box: LayoutBox, parentInfo: ParentInfo, options: RenderNodeCommonOptions, backgroundSprite?: string): Promise<string> {
    const [x, y, width, height] = calculateBBox(box, parentInfo);
    const image = options.getSprite && backgroundSprite ? await options.getSprite(backgroundSprite, 'bg', box.name) : undefined;
    const background = image ? renderSprite({ x: 0, y: 0 }, { width, height }, image, 0, 1, options) : '';
    return `<div start="${box._token?.start}" end="${box._token?.end}" class="${options.styleTable.style('positionAbsolute', () => `position:absolute;`)} ${options.styleTable.style('borderBox', () => `box-sizing:border-box;`)} ${options.styleTable.oneTimeStyle('layoutbox', () => `left:${x}px;top:${y}px;width:${width}px;height:${height}px;`)} ${options.enableNavigator ? 'navigator navigator-highlight' : ''}">${background}</div>`;
}
