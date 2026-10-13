import * as assert from 'assert';
import type { FocusView } from '../../src/previewdef/focustree/viewmodel';
import {
    FocusCardRenderInput,
    getFocusCompletionLabel,
    getFocusIconClassName,
    isSameFocusCardMarkup,
    renderFocusCardHtml,
} from '../../webviewsrc/focustree/cards';

function createFocus(overrides: Partial<FocusView> = {}): FocusView {
    return {
        id: 'FOCUS_<A>',
        displayName: 'Focus "A"',
        x: 1,
        y: 2,
        icon: [
            { icon: 'GFX_conditional', condition: { scopeName: '', nodeContent: 'has_war = yes' } },
            { icon: 'GFX_default', condition: { type: 'and', items: [] } },
        ],
        prerequisite: [],
        prerequisiteGroupCount: 0,
        prerequisiteFocusCount: 0,
        exclusive: [],
        exclusiveCount: 0,
        inAllowBranch: [],
        offset: [],
        searchFilters: [],
        file: 'common/national_focus/test.txt',
        editable: true,
        sourceFile: 'common/national_focus/test.txt',
        ...overrides,
    } as FocusView;
}

function createInput(overrides: Partial<FocusCardRenderInput> = {}): FocusCardRenderInput {
    return {
        focus: createFocus(),
        template: undefined,
        exprs: [],
        activeFile: 'common/national_focus/test.txt',
        completable: false,
        labelMode: 'id',
        ...overrides,
    };
}

describe('focus tree webview cards', () => {
    it('selects the first icon whose condition holds', () => {
        const focus = createFocus();
        assert.strictEqual(getFocusIconClassName(focus, []), 'st-focus-icon-GFX_default');
        assert.strictEqual(
            getFocusIconClassName(focus, [{ scopeName: '', nodeContent: 'has_war = yes' }]),
            'st-focus-icon-GFX_conditional',
        );
    });

    it('renders escaped standard cards without inline styles or source ranges', () => {
        const html = renderFocusCardHtml(createInput({ completable: true, labelMode: 'name' }), { x: 3, y: 4 });

        assert.match(html, /data-focus-id="FOCUS_&lt;A&gt;"/);
        assert.match(html, /data-focus-editable="true"/);
        assert.match(html, /title="Focus &quot;A&quot;\n\(3, 4\)"/);
        assert.match(html, /<span class="preview-label-name-text">Focus "A"<\/span>/);
        assert.match(html, /st-focus-icon-image st-focus-icon-GFX_default/);
        assert.match(html, /<input id="checkbox-FOCUS__60A_62" type="checkbox"\/>/);
        assert.doesNotMatch(html, /\sstyle=|\sstart=|\send=|\sfile=/);
        assert.match(renderFocusCardHtml(createInput({ activeFile: 'other.txt' }), { x: 0, y: 0 }), / file="common\/national_focus\/test\.txt"/);
    });

    it('renders standard overlay layers', () => {
        const html = renderFocusCardHtml(createInput({ focus: createFocus({ overlay: 'GFX_overlay' }) }), { x: 0, y: 0 });

        assert.match(html, /<div class="focus-decoration-gfx st-focus-overlay-common st-focus-overlay-GFX_overlay"><\/div>/);
    });

    it('fills host templates from the focus view', () => {
        const html = renderFocusCardHtml(createInput({
            template: '<div title="{{idTitle}}" data-focus-id="{{focusId}}"{{fileAttribute}}><div class="{{iconClass}}"></div>{{focusGuiLabel}}</div>',
            activeFile: 'other.txt',
        }), { x: 5, y: 6 });

        assert.strictEqual(html, '<div title="FOCUS_&lt;A&gt;\n(5, 6)" data-focus-id="FOCUS_&lt;A&gt;"'
            + ' file="common/national_focus/test.txt"><div class="st-focus-icon-GFX_default"></div>'
            + '<span data-preview-label-id="FOCUS_&lt;A&gt;" data-preview-label-name="Focus &quot;A&quot;" data-preview-label-css-toggle="true">'
            + '<span class="preview-label-id-text">FOCUS_&lt;A&gt;</span><span class="preview-label-name-text">Focus "A"</span></span></div>');
    });

    it('names each completion checkbox after its focus the way the card is labelled', () => {
        const english = (focusLabel: string) => `Mark ${focusLabel} as completed`;
        const korean = (focusLabel: string) => `${focusLabel} 완료로 표시`;
        const focus = createFocus();

        assert.strictEqual(getFocusCompletionLabel(focus, 'id', english), 'Mark FOCUS_<A> as completed');
        assert.strictEqual(getFocusCompletionLabel(focus, 'name', english), 'Mark Focus "A" as completed');
        assert.strictEqual(getFocusCompletionLabel(focus, 'name', korean), 'Focus "A" 완료로 표시');
        assert.strictEqual(getFocusCompletionLabel(createFocus({ displayName: undefined }), 'name', english),
            'Mark FOCUS_<A> as completed', 'a focus without a localised name keeps its id');
        assert.notStrictEqual(getFocusCompletionLabel(createFocus({ id: 'FOCUS_B' }), 'id', english),
            getFocusCompletionLabel(focus, 'id', english), 'checkboxes of different focuses are told apart');
    });

    it('treats positions and label modes as in-place changes', () => {
        const input = createInput();
        const template = '<div class="{{iconClass}}"></div>';

        assert.ok(isSameFocusCardMarkup(input, createInput({ focus: createFocus({ x: 9, y: 9, start: 99 }), labelMode: 'name' })));
        assert.ok(!isSameFocusCardMarkup(input, createInput({ focus: createFocus({ displayName: 'Renamed' }) })));
        assert.ok(!isSameFocusCardMarkup(input, createInput({ focus: createFocus({ overlay: 'GFX_overlay' }) })));
        assert.ok(!isSameFocusCardMarkup(input, createInput({ completable: true })));
        assert.ok(!isSameFocusCardMarkup(input, createInput({ exprs: [{ scopeName: '', nodeContent: 'has_war = yes' }] })));
        assert.ok(isSameFocusCardMarkup(createInput({ template }), createInput({ template, focus: createFocus({ x: 4 }) })));
        assert.ok(!isSameFocusCardMarkup(createInput({ template }), createInput({ template, focus: createFocus({ displayName: 'Renamed' }) })));
        assert.ok(!isSameFocusCardMarkup(createInput({ template }), createInput({ template: `${template} ` })));
    });
});
