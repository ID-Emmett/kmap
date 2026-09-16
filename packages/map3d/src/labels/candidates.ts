import type { VectorTile } from '@mapbox/vector-tile';
import type { MapIcon, MapLayerOptions } from '../types.js';
import { matches } from '../streaming/paint.js';
import { simplifyLine } from '../streaming/lines.js';

/** 位置采用瓦片归一化坐标；端点用于道路文字的方向与曲率检查。 */
export interface LabelCandidate {
  layerId?: string; category?: string; icon?: MapIcon | undefined;
  text: string; x: number; y: number; endX: number; endY: number; line: boolean;
  key: string; priority: number; minZoom: number; maxZoom: number; size: number;
  color: string | number; haloColor: string | number; haloWidth: number;
}
export const labelBytes = (labels: readonly LabelCandidate[] = []): number => labels.reduce((n, l) => n + 128 + (l.text.length + l.key.length) * 2, 0);
export function buildLabels(tile: VectorTile, layers: readonly MapLayerOptions[]): LabelCandidate[] {
  const labels: LabelCandidate[] = [];
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    const source = tile.layers[layer.sourceLayer]; if (!source) continue;
    for (let i = 0; i < source.length; i++) {
      const feature = source.feature(i), p = feature.properties;
      if (!matches(p, layer.filters)) continue;
      const value = (layer.layout.textFields ?? ['name']).map(field => p[field]).find(v => typeof v === 'string' && v.trim());
      if (typeof value !== 'string') continue;
      const text = value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 48); if (!text) continue;
      const rings = feature.loadGeometry(); let ring = rings.reduce((a, b) => a.length >= b.length ? a : b, rings[0] ?? []);
      if (!ring.length) continue;
      let a = ring[0]!, b = a;
      const line = layer.layout.placement === 'line';
      if (line) {
        if (feature.type !== 2) continue;
        ring = simplifyLine(ring, source.extent / 512);
        // 在最长直段上布置整行文字，端点提供严格的可容纳长度约束。
        let longest = 0;
        for (let j = 1; j < ring.length; j++) {
          const c = ring[j - 1]!, d = ring[j]!, length = Math.hypot(d.x - c.x, d.y - c.y);
          if (length > longest) { longest = length; a = c; b = d; }
        }
      } else if (feature.type !== 1) continue;
      const rank = Number(p[layer.layout.rankProperty ?? 'rank'] ?? 10);
      const dataZoom = layer.layout.minZoomProperty ? Number(p[layer.layout.minZoomProperty]) : 0;
      const classPriority = layer.layout.priorityByClass?.[String(p.class)] ?? 0;
      labels.push({ text, layerId: layer.id, category: String(p.class ?? ''), icon: layer.layout.iconByClass?.[String(p.class)], x: (a.x + b.x) / 2 / source.extent, y: (a.y + b.y) / 2 / source.extent,
        endX: b.x / source.extent, endY: b.y / source.extent, line,
        key: `${layer.id}:${String(p.osmId ?? p.osm_id ?? p.admin_code ?? p.id ?? feature.id ?? '')}:${text}`,
        priority: (layer.layout.priority ?? 100) + classPriority + (Number.isFinite(rank) ? Math.log2(Math.max(0, rank) + 1) * 2 : 10),
        minZoom: Math.max(layer.minZoom ?? 0, Number.isFinite(dataZoom) ? dataZoom : 0), maxZoom: (layer.maxZoom ?? 24) + 1, size: layer.layout.textSize ?? 14,
        color: layer.paint.colorByClass?.[String(p.class)] ?? layer.paint.color ?? '#46515a', haloColor: layer.paint.haloColor ?? '#ffffff', haloWidth: layer.paint.haloWidth ?? 1.2 });
    }
  }
  // 点与道路分别保留候选容量，视图层级过滤在全屏布局阶段执行。
  const sorted = labels.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return [...sorted.filter(l => !l.line).slice(0, 512), ...sorted.filter(l => l.line).slice(0, 512)];
}
