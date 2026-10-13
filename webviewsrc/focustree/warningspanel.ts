/**
 * Keyboard behavior of the warnings panel, which covers the scene below the toolbar. Opening it
 * moves focus into it and takes the covered scene out of keyboard reach; Escape closes it, and
 * focus that was inside returns to the toggle, or to another toolbar control when the toggle hid
 * because the warnings are gone. DOM-free so the transitions can be tested.
 */

export interface FocusWarningsPanelView {
    isOpen(): boolean;
    /** Shows or hides the panel and states it on the toggle. */
    setOpen(open: boolean): void;
    /** Keeps keyboard focus out of the scene and other controls the open panel covers. */
    setBackgroundInert(inert: boolean): void;
    /** Focuses the first warning, or the panel itself when it has none. */
    focusPanel(): void;
    /** Focuses the toggle; false when it cannot take focus because it is hidden. */
    focusToggle(): boolean;
    /** Focuses a control that stays in the toolbar. */
    focusFallback(): void;
    isFocusInPanel(): boolean;
}

export class FocusWarningsPanelController {
    constructor(private readonly view: FocusWarningsPanelView) {}

    public toggle(): void {
        if (this.view.isOpen()) {
            this.close();
        } else {
            this.open();
        }
    }

    public open(): void {
        this.view.setOpen(true);
        this.view.setBackgroundInert(true);
        this.view.focusPanel();
    }

    public close(): void {
        const focusWasInPanel = this.view.isFocusInPanel();
        this.view.setOpen(false);
        this.view.setBackgroundInert(false);
        if (focusWasInPanel && !this.view.focusToggle()) {
            this.view.focusFallback();
        }
    }

    /**
     * Escape closes the open panel unless an open dropdown claims it; editing gestures such as a
     * pending link are cancelled before this is asked. Returns whether Escape was used.
     */
    public handleEscape(dropdownOpen: boolean): boolean {
        if (!this.view.isOpen() || dropdownOpen) {
            return false;
        }
        this.close();
        return true;
    }

    /** The warnings and their toggle disappeared; an open panel closes with them. */
    public closeBecauseUnavailable(): void {
        if (this.view.isOpen()) {
            this.close();
        }
    }

    /** The entries were rendered again; focus that was on a replaced entry moves to the new ones. */
    public restoreFocusAfterRender(focusWasInPanel: boolean): void {
        if (this.view.isOpen() && focusWasInPanel && !this.view.isFocusInPanel()) {
            this.view.focusPanel();
        }
    }
}
