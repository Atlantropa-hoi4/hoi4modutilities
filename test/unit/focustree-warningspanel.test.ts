import * as assert from 'assert';
import { FocusWarningsPanelController } from '../../webviewsrc/focustree/warningspanel';
import type { FocusWarningsPanelView } from '../../webviewsrc/focustree/warningspanel';

/** A page with a toolbar toggle, the warnings panel, and the scene the panel covers. */
function createPage(options: { entries?: number } = {}) {
    const state = {
        open: false,
        sceneInert: false,
        toggleVisible: true,
        toggleExpanded: false,
        entries: options.entries ?? 2,
        focus: 'toggle' as string,
    };
    const view: FocusWarningsPanelView = {
        isOpen: () => state.open,
        setOpen: open => {
            state.open = open;
            state.toggleExpanded = open;
        },
        setBackgroundInert: inert => {
            state.sceneInert = inert;
        },
        focusPanel: () => {
            state.focus = state.entries > 0 ? 'entry:0' : 'panel';
        },
        focusToggle: () => {
            if (!state.toggleVisible) {
                return false;
            }
            state.focus = 'toggle';
            return true;
        },
        focusFallback: () => {
            state.focus = 'refresh';
        },
        isFocusInPanel: () => state.focus === 'panel' || state.focus.startsWith('entry:'),
    };
    /** What Tab can reach: covered scene controls only while nothing makes them inert. */
    const canTabIntoScene = () => !state.sceneInert;
    return { state, controller: new FocusWarningsPanelController(view), canTabIntoScene };
}

describe('focus tree warnings panel', () => {
    it('moves focus into the opened panel and keeps keyboard focus out of the covered scene', () => {
        const { state, controller, canTabIntoScene } = createPage();
        assert.strictEqual(canTabIntoScene(), true);
        controller.toggle();
        assert.deepStrictEqual([state.open, state.toggleExpanded, state.focus], [true, true, 'entry:0']);
        assert.strictEqual(canTabIntoScene(), false);

        const empty = createPage({ entries: 0 });
        empty.controller.open();
        assert.strictEqual(empty.state.focus, 'panel', 'a panel without warnings still takes focus');
    });

    it('closes on Escape and returns focus to the toggle', () => {
        const { state, controller, canTabIntoScene } = createPage();
        controller.open();
        state.focus = 'entry:1';
        assert.strictEqual(controller.handleEscape(false), true);
        assert.deepStrictEqual([state.open, state.toggleExpanded, state.focus], [false, false, 'toggle']);
        assert.strictEqual(canTabIntoScene(), true);
    });

    it('leaves Escape to an open dropdown and to editing when the panel is closed', () => {
        const { state, controller } = createPage();
        controller.open();
        assert.strictEqual(controller.handleEscape(true), false, 'the open dropdown closes first');
        assert.strictEqual(state.open, true);

        controller.close();
        assert.strictEqual(controller.handleEscape(false), false, 'editing then clears the focus selection');
    });

    it('keeps focus where it is when the panel closes from the toolbar', () => {
        const { state, controller } = createPage();
        controller.open();
        state.focus = 'searchbox';
        controller.toggle();
        assert.deepStrictEqual([state.open, state.focus], [false, 'searchbox']);
    });

    it('moves focus to a remaining toolbar control when the warnings and their toggle disappear', () => {
        const { state, controller, canTabIntoScene } = createPage();
        controller.open();
        state.toggleVisible = false;
        controller.closeBecauseUnavailable();
        assert.deepStrictEqual([state.open, state.focus], [false, 'refresh']);
        assert.strictEqual(canTabIntoScene(), true);

        controller.closeBecauseUnavailable();
        assert.strictEqual(state.focus, 'refresh', 'a closed panel changes nothing');
    });

    it('keeps focus in the panel when its warnings are rendered again', () => {
        const { state, controller } = createPage();
        controller.open();
        state.focus = 'entry:1';
        // The re-render replaced the focused entry, so the document's focus fell back to the body.
        state.focus = 'body';
        controller.restoreFocusAfterRender(true);
        assert.strictEqual(state.focus, 'entry:0');

        state.focus = 'searchbox';
        controller.restoreFocusAfterRender(false);
        assert.strictEqual(state.focus, 'searchbox', 'focus outside the panel is not taken');
    });
});
