import type { MapIcon } from '../types.js';
import { GLYPH_BORDER, GLYPH_RANGE, type Glyph } from './glyphs.js';

const icons: MapIcon[] = ['metro', 'airport', 'hospital', 'school', 'park', 'museum', 'food', 'shop', 'hotel', 'capital'];
export const iconCode = (icon: MapIcon): number => 0xe000 + icons.indexOf(icon);
/** 内置图标为 24px 解析距离场，与中文共用 atlas 和 draw call。 */
export function iconGlyphs(): Map<number, Glyph> {
  const result = new Map<number, Glyph>();
  const paths: Record<MapIcon, number[][]> = {
    capital: [],
    metro: [[-5, 4, -5, -4], [-5, -4, 0, 1], [0, 1, 5, -4], [5, -4, 5, 4]],
    airport: [[0, -7, 0, 6], [-6, 1, 0, -2], [0, -2, 6, 1], [-3, 6, 0, 4], [0, 4, 3, 6]],
    hospital: [[-5, 0, 5, 0], [0, -5, 0, 5]],
    school: [[-7, -2, 0, -5], [0, -5, 7, -2], [7, -2, 0, 1], [0, 1, -7, -2], [-4, 1, -4, 4], [-4, 4, 4, 4], [4, 4, 4, 1]],
    park: [[0, -6, -5, 2], [-5, 2, 5, 2], [5, 2, 0, -6], [0, 2, 0, 6]],
    museum: [[-6, -3, 0, -6], [0, -6, 6, -3], [-6, -2, 6, -2], [-4, 0, -4, 5], [0, 0, 0, 5], [4, 0, 4, 5], [-6, 6, 6, 6]],
    food: [[-4, -6, -4, 6], [-6, -6, -6, -1], [-2, -6, -2, -1], [-6, -1, -2, -1], [4, -6, 4, 6], [2, -6, 2, 0], [2, 0, 4, 0]],
    shop: [[-6, -2, 6, -2], [-6, -2, -5, 6], [-5, 6, 5, 6], [5, 6, 6, -2], [-3, -2, -3, -6], [-3, -6, 3, -6], [3, -6, 3, -2]],
    hotel: [[-6, -5, -6, 6], [6, -1, 6, 6], [-6, 2, 6, 2], [-3, -1, 5, -1]],
  };
  for (const icon of icons) {
    const size = 24 + 2 * GLYPH_BORDER, bitmap = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x - size / 2 + .5, py = y - size / 2 + .5;
      let distance = Math.abs(Math.hypot(px, py) - 10) - .65;
      if (icon === 'capital') distance = Math.min(Math.abs(Math.hypot(px, py) - 8) - 1.6, Math.hypot(px, py) - 2.4);
      for (const [ax, ay, bx, by] of paths[icon] as [number, number, number, number][]) {
        const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        distance = Math.min(distance, Math.hypot(px - ax - dx * t, py - ay - dy * t) - .95);
      }
      bitmap[y * size + x] = Math.round(Math.max(0, Math.min(1, .75 - distance / GLYPH_RANGE)) * 255);
    }
    const id = iconCode(icon); result.set(id, { id, width: 24, height: 24, left: 0, top: 24, advance: 24, bitmap });
  }
  return result;
}
