import type { MapFontGlyph } from "../definitions";

export interface SourceGlyph extends MapFontGlyph {
    texture: string;
    sourceX: number;
    sourceY: number;
}

export function parseFontFile(content: string, fontFile: string, usedCharacters: Set<number>): {
    lineHeight: number,
    glyphs: Map<number, SourceGlyph>,
} {
    const common = content.match(/^common\s+.*\blineHeight=(\d+)/m);
    const directory = fontFile.substring(0, fontFile.lastIndexOf('/') + 1);
    const pages = new Map<number, string>();
    for (const page of content.matchAll(/^page\s+id=(\d+)\s+file="([^"\r\n]+)"/gm)) {
        if (!page[2].includes('..') && !/^(?:[a-z]+:|[\\/])/i.test(page[2])) {
            pages.set(Number(page[1]), directory + page[2].replace(/\\/g, '/'));
        }
    }
    const glyphs = new Map<number, SourceGlyph>();

    for (const line of content.split(/\r?\n/)) {
        if (!/^char\s+/.test(line)) {
            continue;
        }
        const values: Record<string, number> = {};
        for (const match of line.matchAll(/([a-z]+)=\s*(-?\d+)/gi)) {
            values[match[1].toLocaleLowerCase()] = Number(match[2]);
        }
        if (!usedCharacters.has(values.id) ||
            ['id', 'x', 'y', 'width', 'height', 'xoffset', 'yoffset', 'xadvance'].some(key => !Number.isSafeInteger(values[key])) ||
            values.id < 0 || values.x < 0 || values.y < 0 || values.width < 0 || values.height < 0 ||
            values.width > 1024 || values.height > 1024 || values.xadvance < 0 || values.xadvance > 2048) {
            continue;
        }
        const texture = pages.get(values.page ?? 0) ?? (pages.size === 0 ? fontFile.replace(/\.fnt$/i, '.dds') : undefined);
        if (!texture) {
            continue;
        }
        glyphs.set(values.id, {
            texture,
            sourceX: values.x,
            sourceY: values.y,
            x: 0,
            y: 0,
            w: values.width,
            h: values.height,
            xOffset: values.xoffset,
            yOffset: values.yoffset,
            xAdvance: values.xadvance,
        });
    }

    const lineHeight = Number(common?.[1] ?? 0);
    return { lineHeight: lineHeight > 0 && lineHeight <= 2048 ? lineHeight : 0, glyphs };
}

