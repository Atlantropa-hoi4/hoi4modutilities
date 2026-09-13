import { feLocalize } from './i18n';

export function isZoomInput(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]');
}

export function installZoomControls(step: (direction: number) => void, scale: () => number): (() => void) & { dispose(): void } {
    const controls = document.createElement('div');
    controls.className = 'preview-zoom-controls';
    const out = document.createElement('button');
    out.textContent = '−';
    out.title = feLocalize('zoom.out', 'Zoom out (-)');
    const label = document.createElement('output');
    label.setAttribute('aria-live', 'polite');
    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.title = feLocalize('zoom.in', 'Zoom in (+)');
    const update = () => { label.textContent = `${Math.round(scale() * 100)}%`; };
    const apply = (direction: number) => { step(direction); update(); };
    out.addEventListener('click', () => apply(-1));
    zoomIn.addEventListener('click', () => apply(1));
    controls.append(out, label, zoomIn);
    document.body.append(controls);
    const keydown = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey || isZoomInput(event.target)) { return; }
        if (event.key === '+' || event.key === '=' || event.key === '-') {
            event.preventDefault();
            apply(event.key === '-' ? -1 : 1);
        }
    };
    window.addEventListener('keydown', keydown);
    update();
    return Object.assign(update, { dispose: () => { window.removeEventListener('keydown', keydown); controls.remove(); } });
}
