import * as assert from 'assert';
import { StyleTable } from '../../src/util/styletable';
import { fillFocusCardTemplate, focusCardPlaceholders } from '../../src/previewdef/focustree/cardtemplate';
import {
    renderFocusCardTemplate,
    resolveFocusLocalizationText,
    resolveFocusLocalizationTextById,
    resolveFocusLocalizationTextByIdIfReady,
} from '../../src/previewdef/focustree/focusrender';

describe('focustree focus render', () => {
    it('prefers an explicit text key over the default id localisation', () => {
        const result = resolveFocusLocalizationText(
            { id: 'FOCUS_ID', text: 'FOCUS_TEXT_KEY' } as any,
            key => key === 'FOCUS_ID'
                ? 'Localized from id'
                : key === 'FOCUS_TEXT_KEY'
                    ? 'Localized from explicit text key'
                    : undefined,
        );

        assert.strictEqual(result, 'Localized from explicit text key');
    });

    it('falls back to id localisation when there is no explicit text override', () => {
        const result = resolveFocusLocalizationText(
            { id: 'FOCUS_ID' } as any,
            key => key === 'FOCUS_ID' ? 'Localized focus title' : undefined,
        );

        assert.strictEqual(result, 'Localized focus title');
    });

    it('does not display an unresolved explicit focus text key as localization', () => {
        const result = resolveFocusLocalizationText(
            { id: 'FOCUS_ID', text: 'FOCUS_TEXT_KEY' } as any,
            key => key,
        );

        assert.strictEqual(result, undefined);
    });

    it('renders one card template that is filled with switchable ID and localized-name metadata', () => {
        const template = renderFocusCardTemplate(
            new StyleTable(),
            96,
            `<div class="name">  ${focusCardPlaceholders.label}  </div><div class="${focusCardPlaceholders.iconClass}"></div>`,
        );
        const fields = {
            id: 'FOCUS_ID',
            displayName: 'Localized "focus" title',
            file: 'common/national_focus/test.txt',
            activeFile: 'common/national_focus/test.txt',
            editable: true,
            sourceFile: 'common/national_focus/test.txt',
            position: { x: 3, y: 4 },
            iconClass: 'st-focus-icon-GFX_A',
        };
        const html = fillFocusCardTemplate(template, fields);

        assert.doesNotMatch(template, /FOCUS_ID|\s\s/);
        assert.match(html, /data-focus-id="FOCUS_ID"/);
        assert.match(html, /data-focus-editable="true"/);
        assert.match(html, /data-preview-label-id="FOCUS_ID"/);
        assert.match(html, /data-preview-label-name="Localized &quot;focus&quot; title"/);
        assert.match(html, /data-preview-title-name="Localized &quot;focus&quot; title\n\(3, 4\)"/);
        assert.match(html, /<input id="checkbox-FOCUS_ID" type="checkbox"\/>/);
        assert.match(html, /class="st-focus-icon-GFX_A"/);
        assert.doesNotMatch(html, /\{\{|\sfile=|\sstart=/);
        assert.match(
            fillFocusCardTemplate(template, { ...fields, file: 'common/national_focus/shared.txt' }),
            / file="common\/national_focus\/shared\.txt"/,
        );
    });

    it('resolves actual focus localization text for multiple focuses', async () => {
        const result = await resolveFocusLocalizationTextById(
            [
                { id: 'FOCUS_A', text: 'FOCUS_A_TEXT' },
                { id: 'FOCUS_B', text: undefined },
                { id: 'FOCUS_MISSING', text: 'FOCUS_MISSING_TEXT' },
            ] as any,
            async key => ({
                FOCUS_A_TEXT: 'Focus A localized',
                FOCUS_B: 'Focus B localized',
            }[key] ?? key),
        );

        assert.deepStrictEqual(result, {
            FOCUS_A: 'Focus A localized',
            FOCUS_B: 'Focus B localized',
        });
    });

    it('omits unresolved keys from ready-only preview localization', async () => {
        const result = await resolveFocusLocalizationTextByIdIfReady(
            [{ id: 'FOCUS_A', text: undefined }] as any,
            key => key,
        );

        assert.deepStrictEqual(result, {});
    });

    it('resolves a ready localization batch without per-focus async fan-out', async () => {
        const focuses = Array.from({ length: 500 }, (_, index) => ({
            id: `FOCUS_${index}`,
            text: undefined,
        }));
        let resolveCount = 0;

        const result = await resolveFocusLocalizationTextByIdIfReady(focuses as any, key => {
            resolveCount += 1;
            return key === 'FOCUS_499' ? 'Last focus' : key;
        });

        assert.strictEqual(resolveCount, focuses.length);
        assert.deepStrictEqual(result, { FOCUS_499: 'Last focus' });
    });

});
