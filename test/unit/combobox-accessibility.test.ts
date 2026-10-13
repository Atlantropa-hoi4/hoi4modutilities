import * as assert from 'assert';
import {
    describeListbox,
    getClosedComboboxKeyAction,
    getInitialListboxIndex,
    getListboxKeyAction,
    labelCombobox,
    setComboboxExpanded,
    setOptionSelected,
} from '../../webviewsrc/util/combobox';

class FakeElement {
    public id = '';
    private readonly attributes = new Map<string, string>();

    constructor(id = '') {
        this.id = id;
    }

    public getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    public removeAttribute(name: string): void {
        this.attributes.delete(name);
    }
}

/** Walks an open listbox the way the dropdown applies key actions to focused options. */
function walk(keys: Array<{ key: string; altKey?: boolean }>, count: number, start: number) {
    let index = start;
    const log: string[] = [];
    for (const event of keys) {
        const action = getListboxKeyAction(event, { index, count });
        if (!action) {
            log.push('none');
        } else if (action.kind === 'move') {
            index = action.index;
            log.push(`focus:${index}`);
        } else if (action.kind === 'choose') {
            log.push(`choose:${index}`);
        } else {
            log.push(action.preventDefault ? 'close:combobox' : 'close:combobox+tab');
        }
    }
    return log;
}

describe('combobox accessibility', () => {
    it('names a combobox by the label written before it and announces its listbox popup', () => {
        const combobox = new FakeElement('conditions');
        const label = new FakeElement();
        assert.strictEqual(labelCombobox(combobox, { preceding: label }), 'conditions-label');
        assert.strictEqual(label.id, 'conditions-label');
        assert.strictEqual(combobox.getAttribute('aria-labelledby'), 'conditions-label');
        assert.strictEqual(combobox.getAttribute('aria-haspopup'), 'listbox');
        assert.strictEqual(combobox.getAttribute('aria-expanded'), 'false');
    });

    it('prefers the adjacent label over a label whose for attribute names another control', () => {
        // The world map writes `<label for="warningfilter">Display</label>` before #display.
        const display = new FakeElement('display');
        const adjacent = new FakeElement('display-caption');
        labelCombobox(display, { preceding: adjacent, referencing: undefined });
        assert.strictEqual(display.getAttribute('aria-labelledby'), 'display-caption');

        const filters = new FakeElement('search-filters');
        const referencing = new FakeElement('filters-label');
        labelCombobox(filters, { referencing });
        assert.strictEqual(filters.getAttribute('aria-labelledby'), 'filters-label', 'a for reference is the fallback');

        const unlabelled = new FakeElement('inlay-windows');
        assert.strictEqual(labelCombobox(unlabelled, {}), undefined);
        assert.strictEqual(unlabelled.getAttribute('aria-labelledby'), null);
        assert.strictEqual(unlabelled.getAttribute('aria-haspopup'), 'listbox');
    });

    it('states the open popup on the combobox and the selection on its options', () => {
        const combobox = new FakeElement('conditions');
        const listbox = new FakeElement('select-dropdown-1');
        describeListbox(listbox, { labelId: 'conditions-label', multiSelection: true });
        assert.strictEqual(listbox.getAttribute('role'), 'listbox');
        assert.strictEqual(listbox.getAttribute('aria-labelledby'), 'conditions-label');
        assert.strictEqual(listbox.getAttribute('aria-multiselectable'), 'true');

        setComboboxExpanded(combobox, listbox.id);
        assert.strictEqual(combobox.getAttribute('aria-expanded'), 'true');
        assert.strictEqual(combobox.getAttribute('aria-controls'), 'select-dropdown-1');
        setComboboxExpanded(combobox, undefined);
        assert.strictEqual(combobox.getAttribute('aria-expanded'), 'false');
        assert.strictEqual(combobox.getAttribute('aria-controls'), null);

        const option = new FakeElement();
        setOptionSelected(option, true);
        assert.strictEqual(option.getAttribute('role'), 'option');
        assert.strictEqual(option.getAttribute('aria-selected'), 'true');
        setOptionSelected(option, false);
        assert.strictEqual(option.getAttribute('aria-selected'), 'false');

        const single = new FakeElement('select-dropdown-2');
        describeListbox(single, { labelId: undefined, multiSelection: false });
        assert.strictEqual(single.getAttribute('aria-multiselectable'), null);
    });

    it('opens a closed div combobox with the standard keys', () => {
        for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
            assert.deepStrictEqual(getClosedComboboxKeyAction({ key }, false), { focus: 'selected' }, key);
        }
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: 'ArrowDown', altKey: true }, false), { focus: 'selected' });
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: 'Home' }, false), { focus: 'first' });
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: 'End' }, false), { focus: 'last' });
        assert.strictEqual(getClosedComboboxKeyAction({ key: 'Tab' }, false), undefined);
        assert.strictEqual(getClosedComboboxKeyAction({ key: 'a' }, false), undefined);
        assert.strictEqual(getClosedComboboxKeyAction({ key: 'Enter', ctrlKey: true }, false), undefined);
    });

    it('leaves plain arrow keys to native selects, which change their value in place', () => {
        assert.strictEqual(getClosedComboboxKeyAction({ key: 'ArrowDown' }, true), undefined);
        assert.strictEqual(getClosedComboboxKeyAction({ key: 'Home' }, true), undefined);
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: 'ArrowDown', altKey: true }, true), { focus: 'selected' });
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: ' ' }, true), { focus: 'selected' });
        assert.deepStrictEqual(getClosedComboboxKeyAction({ key: 'F4' }, true), { focus: 'selected' });
    });

    it('focuses the selected option on open, or the first and last for Home and End', () => {
        assert.strictEqual(getInitialListboxIndex('selected', 2, 4), 2);
        assert.strictEqual(getInitialListboxIndex('selected', -1, 4), 0, 'without a selection the first option');
        assert.strictEqual(getInitialListboxIndex('first', 2, 4), 0);
        assert.strictEqual(getInitialListboxIndex('last', 0, 4), 3);
        assert.strictEqual(getInitialListboxIndex('selected', 0, 0), -1, 'an empty listbox focuses nothing');
    });

    it('navigates, chooses, and closes an open listbox with focus returning to the combobox', () => {
        assert.deepStrictEqual(walk([
            { key: 'ArrowDown' }, { key: 'ArrowDown' }, { key: 'ArrowDown' }, { key: 'ArrowDown' },
            { key: 'ArrowUp' }, { key: 'Home' }, { key: 'End' }, { key: ' ' }, { key: 'Enter' }, { key: 'Escape' },
        ], 4, 0), [
            'focus:1', 'focus:2', 'focus:3', 'focus:3', 'focus:2', 'focus:0', 'focus:3', 'choose:3', 'choose:3', 'close:combobox',
        ]);
        assert.deepStrictEqual(walk([{ key: 'Tab' }], 4, 1), ['close:combobox+tab'], 'Tab closes and then moves on from the combobox');
        assert.deepStrictEqual(walk([{ key: 'ArrowUp', altKey: true }], 4, 1), ['close:combobox']);
        assert.deepStrictEqual(walk([{ key: 'x' }], 4, 1), ['none']);
    });
});
