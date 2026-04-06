import * as assert from 'assert';
import { shouldHydrateFocus } from '../../src/previewdef/focustree/focushydration';

describe('focustree focus hydration', () => {
    const viewport = { width: 1280, height: 720 };

    it('hydrates selected focuses even when they are outside the viewport margin', () => {
        assert.strictEqual(shouldHydrateFocus({
            alreadyHydrated: false,
            isSelected: true,
            rect: { top: 4000, right: 4200, bottom: 4100, left: 3900 },
            viewport,
        }), true);
    });

    it('skips already hydrated focuses', () => {
        assert.strictEqual(shouldHydrateFocus({
            alreadyHydrated: true,
            isSelected: true,
            rect: { top: 0, right: 100, bottom: 100, left: 0 },
            viewport,
        }), false);
    });

    it('hydrates only focuses inside the viewport margin by default', () => {
        assert.strictEqual(shouldHydrateFocus({
            alreadyHydrated: false,
            isSelected: false,
            rect: { top: 900, right: 200, bottom: 980, left: 0 },
            viewport,
        }), true);

        assert.strictEqual(shouldHydrateFocus({
            alreadyHydrated: false,
            isSelected: false,
            rect: { top: 1200, right: 200, bottom: 1280, left: 0 },
            viewport,
        }), false);
    });
});
