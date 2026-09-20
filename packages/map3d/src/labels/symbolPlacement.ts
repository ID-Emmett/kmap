import type { GlyphQuad } from './labelSurface.js';

interface Origin { x: number; y: number }
interface PlacedSymbol { quads: GlyphQuad[]; origin: Origin; from: number; to: number; at: number }
export const SYMBOL_FADE_SECONDS = .2;
const opacityAt = (s: PlacedSymbol, now: number) => s.from + (s.to - s.from) * Math.max(0, Math.min(1, (now - s.at) / SYMBOL_FADE_SECONDS));

/** 跨布局放置身份独立于瓦片；离场与回归从当前透明度连续过渡。 */
export class SymbolPlacement {
  private readonly symbols = new Map<string, PlacedSymbol>();
  expires = Infinity;
  clear(): void { this.symbols.clear(); this.expires = Infinity; }
  /** Atlas 重排时保留放置身份与透明度，仅释放对应旧 UV 的字形。 */
  invalidateGlyphs(): void { for (const symbol of this.symbols.values()) symbol.quads = []; }
  update(visible: ReadonlyMap<string, GlyphQuad[]>, origin: Origin, now: number): GlyphQuad[] {
    for (const [id, quads] of visible) {
      let placed = this.symbols.get(id);
      if (!placed) {
        placed = { quads, origin: { ...origin }, from: 0, to: 1, at: now }; this.symbols.set(id, placed);
      } else {
        if (placed.to !== 1) { placed.from = opacityAt(placed, now); placed.to = 1; placed.at = now; }
        placed.quads = quads; placed.origin = { ...origin };
      }
    }
    this.expires = Infinity;
    for (const [id, placed] of this.symbols) {
      if (visible.has(id)) continue;
      if (placed.to !== 0) { placed.from = opacityAt(placed, now); placed.to = 0; placed.at = now; }
      if (now >= placed.at + SYMBOL_FADE_SECONDS) { this.symbols.delete(id); continue; }
      this.expires = Math.min(this.expires, (placed.at + SYMBOL_FADE_SECONDS) * 1000);
    }
    // 当前放置先写入，离场字形使用其世界锚点直到透明度收敛。
    const ordered = [...this.symbols.values()].sort((a, b) => b.to - a.to);
    return ordered.flatMap(s => s.quads.map(q => ({ ...q,
      x: q.x + s.origin.x - origin.x, y: q.y + origin.y - s.origin.y,
      ...(q.endX === undefined ? {} : { endX: q.endX + s.origin.x - origin.x, endY: q.endY! + origin.y - s.origin.y }),
      fade: [s.from, s.to, s.at] as [number, number, number],
    })));
  }
}
