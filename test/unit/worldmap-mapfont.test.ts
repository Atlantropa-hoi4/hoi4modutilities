import * as assert from 'assert';
import { parseFontFile } from '../../src/previewdef/worldmap/loader/bitmapfont';

describe('world map font', () => {
    it('uses each glyph page and rejects missing metrics and invalid source rectangles', () => {
        const font = parseFontFile(`common lineHeight=64
page id=0 file="first.dds"
page id=1 file="second.dds"
char id=65 x=1 y=2 width=20 height=30 xoffset=0 yoffset=4 xadvance=22 page=1
char id=66 x=-1 y=2 width=20 height=30 xoffset=0 yoffset=4 xadvance=22 page=0
char id=67 x=1 y=2 width=20 height=30 xoffset=0 yoffset=4 page=0
char id=68 x=1 y=2 width=20 height=30 xoffset=0 yoffset=4 xadvance=22 page=2`, 'gfx/fonts/test.fnt', new Set([65, 66, 67, 68]));
        assert.strictEqual(font.glyphs.size, 1);
        assert.strictEqual(font.glyphs.get(65)?.texture, 'gfx/fonts/second.dds');
    });

    it('loads only glyphs required by country names', () => {
        const result = parseFontFile([
            'common lineHeight=64 base=48 scaleW=256 scaleH=256 pages=1 packed=0',
            'page id=0 file="mapfont.dds"',
            'char id=65 x=1 y=2 width=20 height=30 xoffset=-1 yoffset=4 xadvance=22 page=0 chnl=15',
            'char id=66 x=21 y=2 width=18 height=30 xoffset=0 yoffset=4 xadvance=20 page=0 chnl=15',
        ].join('\n'), 'gfx/fonts/mapfont.fnt', new Set([65]));

        assert.strictEqual(result.lineHeight, 64);
        assert.strictEqual(result.glyphs.size, 1);
        assert.deepStrictEqual(result.glyphs.get(65), {
            texture: 'gfx/fonts/mapfont.dds',
            sourceX: 1,
            sourceY: 2,
            x: 0,
            y: 0,
            w: 20,
            h: 30,
            xOffset: -1,
            yOffset: 4,
            xAdvance: 22,
        });
    });
});

