import { getState, setState, refreshPreviewLabelMode } from '../util/common';
import { vscode } from '../util/vscode';

export function applyTechnologyLabels(): void {
    const mode = getState().technologyNameMode ?? (getState().previewLabelMode === 'id' ? 'id' : 'tech');
    document.body.dataset.previewLabelMode = mode === 'id' ? 'id' : 'name';
    for (const element of document.querySelectorAll<HTMLElement>('[data-technology-name]')) {
        element.dataset.previewLabelName = mode === 'short' ? element.dataset.technologyShort
            : mode === 'long' ? element.dataset.technologyLong : element.dataset.technologyName;
    }
    refreshPreviewLabelMode();
}

export function updateTechnologyCountries(folder: string): void {
    const selector = document.getElementById('technology-country') as HTMLSelectElement | null;
    if (!selector) { return; }
    while (selector.options.length > 1) { selector.remove(1); }
    const tags: string[] = (window as any).technologyCountriesByFolder?.[folder] ?? [];
    for (const tag of tags) { selector.add(new Option(tag, tag)); }
    const country: string = (window as any).technologyCountry ?? '';
    selector.value = tags.includes(country) ? country : '';
}

export function initializeTechnologyPresentation(defaultMode: 'id' | 'name' = 'name'): void {
    if (getState().previewLabelMode === undefined) { setState({ previewLabelMode: defaultMode }); }
    document.getElementById('technology-country')?.addEventListener('change', event => {
        vscode.postMessage({ command: 'selectTechnologyCountry', country: (event.target as HTMLSelectElement).value });
    });
    const selector = document.getElementById('technology-name-mode') as HTMLSelectElement | null;
    if (selector) {
        selector.value = getState().technologyNameMode ?? (getState().previewLabelMode === 'id' ? 'id' : 'tech');
        selector.addEventListener('change', () => {
            setState({ technologyNameMode: selector.value, previewLabelMode: selector.value === 'id' ? 'id' : 'name' });
            applyTechnologyLabels();
        });
    }
}
