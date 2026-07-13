import * as assert from 'assert';
import { StyleTable } from '../../src/util/styletable';
import {
    renderFocusHtmlTemplate,
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

    it('renders switchable ID and localized-name metadata', () => {
        const html = renderFocusHtmlTemplate(
            {
                id: 'FOCUS_ID',
                text: 'FOCUS_TEXT_KEY',
                token: undefined,
                file: 'common/national_focus/test.txt',
                layout: undefined,
                isInCurrentFile: true,
            } as any,
            new StyleTable(),
            'common/national_focus/test.txt',
            96,
            130,
            'Localized focus title',
        );

        assert.match(html, /FOCUS_ID/);
        assert.match(html, /Localized focus title/);
        assert.match(html, /data-preview-label-id="FOCUS_ID"/);
        assert.match(html, /data-preview-label-name="Localized focus title"/);
        assert.match(html, /data-preview-title-name="Localized focus title/);
    });

    it('renders a focus overlay layer when configured', () => {
        const html = renderFocusHtmlTemplate(
            {
                id: 'FOCUS_ID',
                overlay: 'GFX_focus_overlay',
                token: undefined,
                file: 'common/national_focus/test.txt',
                layout: undefined,
                isInCurrentFile: true,
            } as any,
            new StyleTable(),
            'common/national_focus/test.txt',
            96,
            130,
        );

        assert.match(html, /focus-overlay-common/);
        assert.match(html, /focus-overlay-GFX_focus_overlay/);
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

    it('exposes a ready-only localization resolver for preview rendering', async () => {
        const result = await resolveFocusLocalizationTextByIdIfReady([{ id: 'FOCUS_A', text: undefined }] as any);

        assert.deepStrictEqual(result, {});
    });
});
