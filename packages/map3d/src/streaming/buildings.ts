import { Color, ShapeUtils, Vector2 } from 'three/webgpu';
import type { VectorTile } from '@mapbox/vector-tile';
import type { MapLayerOptions } from '../types.js';
import type { Address } from './address.js';
import { matches } from './paint.js';

/** 每瓦片一个建筑批次，屋顶、墙面、分类颜色和高度梯度共享索引缓冲。 */
export interface BuildingData {
  positions: Float32Array; normals: Float32Array; colors: Float32Array;
  styles: Float32Array; indices: Uint32Array; features: number;
}
export const buildingBytes = (d?: BuildingData): number => d ? d.positions.byteLength + d.normals.byteLength + d.colors.byteLength + d.styles.byteLength + d.indices.byteLength : 0;

export function buildBuildings(tile: VectorTile, layers: readonly MapLayerOptions[], address: Address): BuildingData {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], styles: number[] = [], indices: number[] = [];
  let features = 0;
  const scale = Math.cosh(Math.PI * (1 - 2 * (address.y + .5) / 2 ** address.z));
  for (const layer of layers) {
    if (layer.type !== 'fill-extrusion') continue;
    const source = tile.layers[layer.sourceLayer]; if (!source) continue;
    for (let i = 0; i < source.length; i++) {
      const feature = source.feature(i);
      if (feature.type !== 3 || !matches(feature.properties, layer.filters)) continue;
      const height = Number(feature.properties[layer.paint.heightProperty ?? 'height']);
      const base = Math.max(0, Number(feature.properties[layer.paint.minHeightProperty ?? 'min_height']) || 0);
      if (!Number.isFinite(height) || height <= base) continue;
      const category = String(feature.properties[layer.paint.colorProperty ?? 'kind'] ?? '');
      const color = new Color(layer.paint.categoryColors?.[category] ?? layer.paint.color);
      const polygons: Vector2[][][] = [];
      for (const ring of feature.loadGeometry()) {
        const points = ring.map(p => new Vector2(p.x, p.y));
        if (points.length < 4 || ShapeUtils.area(points) === 0) continue;
        if (ShapeUtils.area(points) > 0 || !polygons.length) polygons.push([points]); else polygons.at(-1)!.push(points);
      }
      const vertex = (p: Vector2, h: number, nx: number, ny: number, nz: number, light: number): number => {
        const index = positions.length / 3;
        positions.push(p.x / source.extent - .5, h * scale, p.y / source.extent - .5);
        normals.push(nx, ny, nz); colors.push(color.r, color.g, color.b);
        styles.push(layer.minZoom ?? 15.74, (layer.maxZoom ?? 24) + 1, light);
        return index;
      };
      for (const [outer, ...holes] of polygons) {
        const triangles = ShapeUtils.triangulateShape(outer!, holes);
        const points = [outer!, ...holes].flat(); const offset = positions.length / 3;
        for (const p of points) vertex(p, height, 0, 1, 0, 1);
        for (const [a, b, c] of triangles) indices.push(offset + a!, offset + c!, offset + b!);
        for (const ring of [outer!, ...holes]) for (let j = 0; j < ring.length; j++) {
          const a = ring[j]!, b = ring[(j + 1) % ring.length]!;
          const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
          if (!length) continue;
          // MVT 的裁切边只负责屋顶拼接，真实边界墙面由相邻瓦片各自保留。
          if ((a.x === b.x && (a.x <= 0 || a.x >= source.extent)) || (a.y === b.y && (a.y <= 0 || a.y >= source.extent))) continue;
          const index = vertex(a, base, dz / length, 0, -dx / length, .72);
          vertex(b, base, dz / length, 0, -dx / length, .72);
          vertex(b, height, dz / length, 0, -dx / length, 1);
          vertex(a, height, dz / length, 0, -dx / length, 1);
          indices.push(index, index + 2, index + 1, index, index + 3, index + 2);
        }
      }
      features++;
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors),
    styles: new Float32Array(styles), indices: new Uint32Array(indices), features };
}
