import { getState, setState } from '../util/common';

export function initializeFocusPresentation(): void {
    const controls = [
        { id: 'focus-frame-gfx', stateKey: 'focusFrames', datasetKey: 'focusFrames' },
        { id: 'focus-decoration-gfx', stateKey: 'focusDecorations', datasetKey: 'focusDecorations' },
    ];
    for (const { id, stateKey, datasetKey } of controls) {
        const button = document.getElementById(id);
        let visible = getState()[stateKey] !== false;
        const apply = () => {
            document.body.dataset[datasetKey] = String(visible);
            button?.setAttribute('aria-pressed', String(visible));
        };
        apply();
        button?.addEventListener('click', () => {
            visible = !visible;
            setState({ [stateKey]: visible });
            apply();
        });
    }
}
