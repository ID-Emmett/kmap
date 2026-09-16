import { Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import type { Map3DOptions, ViewportSize, ViewState } from '../types.js';
import type { MapOrigin } from '../spatial/types.js';
import { tileBounds, type Address } from '../streaming/address.js';
import type { TileSurfaces } from '../streaming/surface.js';
import { CollisionGrid, type LabelBox } from './collision.js';
import type { LabelCandidate } from './candidates.js';
import { GlyphAtlas, type AtlasGlyph } from './glyphAtlas.js';
import { GLYPH_BORDER, GLYPH_EM } from './glyphs.js';
import { LabelSurface, type GlyphQuad } from './labelSurface.js';

interface Projected { label: LabelCandidate; id: string; x: number; y: number; worldX: number; worldY: number; angle: number; length: number }
/** 字形加载、稳定碰撞与一个全局文字批次共用有界生命周期。 */
export class LabelSystem {
  readonly atlas: GlyphAtlas; readonly surface: LabelSurface;
  private signature = ''; private lastLayout = -Infinity; private atlasRevision = -1;
  private readonly retained = new Set<string>(); private batchOrigin = { x: 0, y: 0 };
  private readonly births = new Map<string, number>();
  candidates = 0; placed = 0; layoutMs = 0; layouts = 0;
  constructor(readonly options: NonNullable<Map3DOptions['labels']>, scene: Scene) {
    this.atlas = new GlyphAtlas(options); this.surface = new LabelSurface(this.atlas); scene.add(this.surface.mesh);
  }
  update(surfaces: TileSurfaces, camera: PerspectiveCamera, origin: MapOrigin, view: ViewState, viewport: ViewportSize, revision: number, now: number, fogEnd: number): void {
    this.surface.origin.value.set(origin.meters.x - this.batchOrigin.x, 0, this.batchOrigin.y - origin.meters.y);
    this.surface.clock.value = now / 1000;
    this.surface.viewport.value.set(viewport.width, viewport.height); this.atlas.flush();
    const signature = `${revision}:${view.center.lng}:${view.center.lat}:${view.zoom}:${view.bearing}:${view.pitch}:${viewport.width}:${viewport.height}`;
    if (signature === this.signature && this.atlasRevision === this.atlas.revision) return;
    if (now - this.lastLayout < 80) return;
    const start = performance.now(); this.lastLayout = now; this.signature = signature; this.atlasRevision = this.atlas.revision;
    const projected: Projected[] = [], point = new Vector3(), end = new Vector3();
    for (const instance of surfaces.instances.values()) {
      const address = instance.address, bounds = tileBounds(address);
      const available = instance.resource.labels;
      const tileCandidates = [...available.filter(label => !label.line).slice(0, 32), ...available.filter(label => label.line).slice(0, 32)];
      for (const label of tileCandidates) {
        if (view.zoom < label.minZoom || view.zoom >= label.maxZoom || !ownsAnchor(address, instance.cells, label.x, label.y)) continue;
        const x = bounds.west + label.x * bounds.span, y = bounds.north - label.y * bounds.span;
        point.set(x - origin.meters.x, 0, origin.meters.y - y);
        if (point.distanceTo(camera.position) > fogEnd * .9) continue;
        point.project(camera); if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1) continue;
        const screenX = (point.x + 1) * viewport.width / 2, screenY = (1 - point.y) * viewport.height / 2;
        let angle = 0, length = Infinity;
        if (label.line) {
          end.set(bounds.west + label.endX * bounds.span - origin.meters.x, 0, origin.meters.y - bounds.north + label.endY * bounds.span).project(camera);
          const dx = (end.x - point.x) * viewport.width / 2, dy = -(end.y - point.y) * viewport.height / 2;
          angle = Math.atan2(dy, dx); if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
          length = Math.hypot(dx, dy) * 2;
        }
        const id = `${label.key}:${Math.round(x / 32)}:${Math.round(y / 32)}`;
        projected.push({ label, id, x: screenX, y: screenY, worldX: x, worldY: y, angle, length });
      }
    }
    projected.sort((a, b) => (a.label.priority - (this.retained.has(a.id) ? 2 : 0)) - (b.label.priority - (this.retained.has(b.id) ? 2 : 0)) || a.id.localeCompare(b.id));
    const candidates = projected.slice(0, 1500); this.candidates = candidates.length;
    const characters = new Set<number>();
    for (const p of candidates.slice(0, 512)) for (const char of p.label.text) if (characters.size < 2048) characters.add(char.codePointAt(0)!);
    this.atlas.ensure(characters);
    const grid = new CollisionGrid(), quads: GlyphQuad[] = [], selected = new Set<string>();
    const names = new Map<string, { x: number; y: number }[]>();
    const maxLabels = Math.min(512, Math.max(1, this.options.maxLabels ?? 256));
    this.batchOrigin = { ...origin.meters }; this.surface.origin.value.set(0, 0, 0);
    for (const p of candidates) {
      if (selected.size >= maxLabels || quads.length >= 8000) break;
      const nameKey = p.label.line ? `road:${p.label.text}` : p.label.key;
      if (selected.has(p.id) || names.get(nameKey)?.some(other => Math.hypot(other.x - p.x, other.y - p.y) < 320)) continue;
      const glyphs: AtlasGlyph[] = [];
      for (const char of p.label.text) { const glyph = this.atlas.glyphs.get(char.codePointAt(0)!); if (glyph) glyphs.push(glyph); }
      if (glyphs.length !== Array.from(p.label.text).length) continue;
      const scale = p.label.size / GLYPH_EM, width = glyphs.reduce((sum, g) => sum + g.advance * scale, 0);
      if (width + 12 > p.length || width > viewport.width * .7) continue;
      const height = p.label.size + 4;
      const halfX = Math.abs(Math.cos(p.angle)) * width / 2 + Math.abs(Math.sin(p.angle)) * height / 2;
      const halfY = Math.abs(Math.sin(p.angle)) * width / 2 + Math.abs(Math.cos(p.angle)) * height / 2;
      const pad = this.retained.has(p.id) ? 2 : 5;
      const box: LabelBox = { left: p.x - halfX - pad, right: p.x + halfX + pad, top: p.y - halfY - pad, bottom: p.y + halfY + pad };
      if (box.left < 0 || box.right > viewport.width || box.top < 0 || box.bottom > viewport.height || grid.collides(box)) continue;
      grid.insert(box); selected.add(p.id); const same = names.get(nameKey) ?? []; same.push(p); names.set(nameKey, same);
      const born = this.births.get(p.id) ?? now / 1000; this.births.set(p.id, born);
      let cursor = -width / 2;
      for (const glyph of glyphs) {
        if (glyph.w) quads.push({ x: p.worldX - origin.meters.x, y: origin.meters.y - p.worldY,
          left: cursor + (glyph.left - GLYPH_BORDER) * scale, top: p.label.size * .4 - (glyph.top + GLYPH_BORDER) * scale,
          width: glyph.w * scale, height: glyph.h * scale, u: glyph.u, v: glyph.v, du: glyph.w / this.atlas.size, dv: glyph.h / this.atlas.size,
          angle: p.angle, color: p.label.color, haloColor: p.label.haloColor, haloWidth: p.label.haloWidth, scale, born });
        cursor += glyph.advance * scale;
      }
    }
    this.retained.clear(); for (const id of selected) this.retained.add(id);
    for (const id of this.births.keys()) if (!selected.has(id)) this.births.delete(id);
    this.placed = selected.size; this.surface.write(quads); this.atlas.flush(); this.layoutMs = performance.now() - start; this.layouts++;
  }
  dispose(): void { this.surface.dispose(); this.atlas.dispose(); }
}
/** 与 render cover 相同的半开区间归属，阻止父子来源同时提交同一锚点。 */
export function ownsAnchor(source: Address, cells: readonly Address[], x: number, y: number): boolean {
  return cells.some(cell => {
    const scale = 2 ** (source.z - cell.z), left = cell.x * scale - source.x, top = cell.y * scale - source.y;
    return x >= left && x < left + scale && y >= top && y < top + scale;
  });
}
