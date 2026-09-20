import { describe, expect, it } from 'vitest';
import { SymbolPlacement } from '../src/labels/symbolPlacement.js';
import type { GlyphQuad } from '../src/labels/labelSurface.js';

const glyph = { x: 3, y: 4, endX: 8, endY: 9, born: 0 } as GlyphQuad;
describe('跨瓦片符号放置与连续透明度', () => {
  it('字形 atlas 重排保持现有符号透明度并丢弃旧 UV', () => {
    const p = new SymbolPlacement(), origin = { x: 0, y: 0 };
    p.update(new Map([['city', [glyph]], ['road', [glyph]]]), origin, 1);
    p.invalidateGlyphs();
    const quads = p.update(new Map([['city', [{ ...glyph, u: .5 }]]]), origin, 2);
    expect(quads).toHaveLength(1); expect(quads[0]!.u).toBe(.5); expect(quads[0]!.fade).toEqual([0, 1, 1]);
  });
  it('连续布局保留淡入起点，离场再出现从当前透明度恢复', () => {
    const p = new SymbolPlacement(), runs = new Map([['road', [glyph]]]), origin = { x: 0, y: 0 };
    expect(p.update(runs, origin, 1)[0]!.fade).toEqual([0, 1, 1]);
    expect(p.update(runs, origin, 1.1)[0]!.fade).toEqual([0, 1, 1]);
    expect(p.update(new Map(), origin, 1.3)[0]!.fade).toEqual([1, 0, 1.3]);
    const fade = p.update(runs, origin, 1.4)[0]!.fade!;
    expect(fade[0]).toBeCloseTo(.5); expect(fade.slice(1)).toEqual([1, 1.4]);
  });
  it('离场符号跨浮动原点保持世界位置，期限结束释放', () => {
    const p = new SymbolPlacement(); p.update(new Map([['city', [glyph]]]), { x: 100, y: 200 }, 1);
    const saved = p.update(new Map(), { x: 110, y: 220 }, 2)[0]!;
    expect([saved.x, saved.y, saved.endX, saved.endY]).toEqual([-7, 24, -2, 29]);
    expect(p.expires).toBe(2200); expect(p.update(new Map(), { x: 110, y: 220 }, 2.21)).toEqual([]);
  });
});
