import * as assert from 'assert';
import { parseMinimumProvinceSize } from '../../src/previewdef/worldmap/loader/defines';

describe('world map graphics defines', () => {
    it('uses the last uncommented minimum province size definition', () => {
        const value = parseMinimumProvinceSize(`
NGraphics = {
    NMapMode = {
        MINIMUM_PROVINCE_SIZE_IN_PIXELS = 6,
        -- MINIMUM_PROVINCE_SIZE_IN_PIXELS = 99,
        MINIMUM_PROVINCE_SIZE_IN_PIXELS = 1.2e1;
    }
}
--[[ MINIMUM_PROVINCE_SIZE_IN_PIXELS = 50, ]]
`);
        assert.strictEqual(value, 12);
    });
});
