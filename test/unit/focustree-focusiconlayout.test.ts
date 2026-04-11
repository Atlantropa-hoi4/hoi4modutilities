import * as assert from 'assert';
import { fitFocusIconToBounds } from '../../src/previewdef/focustree/focusiconlayout';

describe('focus icon layout helpers', () => {
    it('keeps icons at natural size when they already fit', () => {
        assert.deepStrictEqual(
            fitFocusIconToBounds(64, 48, 72, 71),
            { width: 64, height: 48 },
        );
    });

    it('shrinks oversized square icons to the focus slot bounds', () => {
        assert.deepStrictEqual(
            fitFocusIconToBounds(128, 128, 72, 71),
            { width: 71, height: 71 },
        );
    });

    it('shrinks wide icons proportionally without distortion', () => {
        assert.deepStrictEqual(
            fitFocusIconToBounds(160, 80, 72, 71),
            { width: 72, height: 36 },
        );
    });
});
