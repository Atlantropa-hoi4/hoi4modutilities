import { ContainerWindowType, IconType, InstantTextBoxType } from '../../hoiformat/gui';
import { Node, parseHoi4File } from '../../hoiformat/hoiparser';
import { convertNodeToJson, HOIPartial } from '../../hoiformat/schema';
import { ContentLoader, LoadResultOD } from '../../util/loader/loader';
import { StyleTable } from '../../util/styletable';
import { calculateBBox, ParentInfo } from '../../util/hoi4gui/common';
import { renderContainerWindow, RenderContainerWindowOptions } from '../../util/hoi4gui/containerwindow';
import { renderIcon } from '../../util/hoi4gui/icon';
import { renderButton } from '../../util/hoi4gui/button';
import { renderInstantTextBox } from '../../util/hoi4gui/instanttextbox';
import { getSpriteByGfxName } from '../../util/image/imagecache';
import type { Focus } from './schema';
import { focusCardPlaceholders, renderFocusGuiLabel } from './cardtemplate';

export interface FocusTitleStyle { name?: string; default?: boolean; unavailable?: string }
export interface FocusPresentation {
    item?: HOIPartial<ContainerWindowType>;
    continuous?: HOIPartial<ContainerWindowType>;
    styles: FocusTitleStyle[];
}

export function parseFocusTitleStyles(node: Node): FocusTitleStyle[] {
    return convertNodeToJson<{ style: FocusTitleStyle[] }>(node, {
        style: { _type: 'array', _innerType: { name: 'string', default: 'boolean', unavailable: 'string' } },
    }).style.filter(style => !!style.name && !!style.unavailable);
}

export class FocusTitleStyleLoader extends ContentLoader<FocusTitleStyle[]> {
    protected async postLoad(content: string | undefined, _dependencies: never[], error: unknown): Promise<LoadResultOD<FocusTitleStyle[]>> {
        if (content === undefined || error) { throw error; }
        return { result: parseFocusTitleStyles(parseHoi4File(content)) };
    }
}

export function findFocusWindow(windows: HOIPartial<ContainerWindowType>[], name: string): HOIPartial<ContainerWindowType> | undefined {
    for (const window of windows) {
        if (window.name === name) { return window; }
        const nested = findFocusWindow([...window.containerwindowtype, ...window.windowtype], name);
        if (nested) { return nested; }
    }
    return undefined;
}

const screen: ParentInfo = { size: { width: 1920, height: 1080 }, orientation: 'upper_left' };

// These controls require live game state; their GUI defaults are not focus decorations.
const runtimeFocusControls = new Set([
    'continuous_glow', 'highlight_glow', 'historical', 'viewing_flag', 'viewing_flag_border',
]);

export async function renderFocusGui(focus: Focus, presentation: FocusPresentation | undefined, styleTable: StyleTable,
    gfxFiles: string[], xGridSize: number, yGridSize: number, localizedText?: string): Promise<string | undefined> {
    if (!presentation?.item) { return undefined; }
    const template = await renderFocusGuiTemplate(presentation.item, resolveFocusGuiBackground(presentation, focus),
        focus.overlay, styleTable, gfxFiles, xGridSize, yGridSize);
    return applyFocusGuiLabel(template, focus, localizedText);
}

/**
 * Renders each GUI variant (title background and overlay) once per style table. Focus cards of
 * one variant differ only in their label, so a large tree needs a handful of GUI renders.
 */
export class FocusGuiRenderer {
    private readonly templates = new Map<string, Promise<string>>();

    constructor(
        private readonly presentation: FocusPresentation | undefined,
        private readonly styleTable: StyleTable,
        private readonly gfxFiles: string[],
        private readonly xGridSize: number,
        private readonly yGridSize: number,
    ) {}

    /** GUI markup of the focus's variant, with the label left as a placeholder. */
    public renderTemplate(focus: Pick<Focus, 'textIcon' | 'overlay'>): Promise<string> | undefined {
        const item = this.presentation?.item;
        if (!item) { return undefined; }
        const background = resolveFocusGuiBackground(this.presentation!, focus);
        const key = `${background}\u0000${focus.overlay ?? ''}`;
        let template = this.templates.get(key);
        if (!template) {
            template = renderFocusGuiTemplate(item, background, focus.overlay, this.styleTable, this.gfxFiles,
                this.xGridSize, this.yGridSize);
            this.templates.set(key, template);
        }
        return template;
    }

    public async render(focus: Focus, localizedText?: string): Promise<string | undefined> {
        const template = this.renderTemplate(focus);
        return template && applyFocusGuiLabel(await template, focus, localizedText);
    }
}

function resolveFocusGuiBackground(presentation: FocusPresentation, focus: Pick<Focus, 'textIcon'>): string {
    const titleStyle = presentation.styles.find(style => focus.textIcon ? style.name === focus.textIcon : style.default);
    return titleStyle?.unavailable ?? 'GFX_focus_unavailable';
}

function applyFocusGuiLabel(template: string, focus: Pick<Focus, 'id'>, localizedText: string | undefined): string {
    const label = renderFocusGuiLabel(focus.id, localizedText ?? focus.id);
    return template.replace(focusCardPlaceholders.label, () => label);
}

async function renderFocusGuiTemplate(item: HOIPartial<ContainerWindowType>, background: string, overlay: string | undefined,
    styleTable: StyleTable, gfxFiles: string[], xGridSize: number, yGridSize: number): Promise<string> {
    const [,, width, height] = calculateBBox(item, screen);
    const common = { styleTable, getSprite: (name: string) => getSpriteByGfxName(name, gfxFiles) };
    const focusNameClass = styleTable.style('focus-gui-name', () =>
        'z-index:2;pointer-events:none;');
    const onRenderChild: RenderContainerWindowOptions['onRenderChild'] = async (type, child, parent) => {
        if (child.name && runtimeFocusControls.has(child.name)) { return ''; }
        if (type === 'containerwindow') {
            return renderContainerWindow(child as HOIPartial<ContainerWindowType>, parent, { ...common, onRenderChild });
        }
        if ((type === 'icon' || type === 'button') && child.name === 'symbol') {
            const icon = child as HOIPartial<IconType>;
            const [x, y] = calculateBBox(icon, parent);
            const css = styleTable.oneTimeStyle('focus-gui-symbol', () =>
                `position:absolute;left:${x}px;top:${y}px;transform:${icon.centerposition ? 'translate(-50%, -50%) ' : ''}scale(${icon.scale ?? 1});transform-origin:${icon.centerposition ? 'center' : 'top left'};pointer-events:none;`);
            return `<div class="{{iconClass}} focus-gui-symbol ${css}"></div>`;
        }
        if ((type === 'icon' || type === 'button') && (child.name === 'bg' || child.name === 'overlay')) {
            const sprite = child.name === 'bg' ? background : overlay;
            const classNames = child.name === 'bg' ? 'focus-frame-gfx' : 'focus-decoration-gfx';
            return sprite ? renderIcon({ ...child as HOIPartial<IconType>, spritetype: sprite, quadtexturesprite: sprite,
                frame: child.name === 'bg' ? 0 : (child as HOIPartial<IconType>).frame }, parent, { ...common, classNames }) : '';
        }
        if (type === 'instanttextbox' && child.name === 'name') {
            // Clausewitz does not use DOM source order for every GUI layer. Some focus GUI files
            // declare the title before the background, which would otherwise paint the frame over
            // the text in the webview and leave only a few glyph fragments visible.
            return renderInstantTextBox({ ...child as HOIPartial<InstantTextBoxType>, text: focusCardPlaceholders.label }, parent,
                { ...common, classNames: focusNameClass, localise: false, rawText: true });
        }
        if (type === 'icon') {
            return renderIcon(child as HOIPartial<IconType>, parent, { ...common, classNames: 'focus-decoration-gfx' });
        }
        if (type === 'button') {
            return renderButton(child as Parameters<typeof renderButton>[0], parent, { ...common, classNames: 'focus-decoration-gfx' });
        }
        return undefined;
    };
    const offset = styleTable.oneTimeStyle('focus-gui-offset', () => `position:absolute;left:${(xGridSize - width) / 2}px;top:${(yGridSize - height) / 2}px;pointer-events:none;`);
    return `<div class="${offset}">${await renderContainerWindow(item, screen, { ...common, ignorePosition: true, onRenderChild })}</div>`;
}

export async function renderContinuousFocusGui(presentation: FocusPresentation | undefined, styleTable: StyleTable, gfxFiles: string[]): Promise<string> {
    if (!presentation?.continuous) { return ''; }
    const [,, width, height] = calculateBBox(presentation.continuous, screen);
    // Keep the stable outer element: it owns pointer capture and source-position editing.
    styleTable.raw('#continuousFocuses', `width:${width}px;height:${height}px;background:transparent;`);
    return renderContainerWindow(presentation.continuous, screen, { styleTable, ignorePosition: true,
        getSprite: name => getSpriteByGfxName(name, gfxFiles) });
}
