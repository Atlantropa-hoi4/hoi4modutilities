import { htmlAttributeEscape, htmlTextEscape } from '../../util/htmlescape';
import { normalizeForStyle } from '../../util/styletable';

/**
 * Host-rendered focus cards are shared by every focus of one GUI variant. The webview fills
 * these per-focus fields from the current focus view, so renames, moves, and edits of other
 * fields never require new markup from the host.
 */
export interface FocusCardTemplateFields {
    id: string;
    displayName: string;
    file: string;
    activeFile: string;
    editable: boolean;
    sourceFile: string;
    position: { x: number; y: number };
    iconClass: string;
}

export const focusCardPlaceholders = {
    fileAttribute: '{{fileAttribute}}',
    focusId: '{{focusId}}',
    editable: '{{focusEditable}}',
    sourceFile: '{{sourceFile}}',
    idTitle: '{{idTitle}}',
    nameTitle: '{{nameTitle}}',
    checkboxId: '{{checkboxId}}',
    label: '{{focusGuiLabel}}',
    iconClass: '{{iconClass}}',
} as const;

const placeholderPattern = /\{\{(fileAttribute|focusId|focusEditable|sourceFile|idTitle|nameTitle|checkboxId|focusGuiLabel|iconClass)\}\}/g;

export function renderFocusGuiLabel(id: string, displayName: string): string {
    return `<span data-preview-label-id="${htmlAttributeEscape(id)}" data-preview-label-name="${htmlAttributeEscape(displayName)}" data-preview-label-css-toggle="true">`
        + `<span class="preview-label-id-text">${htmlTextEscape(id)}</span>`
        + `<span class="preview-label-name-text">${htmlTextEscape(displayName)}</span></span>`;
}

export function fillFocusCardTemplate(template: string, fields: FocusCardTemplateFields): string {
    const positionText = `${fields.position.x}, ${fields.position.y}`;
    return template.replace(placeholderPattern, (_match, name: string) => {
        switch (name) {
            case 'fileAttribute':
                return fields.file === fields.activeFile ? '' : ` file="${htmlAttributeEscape(fields.file)}"`;
            case 'focusId':
                return htmlAttributeEscape(fields.id);
            case 'focusEditable':
                return fields.editable ? 'true' : 'false';
            case 'sourceFile':
                return htmlAttributeEscape(fields.sourceFile);
            case 'idTitle':
                return htmlAttributeEscape(`${fields.id}\n(${positionText})`);
            case 'nameTitle':
                return htmlAttributeEscape(`${fields.displayName}\n(${positionText})`);
            case 'checkboxId':
                return normalizeForStyle(fields.id);
            case 'focusGuiLabel':
                return renderFocusGuiLabel(fields.id, fields.displayName);
            default:
                return fields.iconClass;
        }
    });
}
