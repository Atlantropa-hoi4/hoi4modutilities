import type { ConditionItem } from '../../src/hoiformat/condition';
import { applyCondition } from '../../src/hoiformat/condition';
import type { NumberPosition } from '../../src/util/common';
import { htmlAttributeEscape, htmlTextEscape } from '../../src/util/htmlescape';
import { normalizeForStyle } from '../../src/util/styletable';
import type { FocusView } from '../../src/previewdef/focustree/viewmodel';
import { fillFocusCardTemplate } from '../../src/previewdef/focustree/cardtemplate';

/** Inputs that determine a focus card's markup. Positions only affect titles and transforms. */
export interface FocusCardRenderInput {
    focus: FocusView;
    /** Host GUI card template shared by the focus's variant, when the mod provides a focus GUI. */
    template: string | undefined;
    exprs: readonly ConditionItem[];
    activeFile: string;
    completable: boolean;
    labelMode: 'id' | 'name';
}

export function getFocusIconClassName(focus: FocusView, exprs: readonly ConditionItem[]): string {
    for (const icon of focus.icon) {
        if (applyCondition(icon.condition, exprs as ConditionItem[])) {
            return `st-focus-icon-${normalizeForStyle(icon.icon ?? '-empty')}`;
        }
    }

    return `st-focus-icon-${normalizeForStyle('-empty')}`;
}

/**
 * Whether two inputs produce the same card markup. Positions and label mode only affect titles,
 * which are patched in place. Unchanged host templates are the same string instance, so the
 * common case compares references.
 */
export function isSameFocusCardMarkup(left: FocusCardRenderInput, right: FocusCardRenderInput): boolean {
    const leftFocus = left.focus;
    const rightFocus = right.focus;
    if (left.template !== right.template
        || left.completable !== right.completable
        || leftFocus.displayName !== rightFocus.displayName
        || leftFocus.file !== rightFocus.file
        || (leftFocus.file === left.activeFile) !== (rightFocus.file === right.activeFile)
        || (leftFocus.editable === true) !== (rightFocus.editable === true)
        || (leftFocus.sourceFile ?? leftFocus.file) !== (rightFocus.sourceFile ?? rightFocus.file)
        || (left.template === undefined && leftFocus.overlay !== rightFocus.overlay)) {
        return false;
    }
    return leftFocus === rightFocus && left.exprs === right.exprs
        || getFocusIconClassName(leftFocus, left.exprs) === getFocusIconClassName(rightFocus, right.exprs);
}

export function getFocusCardTitles(focus: FocusView, position: NumberPosition): { id: string; name: string } {
    const positionText = `${position.x}, ${position.y}`;
    return {
        id: `${focus.id}\n(${positionText})`,
        name: `${focus.displayName ?? focus.id}\n(${positionText})`,
    };
}

export function renderFocusCardHtml(input: FocusCardRenderInput, position: NumberPosition): string {
    const iconClass = getFocusIconClassName(input.focus, input.exprs);
    const focus = input.focus;
    if (input.template !== undefined) {
        return fillFocusCardTemplate(input.template, {
            id: focus.id,
            displayName: focus.displayName ?? focus.id,
            file: focus.file,
            activeFile: input.activeFile,
            editable: focus.editable === true,
            sourceFile: focus.sourceFile ?? focus.file,
            position,
            iconClass,
        });
    }

    const id = htmlAttributeEscape(focus.id);
    const displayName = focus.displayName ?? focus.id;
    const titles = getFocusCardTitles(focus, position);
    const title = input.labelMode === 'name' ? titles.name : titles.id;
    const overlayClass = focus.overlay ? ` st-focus-overlay-${normalizeForStyle(focus.overlay)}` : '';
    return `<div class="navigator st-focus-common" data-focus-id="${id}"`
        + ` data-focus-editable="${focus.editable === true ? 'true' : 'false'}"`
        + ` data-focus-source-file="${htmlAttributeEscape(focus.sourceFile ?? focus.file)}"`
        + (focus.file === input.activeFile ? '' : ` file="${htmlAttributeEscape(focus.file)}"`)
        + ` title="${htmlAttributeEscape(title)}"`
        + ` data-preview-title-id="${htmlAttributeEscape(titles.id)}"`
        + ` data-preview-title-name="${htmlAttributeEscape(titles.name)}">`
        + (input.completable
            ? `<div class="focus-checkbox st-focus-checkbox"><input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/></div>`
            : '')
        + `<div class="focus-decoration-gfx st-focus-overlay-common${overlayClass}"${focus.overlay ? '' : ' hidden'}></div>`
        + `<div class="st-focus-icon-slot"><div class="st-focus-icon-image ${iconClass}"></div></div>`
        + `<span class="st-focus-span"><span class="st-focus-code-line" data-preview-label-id="${id}"`
        + ` data-preview-label-name="${htmlAttributeEscape(displayName)}" data-preview-label-css-toggle="true">`
        + `<span class="preview-label-id-text">${htmlTextEscape(focus.id)}</span>`
        + `<span class="preview-label-name-text">${htmlTextEscape(displayName)}</span></span></span></div>`;
}

/**
 * Completes a parsed card: host templates always contain a checkbox slot, and the checkbox
 * chrome matches `Checkbox` so the delegated checkbox handlers work unchanged.
 */
export function finishFocusCard(card: HTMLElement, input: FocusCardRenderInput, checked: boolean): void {
    const checkbox = card.querySelector<HTMLInputElement>(':scope > .focus-checkbox > input[type="checkbox"]');
    if (!input.completable) {
        checkbox?.parentElement?.remove();
    } else if (checkbox) {
        checkbox.checked = checked;
        checkbox.dataset.focusCheckboxId = input.focus.id;
        checkbox.classList.add('hidden');
        checkbox.tabIndex = -1;
        checkbox.after(createCheckboxChrome(checked));
    }

    if (input.template !== undefined && input.labelMode === 'name' && card.dataset.previewTitleName) {
        card.title = card.dataset.previewTitleName;
    }
}

function createCheckboxChrome(checked: boolean): HTMLDivElement {
    const outer = document.createElement('div');
    outer.className = 'checkbox-container-out';
    const container = document.createElement('div');
    container.className = 'checkbox-container';
    container.tabIndex = 0;
    container.setAttribute('role', 'checkbox');
    container.setAttribute('aria-checked', String(checked));
    const glyph = document.createElement('div');
    glyph.className = 'checkbox codicon codicon-check';
    container.append(glyph, document.createElement('div'));
    outer.appendChild(container);
    return outer;
}

export function setFocusCardChecked(card: HTMLElement, checked: boolean): void {
    const input = card.querySelector<HTMLInputElement>('input[data-focus-checkbox-id]');
    if (!input) {
        return;
    }
    input.checked = checked;
    input.nextElementSibling?.querySelector('.checkbox-container')?.setAttribute('aria-checked', String(checked));
}

export function updateFocusCardTitles(card: HTMLElement, focus: FocusView, position: NumberPosition, labelMode: 'id' | 'name'): void {
    const titles = getFocusCardTitles(focus, position);
    card.dataset.previewTitleId = titles.id;
    card.dataset.previewTitleName = titles.name;
    card.title = labelMode === 'name' ? titles.name : titles.id;
}
