import { numDropDownOpened$ } from '../util/dropdown';
import { FocusWarningsPanelController } from './warningspanel';

const containerId = 'warnings-container';
const panelId = 'warnings';
const toggleId = 'show-warnings';

function getContainer(): HTMLElement | null {
    return document.getElementById(containerId);
}

function getToggle(): HTMLButtonElement | null {
    return document.getElementById(toggleId) as HTMLButtonElement | null;
}

/** Everything the panel covers: the scene with its inlays, and the controls floating over it. */
function getCoveredElements(): HTMLElement[] {
    return [
        document.getElementById('focustreecontent'),
        document.getElementById('focus-asset-status'),
        ...Array.from(document.querySelectorAll<HTMLElement>('.preview-zoom-controls')),
    ].filter((element): element is HTMLElement => !!element);
}

const controller = new FocusWarningsPanelController({
    isOpen: () => getContainer()?.style.display === 'block',
    setOpen: open => {
        const container = getContainer();
        if (container) {
            container.style.display = open ? 'block' : 'none';
        }
        document.body.style.overflow = open ? 'hidden' : '';
        getToggle()?.setAttribute('aria-expanded', open ? 'true' : 'false');
    },
    setBackgroundInert: inert => {
        getCoveredElements().forEach(element => {
            element.inert = inert;
        });
    },
    focusPanel: () => {
        const panel = document.getElementById(panelId);
        const firstEntry = panel?.querySelector<HTMLElement>('[data-warning-index]');
        (firstEntry ?? panel)?.focus();
    },
    focusToggle: () => {
        const toggle = getToggle();
        if (!toggle || toggle.style.display === 'none') {
            return false;
        }
        toggle.focus();
        return document.activeElement === toggle;
    },
    focusFallback: () => {
        document.getElementById('refresh')?.focus();
    },
    isFocusInPanel: () => !!getContainer()?.contains(document.activeElement),
});

export function installFocusWarningsPanel(): void {
    getToggle()?.addEventListener('click', () => controller.toggle());
}

/** Escape precedence after editing gestures: an open dropdown first, then this panel. */
export function closeFocusWarningsPanelOnEscape(): boolean {
    return controller.handleEscape(numDropDownOpened$.value > 0);
}

export function closeFocusWarningsPanelBecauseUnavailable(): void {
    controller.closeBecauseUnavailable();
}

/** Re-renders the panel's entries without losing keyboard focus that was on one of them. */
export function renderFocusWarningsPreservingFocus(render: () => void): void {
    const focusWasInPanel = !!getContainer()?.contains(document.activeElement);
    render();
    controller.restoreFocusAfterRender(focusWasInPanel);
}
