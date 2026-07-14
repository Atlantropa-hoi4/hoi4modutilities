import * as assert from 'assert';
import { shouldRefreshFocusTreeOnExternalFileChange } from '../../src/previewdef/focustree/refreshpolicy';

const liveRefreshExtensions = new Set(['.txt', '.gfx', '.gui', '.yml', '.dds', '.tga', '.png', '.mod']);
const previewUri = 'file:///workspace/common/national_focus/preview.txt';

describe('focus tree refresh policy', () => {
    it('limits broad txt refreshes to national focus files', () => {
        assert.strictEqual(shouldRefresh('file:///workspace/common/national_focus/shared.txt'), true);
        assert.strictEqual(shouldRefresh('file:///workspace/events/unrelated.txt'), false);
        assert.strictEqual(shouldRefresh('file:///workspace/common/focus_inlay_windows/unrelated.txt'), false);
    });

    it('refreshes when a new focus inlay definition can satisfy an unresolved reference', () => {
        assert.strictEqual(shouldRefresh(
            'file:///workspace/common/focus_inlay_windows/new_inlay.txt',
            'create',
        ), true);
        assert.strictEqual(shouldRefresh(
            'file:///workspace/common/focus_inlay_windows/existing_inlay.txt',
            'change',
        ), false);
    });

    it('normalizes Windows separators for national focus files', () => {
        assert.strictEqual(shouldRefresh('C:\\workspace\\common\\national_focus\\shared.txt'), true);
    });

    it('preserves broad refreshes for relevant non-txt assets', () => {
        assert.strictEqual(shouldRefresh('file:///workspace/interface/custom.gfx'), true);
        assert.strictEqual(shouldRefresh('file:///workspace/localisation/focus_l_english.yml'), true);
        assert.strictEqual(shouldRefresh('file:///workspace/gfx/interface/goals/icon.dds'), true);
        assert.strictEqual(shouldRefresh('file:///workspace/descriptor.mod'), true);
        assert.strictEqual(shouldRefresh('file:///workspace/events/picture.png'), false);
    });

    it('refreshes for the preview document itself', () => {
        assert.strictEqual(shouldRefresh(previewUri), true);
    });
});

function shouldRefresh(path: string, changeKind: 'change' | 'create' | 'delete' = 'change'): boolean {
    return shouldRefreshFocusTreeOnExternalFileChange(
        previewUri,
        {
            path,
            toString: () => path,
        },
        changeKind,
        liveRefreshExtensions,
    );
}
