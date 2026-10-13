// Keyboard and ARIA rules of the toolbar comboboxes, kept free of the DOM so the transitions can be
// tested. A closed combobox opens a listbox popup; the popup's options take real focus, and closing
// it returns focus to the combobox.

export interface ComboboxKeyEvent {
    key: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

export type ComboboxOpenFocus = 'selected' | 'first' | 'last';

/**
 * What a key does on a closed combobox. Native selects keep their own arrow keys, which change
 * the value in place; the div comboboxes open with them as listbox comboboxes do.
 */
export function getClosedComboboxKeyAction(event: ComboboxKeyEvent, nativeSelect: boolean): { focus: ComboboxOpenFocus } | undefined {
    if (event.ctrlKey || event.metaKey) {
        return undefined;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'F4') {
        return { focus: 'selected' };
    }
    if (event.altKey) {
        return event.key === 'ArrowDown' || event.key === 'ArrowUp' ? { focus: 'selected' } : undefined;
    }
    if (nativeSelect) {
        return undefined;
    }
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
            return { focus: 'selected' };
        case 'Home':
            return { focus: 'first' };
        case 'End':
            return { focus: 'last' };
        default:
            return undefined;
    }
}

export type ListboxKeyAction =
    | { kind: 'move'; index: number }
    /** Selects the option and closes a single-select listbox; toggles it in a multi-select one. */
    | { kind: 'choose' }
    /**
     * Closes the popup and focuses the combobox. Tab keeps its default, so focus then moves on
     * from the combobox like from any other control.
     */
    | { kind: 'close'; preventDefault: boolean };

/** What a key does on a focused option of an open listbox. */
export function getListboxKeyAction(event: ComboboxKeyEvent, state: { index: number; count: number }): ListboxKeyAction | undefined {
    const last = Math.max(state.count - 1, 0);
    switch (event.key) {
        case 'ArrowDown':
            return event.altKey ? undefined : { kind: 'move', index: Math.min(state.index + 1, last) };
        case 'ArrowUp':
            return event.altKey ? { kind: 'close', preventDefault: true } : { kind: 'move', index: Math.max(state.index - 1, 0) };
        case 'Home':
            return { kind: 'move', index: 0 };
        case 'End':
            return { kind: 'move', index: last };
        case 'Enter':
        case ' ':
            return { kind: 'choose' };
        case 'Escape':
            return { kind: 'close', preventDefault: true };
        case 'Tab':
            return { kind: 'close', preventDefault: false };
        default:
            return undefined;
    }
}

/** Index of the option an opening popup focuses. */
export function getInitialListboxIndex(focus: ComboboxOpenFocus, selectedIndex: number, count: number): number {
    if (count === 0) {
        return -1;
    }
    return focus === 'first' ? 0 : focus === 'last' ? count - 1 : Math.max(0, Math.min(selectedIndex, count - 1));
}

export interface AriaElement {
    id: string;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
}

/**
 * Names a combobox after its label. The label written right before the combobox's container is
 * preferred over a `for` reference, which some toolbars point at another control; labels get ids
 * derived from the combobox so `aria-labelledby` can refer to them.
 */
export function labelCombobox(combobox: AriaElement, labels: { preceding?: AriaElement; referencing?: AriaElement }): string | undefined {
    const label = labels.preceding ?? labels.referencing;
    combobox.setAttribute('aria-haspopup', 'listbox');
    if (combobox.getAttribute('aria-expanded') === null) {
        combobox.setAttribute('aria-expanded', 'false');
    }
    if (!label) {
        return undefined;
    }
    if (!label.id) {
        label.id = `${combobox.id || 'combobox'}-label`;
    }
    combobox.setAttribute('aria-labelledby', label.id);
    return label.id;
}

/** Marks the combobox open with its popup, or closed. */
export function setComboboxExpanded(combobox: AriaElement, listboxId: string | undefined): void {
    combobox.setAttribute('aria-expanded', listboxId ? 'true' : 'false');
    if (listboxId) {
        combobox.setAttribute('aria-controls', listboxId);
    } else {
        combobox.removeAttribute('aria-controls');
    }
}

/** Describes a listbox popup and its options; multi-select options report their check state. */
export function describeListbox(
    listbox: AriaElement,
    options: { labelId: string | undefined; multiSelection: boolean },
): void {
    listbox.setAttribute('role', 'listbox');
    if (options.labelId) {
        listbox.setAttribute('aria-labelledby', options.labelId);
    }
    if (options.multiSelection) {
        listbox.setAttribute('aria-multiselectable', 'true');
    }
}

export function setOptionSelected(option: AriaElement, selected: boolean): void {
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
}
