import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three/webgpu';
import { decodeGlyphs, GLYPH_BORDER, type Glyph } from './glyphs.js';
import type { Map3DOptions } from '../types.js';

export interface AtlasGlyph extends Omit<Glyph, 'bitmap'> { u: number; v: number; w: number; h: number }
/** 一个 4 MiB SDF atlas、32 个 PBF range 缓存与最多 4 个并发字体请求。 */
export class GlyphAtlas {
  readonly size = 2048;
  readonly texture: DataTexture;
  readonly glyphs = new Map<number, AtlasGlyph>();
  readonly pages = new Map<number, Map<number, Glyph>>();
  readonly pending = new Map<number, AbortController>();
  readonly failed = new Map<number, number>();
  revision = 0; generation = 0; errors = 0; missing = 0;
  private x = 1; private y = 1; private row = 0; private dirty = false; private disposed = false;
  private wanted = new Set<number>();
  private readonly unavailable = new Set<number>();
  constructor(readonly options: NonNullable<Map3DOptions['labels']>) {
    this.texture = new DataTexture(new Uint8Array(this.size * this.size), this.size, this.size, RedFormat, UnsignedByteType);
    this.texture.minFilter = LinearFilter; this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
  }
  ensure(characters: Iterable<number>): void {
    this.wanted = new Set(Array.from(characters).slice(0, 2048));
    let overflow = false;
    for (const code of this.wanted) {
      if (this.glyphs.has(code)) continue;
      const glyph = this.pages.get(code >>> 8)?.get(code);
      if (glyph && !this.insert(glyph)) { overflow = true; break; }
    }
    if (overflow) {
      this.glyphs.clear(); this.x = this.y = 1; this.row = 0; this.generation++;
      (this.texture.image.data as Uint8Array).fill(0); this.dirty = true; this.revision++;
      for (const code of this.wanted) { const glyph = this.pages.get(code >>> 8)?.get(code); if (glyph) this.insert(glyph); }
    }
    this.pump();
  }
  private insert(glyph: Glyph): boolean {
    if (this.glyphs.has(glyph.id)) return true;
    const w = glyph.bitmap.length ? glyph.width + GLYPH_BORDER * 2 : 0, h = glyph.bitmap.length ? glyph.height + GLYPH_BORDER * 2 : 0;
    if (this.x + w + 1 > this.size) { this.x = 1; this.y += this.row + 1; this.row = 0; }
    if (this.y + h + 1 > this.size) return false;
    const data = this.texture.image.data as Uint8Array;
    for (let row = 0; row < h; row++) data.set(glyph.bitmap.subarray(row * w, (row + 1) * w), (this.y + row) * this.size + this.x);
    const { bitmap: _bitmap, ...metrics } = glyph;
    this.glyphs.set(glyph.id, { ...metrics, u: this.x / this.size, v: this.y / this.size, w, h });
    this.x += w + 1; this.row = Math.max(this.row, h); this.dirty = true; this.revision++; return true;
  }
  tick(): void { if (this.failed.size) this.pump(); }
  private pump(): void {
    if (this.disposed) return;
    const ranges = new Set([...this.wanted].filter(code => !this.glyphs.has(code) && !this.unavailable.has(code)).map(code => code >>> 8));
    for (const range of ranges) {
      if (this.pending.size >= 4) break;
      if (this.pages.has(range) || this.pending.has(range) || (this.failed.get(range) ?? 0) > performance.now()) continue;
      const controller = new AbortController(); this.pending.set(range, controller);
      const url = this.options.glyphs.replace('{fontstack}', encodeURIComponent(this.options.fontStack)).replace('{range}', `${range * 256}-${range * 256 + 255}`);
      const timeout = setTimeout(() => controller.abort(), 8000);
      void fetch(url, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`Glyph HTTP ${response.status}`);
        const buffer = await response.arrayBuffer(); if (buffer.byteLength > 1024 * 1024) throw new Error('Glyph range 超出 1 MiB。');
        if (this.disposed) return;
        const glyphs = new Map(decodeGlyphs(new Uint8Array(buffer)).map(g => [g.id, g]));
        this.pages.set(range, glyphs);
        for (const code of this.wanted) if ((code >>> 8) === range) {
          const glyph = glyphs.get(code); if (glyph) this.insert(glyph); else { this.missing++; this.unavailable.add(code); }
        }
        for (const key of this.pages.keys()) {
          if (this.pages.size <= 32) break;
          if (key !== 0xe0) this.pages.delete(key);
        }
      }).catch(() => {
        if (!this.disposed) { this.errors++; this.failed.set(range, performance.now() + 30000); }
      }).finally(() => { clearTimeout(timeout); this.pending.delete(range); this.pump(); });
    }
  }
  flush(): void { if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; } }
  dispose(): void { this.disposed = true; for (const request of this.pending.values()) request.abort(); this.texture.dispose(); this.pages.clear(); this.glyphs.clear(); }
}
