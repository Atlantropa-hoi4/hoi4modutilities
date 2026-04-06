import * as assert from 'assert';
import { StyleTable } from '../../src/util/styletable';
import { renderFocusHtmlTemplate, resolveFocusLocalizationText } from '../../src/previewdef/focustree/focusrender';

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

    it('falls back to the explicit focus text key when localized text is not ready yet', () => {
        const result = resolveFocusLocalizationText(
            { id: 'FOCUS_ID', text: 'FOCUS_TEXT_KEY' } as any,
            key => key,
        );

        assert.strictEqual(result, 'FOCUS_TEXT_KEY');
    });

    it('renders the localization line beneath the focus id', () => {
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
        );

        assert.match(html, /FOCUS_ID/);
        assert.match(html, /FOCUS_TEXT_KEY/);
        assert.match(html, /focus-localization-line/);
    });
});
