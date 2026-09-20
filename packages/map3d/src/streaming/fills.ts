import type { ColorBindings } from '../style/palette.js';
import { Color, ShapeUtils, Vector2 } from 'three/webgpu';
import type { VectorTile } from '@mapbox/vector-tile';
import type { MapLayerOptions } from '../types.js';
import { matches } from './paint.js';

/** 填充批次按样式顺序合并；顶点携带视图层级范围，Worker 保留源数据中的全部面。 */
export interface FillData extends ColorBindings { positions: Float32Array; colors: Float32Array; styles: Float32Array; indices: Uint32Array }
export const fillBytes = (data?: FillData): number => data ? data.positions.byteLength + data.colors.byteLength + data.styles.byteLength + data.indices.byteLength : 0;

/** MVT 外环在屏幕坐标中为正面积，洞为负面积；三角剖分共享内部边界采样。 */
export function buildFills(tile: VectorTile, layers: readonly MapLayerOptions[]): FillData & { features: number } {
  const positions: number[] = [], colors: number[] = [], styles: number[] = [], indices: number[] = [];
  const colorKeys: string[] = [], colorIds: number[] = [];
  let features = 0;
  for (const layer of layers) {
    if (layer.type !== 'fill') continue;
    const colorId = colorKeys.push(layer.id) - 1;
    const source = tile.layers[layer.sourceLayer]; if (!source) continue;
    const color = new Color(layer.paint.color);
    for (let i = 0; i < source.length; i++) {
      const feature = source.feature(i);
      if (feature.type !== 3 || !matches(feature.properties, layer.filters)) continue;
      const polygons: Vector2[][][] = [];
      for (const ring of feature.loadGeometry()) {
        if (ring.length < 4) continue;
        const points = ring.map(p => new Vector2(p.x, p.y));
        const area = ShapeUtils.area(points); if (!area) continue;
        if (area > 0 || !polygons.length) polygons.push([points]); else polygons.at(-1)!.push(points);
      }
      for (const [outer, ...holes] of polygons) {
        const triangles = ShapeUtils.triangulateShape(outer!, holes);
        const vertices = [outer!, ...holes].flat(); const offset = positions.length / 3;
        for (const p of vertices) {
          positions.push(p.x / source.extent - .5, 0, p.y / source.extent - .5);
          colors.push(color.r, color.g, color.b); colorIds.push(colorId);
          styles.push(layer.minZoom ?? 0, layer.maxZoom ?? 25, layer.paint.opacity ?? 1);
        }
        for (const triangle of triangles) indices.push(...triangle.map(index => offset + index));
      }
      features++;
    }
  }
  return { colorKeys, colorIds: new Uint16Array(colorIds), positions: new Float32Array(positions), colors: new Float32Array(colors), styles: new Float32Array(styles), indices: new Uint32Array(indices), features };
}
