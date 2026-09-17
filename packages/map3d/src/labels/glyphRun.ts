import type { AtlasGlyph } from './glyphAtlas.js';
import { GLYPH_EM } from './glyphs.js';

/** 字形墨迹边界共享基线，图标与整行文字的视觉中心位于锚点。 */
export function measureGlyphRun(glyphs: readonly AtlasGlyph[], size: number, iconSize = 0, gap = 4) {
  const scale = size / GLYPH_EM;
  let top = Infinity, bottom = -Infinity;
  for (const glyph of glyphs) if (glyph.width && glyph.height) {
    top = Math.min(top, -glyph.top * scale); bottom = Math.max(bottom, (glyph.height - glyph.top) * scale);
  }
  if (!Number.isFinite(top)) { top = -size / 2; bottom = size / 2; }
  const iconWidth = iconSize > 0 ? iconSize + gap : 0;
  return { scale, baseline: -(top + bottom) / 2, height: Math.max(bottom - top, iconSize), iconWidth,
    width: glyphs.reduce((sum, glyph) => sum + glyph.advance * scale, 0) + iconWidth };
}
