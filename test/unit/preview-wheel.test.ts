import * as assert from 'assert';
import { shouldZoomWheel } from '../../src/util/previewwheel';

describe('preview wheel input', () => {
    const trackpad = { ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 7.25 };
    it('pans smooth vertical and horizontal trackpad input', () => {
        assert.strictEqual(shouldZoomWheel(trackpad, 'auto'), false);
        assert.strictEqual(shouldZoomWheel({ ...trackpad, deltaX: 10, wheelDeltaY: 120 }, 'auto'), false);
    });
    it('zooms discrete mouse wheels and line-mode wheels', () => {
        assert.strictEqual(shouldZoomWheel({ ...trackpad, wheelDeltaY: 120 }, 'auto'), true);
        assert.strictEqual(shouldZoomWheel({ ...trackpad, deltaMode: 1 }, 'auto'), true);
    });
    it('honors explicit wheel preferences and pinch/Ctrl/Cmd overrides', () => {
        assert.strictEqual(shouldZoomWheel(trackpad, 'zoom'), true);
        assert.strictEqual(shouldZoomWheel({ ...trackpad, wheelDeltaY: 120 }, 'scroll'), false);
        assert.strictEqual(shouldZoomWheel({ ...trackpad, ctrlKey: true }, 'scroll'), true);
        assert.strictEqual(shouldZoomWheel({ ...trackpad, metaKey: true }, 'auto'), true);
    });
});
