import { PbfReader } from 'pbf';

/** Mapbox/MapLibre glyph PBF：24px 字号、3px SDF 边界、8px 距离范围。 */
export interface Glyph { id: number; bitmap: Uint8Array; width: number; height: number; left: number; top: number; advance: number }
export const GLYPH_EM = 24, GLYPH_BORDER = 3, GLYPH_RANGE = 8;
export function decodeGlyphs(buffer: Uint8Array): Glyph[] {
  const glyphs: Glyph[] = [];
  new PbfReader(buffer).readFields((tag, _, reader) => {
    if (tag !== 1) return;
    reader.readMessage((stackTag, __, stack) => {
      if (stackTag !== 3) return;
      const glyph: Glyph = { id: 0, bitmap: new Uint8Array(0), width: 0, height: 0, left: 0, top: 0, advance: 0 };
      stack.readMessage((field, g, pbf) => {
        if (field === 1) g.id = pbf.readVarint();
        else if (field === 2) g.bitmap = pbf.readBytes();
        else if (field === 3) g.width = pbf.readVarint();
        else if (field === 4) g.height = pbf.readVarint();
        else if (field === 5) g.left = pbf.readSVarint();
        else if (field === 6) g.top = pbf.readSVarint();
        else if (field === 7) g.advance = pbf.readVarint();
      }, glyph);
      if (glyph.width > 256 || glyph.height > 256 || glyph.advance > 256) throw new Error('Glyph 尺寸超过上限。');
      if (glyph.bitmap.length && glyph.bitmap.length !== (glyph.width + 6) * (glyph.height + 6)) throw new Error('Glyph SDF 尺寸不匹配。');
      glyphs.push(glyph);
    }, {});
  }, {});
  return glyphs;
}
