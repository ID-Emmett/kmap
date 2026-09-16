import { joinLineChains } from './lineChains.js';
import { lineJoin } from './lineJoins.js';
import { Color } from 'three/webgpu';
import type { VectorTile } from '@mapbox/vector-tile';
import type { LineLayerOptions, MapLayerOptions } from '../types.js';
import { matches } from './paint.js';

/** 每个线段作为一个胶囊实例；样式索引引用共享的连续缩放宽度表。 */
export interface LineData { segments: Float32Array; styles: Float32Array; colors: Float32Array; distances: Float32Array; joins?: Float32Array; caps?: Uint8Array; paints: LineLayerOptions['paint'][] }

/** 亚像素折点简化：误差上限为数据层级的四分之一 CSS 像素。 */
export function simplifyLine<T extends { x: number; y: number }>(points: T[], tolerance: number): T[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [0, points.length - 1]; const squared = tolerance * tolerance;
  while (stack.length) {
    const end = stack.pop()!; const start = stack.pop()!; const a = points[start]!; const b = points[end]!;
    const dx = b.x - a.x; const dy = b.y - a.y; const length = dx * dx + dy * dy;
    let largest = squared; let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!; const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (distance > largest) { largest = distance; index = i; }
    }
    if (index !== -1) { keep[index] = 1; stack.push(start, index, index, end); }
  }
  return points.filter((_, i) => keep[i]);
}

export function buildLines(tile: VectorTile, layers: readonly MapLayerOptions[], zoom = 24): LineData & { features: number } {
  type Point = { x: number; y: number };
  type Feature = { properties: Record<string, unknown>; rings: Point[][] };
  const cache = new Map<string, Feature[]>();
  const batches: { layer: Extract<MapLayerOptions, { type: 'line' }>; color: Color; extent: number; rings: Point[][] }[] = [];
  const paints = layers.filter((l): l is LineLayerOptions => l.type === 'line').map(l => l.paint);
  if (paints.length > 128) throw new Error('线图层数量上限为 128。');
  let count = 0; let featureCount = 0;
  for (const layer of layers) {
    if (layer.type !== 'line') continue;
    const source = tile.layers[layer.sourceLayer]; if (!source) continue;
    let features = cache.get(layer.sourceLayer);
    if (!features) {
      features = [];
      for (let i = 0; i < source.length; i++) {
        const feature = source.feature(i); if (feature.type !== 2) continue;
        features.push({ properties: feature.properties, rings: feature.loadGeometry().map(ring => simplifyLine(ring, source.extent / 1024)) });
      }
      cache.set(layer.sourceLayer, features);
    }
    const rings: Point[][] = [];
    for (const feature of features) {
      if (!matches(feature.properties, layer.filters)) continue;
      featureCount++;
      for (const ring of feature.rings) {
        const curved = zoom < 6 ? ring.flatMap((a, i) => {
          const b = ring[i + 1]; if (!b) return [a];
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / source.extent * 128 / 2 ** zoom));
          return Array.from({ length: steps }, (_, n) => ({ x: a.x + (b.x - a.x) * n / steps, y: a.y + (b.y - a.y) * n / steps }));
        }) : ring;
        rings.push(curved.filter((p, i) => !i || p.x !== curved[i - 1]!.x || p.y !== curved[i - 1]!.y));
        for (let j = 1; j < curved.length; j++) if (curved[j - 1]!.x !== curved[j]!.x || curved[j - 1]!.y !== curved[j]!.y) count++;
      }
    }
    const combined = layer.paint.dashArray ? rings : joinLineChains(rings).map(ring => zoom < 6 ? ring : simplifyLine(ring, source.extent / 512));
    for (const ring of rings) count -= Math.max(0, ring.length - 1);
    for (const ring of combined) count += Math.max(0, ring.length - 1);
    batches.push({ layer, color: new Color(layer.paint.color), extent: source.extent, rings: combined });
  }
  // 已知容量的 TypedArray 直接写入，描边和填色共享解码后的中心线。
  const segments = new Float32Array(count * 4); const styles = new Float32Array(count * 4); const colors = new Float32Array(count * 3);
  const distances = new Float32Array(count), joins = new Float32Array(count * 4), caps = new Uint8Array(count * 2);
  let index = 0;
  for (const { layer, color, extent, rings } of batches) {
    const styleIndex = paints.indexOf(layer.paint);
    for (const ring of rings) {
      let cumulative = 0;
      for (let j = 1; j < ring.length; j++) {
        const a = ring[j - 1]!; const b = ring[j]!;
        if (a.x === b.x && a.y === b.y) continue;
        const p = index * 4; const c = index * 3;
        const closed = ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y;
        joins.set([...lineJoin(ring[j - 2] ?? (closed ? ring.at(-2) : undefined), a, b),
          ...lineJoin(a, b, ring[j + 1] ?? (closed ? ring[1] : undefined))], p);
        caps[index * 2] = !closed && j === 1 ? 1 : 0; caps[index * 2 + 1] = !closed && j === ring.length - 1 ? 1 : 0;
        segments[p] = a.x / extent - .5; segments[p + 1] = a.y / extent - .5; segments[p + 2] = b.x / extent - .5; segments[p + 3] = b.y / extent - .5;
        styles[p] = styleIndex; styles[p + 1] = layer.paint.opacity ?? 1; styles[p + 2] = layer.minZoom ?? 0; styles[p + 3] = layer.maxZoom ?? 24;
        distances[index] = cumulative; cumulative += Math.hypot(b.x - a.x, b.y - a.y) / extent;
        colors[c] = color.r; colors[c + 1] = color.g; colors[c + 2] = color.b; index++;
      }
    }
  }
  return { segments, styles, colors, distances, joins, caps, paints, features: featureCount };
}

export const lineBytes = (lines?: LineData): number => lines ? lines.segments.byteLength + lines.styles.byteLength + lines.colors.byteLength + lines.distances.byteLength + (lines.joins?.byteLength ?? 0) + (lines.caps?.byteLength ?? 0) : 0;
/** 将当前视图 CSS 像素换算到数据瓦片局部坐标。 */
export const linePixelScale = (tileZoom: number, viewZoom: number): number => 2 ** (tileZoom - viewZoom) / 256;
