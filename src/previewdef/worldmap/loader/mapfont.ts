import { PNG } from 'pngjs';
import { parseHoi4File } from '../../../hoiformat/hoiparser';
import { convertNodeToJson } from '../../../hoiformat/schema';
import type { Enum, SchemaDef } from '../../../hoiformat/schema';
import { error } from '../../../util/debug';
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from '../../../util/fileloader';
import { getImageByPath } from '../../../util/image/imagecache';
import type { LoaderSession } from '../../../util/loader/loader';
import type { MapFont, MapFontGlyph } from '../definitions';
import type { LoadResult } from './common';
import { parseFontFile } from './bitmapfont';
import type { SourceGlyph } from './bitmapfont';

interface FontDefinition { name: string; path: string; fontfiles: Enum; }
interface FontFile { bitmapfonts: { bitmapfont: FontDefinition[]; bitmapfont_override: FontDefinition[] }[]; }
const definitionSchema: SchemaDef<FontDefinition> = { name: 'string', path: 'string', fontfiles: 'enum' };
const fontSchema: SchemaDef<FontFile> = { bitmapfonts: { _innerType: {
    bitmapfont: { _innerType: definitionSchema, _type: 'array' },
    bitmapfont_override: { _innerType: definitionSchema, _type: 'array' },
}, _type: 'array' } };

/** Packs only country-name glyphs; texture decoding retains the shared image limits and cache. */
export async function loadMapFont(names: string[], session: LoaderSession): Promise<LoadResult<MapFont | undefined>> {
    const dependencies = ['interface/*', 'interface/**/*'];
    try {
        let fontFiles = ['gfx/fonts/hoi_mapfont4'];
        const files = (await listFilesFromModOrHOI4('interface', { mod: true, hoi4: false, dlc: false, recursively: true }))
            .filter(file => file.toLowerCase().endsWith('.gfx'));
        for (const file of files) {
            session.throwIfCancelled();
            const relativeFile = 'interface/' + file;
            try {
                let matchedFiles: string[] | undefined;
                const [buffer] = await readFileFromModOrHOI4(relativeFile, { hoi4: false, dlc: false });
                const parsed = convertNodeToJson<FontFile>(parseHoi4File(buffer.toString()), fontSchema);
                for (const container of parsed.bitmapfonts) {
                    for (const font of [...container.bitmapfont, ...container.bitmapfont_override]) {
                        if (font.name?.toLowerCase() !== 'tahoma_60') {
                            continue;
                        }
                        const paths = font.fontfiles._values.length ? font.fontfiles._values : font.path ? [font.path] : [];
                        const safePaths = paths.map(value => value.replace(/^"|"$/g, '').replace(/\\/g, '/'))
                            .filter(value => !!value && !value.split('/').includes('..') && !/^(?:[a-z]+:|\/)/i.test(value));
                        if (safePaths.length) {
                            matchedFiles = safePaths;
                        }
                    }
                }
                if (matchedFiles) {
                    // Preserve fileloader source precedence while allowing overrides within
                    // one definition file to replace that file's ordinary bitmap font.
                    fontFiles = matchedFiles;
                    dependencies.push(relativeFile);
                    break;
                }
            } catch {
                // An unrelated interface file must not prevent the vanilla map-font fallback.
            }
        }
        const used = new Set(names.flatMap(name => Array.from(name.toUpperCase(), char => char.codePointAt(0)!)));
        const glyphs = new Map<number, SourceGlyph>();
        let lineHeight = 0;
        for (const path of fontFiles) {
            session.throwIfCancelled();
            const file = path.toLowerCase().endsWith('.fnt') ? path : path + '.fnt';
            dependencies.push(file);
            const [buffer] = await readFileFromModOrHOI4(file);
            const parsed = parseFontFile(buffer.toString(), file, used);
            lineHeight ||= parsed.lineHeight;
            for (const [id, glyph] of parsed.glyphs) {
                glyphs.set(id, glyph);
            }
        }
        if (!lineHeight || !glyphs.size || glyphs.size > 4096) {
            return { result: undefined, warnings: [], dependencies };
        }
        const result = await createFontAtlas(glyphs, lineHeight, dependencies, session);
        return { result, warnings: [], dependencies };
    } catch (e) {
        session.throwIfCancelled();
        error(e);
        return { result: undefined, warnings: [], dependencies };
    }
}

async function createFontAtlas(source: Map<number, SourceGlyph>, lineHeight: number, dependencies: string[], session: LoaderSession): Promise<MapFont | undefined> {
    const width = 1024;
    let x = 1, y = 1, rowHeight = 0;
    for (const glyph of source.values()) {
        if (!glyph.w || !glyph.h) { continue; }
        if (glyph.w + 2 > width) { return undefined; }
        if (x + glyph.w + 1 > width) { x = 1; y += rowHeight + 1; rowHeight = 0; }
        glyph.x = x; glyph.y = y;
        x += glyph.w + 1;
        rowHeight = Math.max(rowHeight, glyph.h);
    }
    if (y + rowHeight + 1 > 8192) { return undefined; }
    const atlas = new PNG({ width, height: Math.max(1, y + rowHeight + 1) });
    const textures = new Map<string, SourceGlyph[]>();
    for (const glyph of source.values()) {
        const page = textures.get(glyph.texture) ?? [];
        page.push(glyph); textures.set(glyph.texture, page);
    }
    for (const [texture, glyphs] of textures) {
        session.throwIfCancelled();
        dependencies.push(texture);
        const image = await getImageByPath(texture);
        if (!image) { return undefined; }
        session.throwIfCancelled();
        const decoded = PNG.sync.read(image.pngBuffer);
        for (const glyph of glyphs) {
            if (glyph.sourceX + glyph.w > decoded.width || glyph.sourceY + glyph.h > decoded.height) { return undefined; }
            for (let row = 0; row < glyph.h; row++) {
                const from = ((glyph.sourceY + row) * decoded.width + glyph.sourceX) * 4;
                atlas.data.set(decoded.data.subarray(from, from + glyph.w * 4), ((glyph.y + row) * width + glyph.x) * 4);
            }
        }
    }
    session.throwIfCancelled();
    const glyphs: Record<number, MapFontGlyph | undefined> = {};
    for (const [id, glyph] of source) {
        glyphs[id] = { x: glyph.x, y: glyph.y, w: glyph.w, h: glyph.h, xOffset: glyph.xOffset, yOffset: glyph.yOffset, xAdvance: glyph.xAdvance };
    }
    return { lineHeight, glyphs, imageUri: 'data:image/png;base64,' + PNG.sync.write(atlas).toString('base64') };
}
