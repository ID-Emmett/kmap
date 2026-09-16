import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFills, fillBytes } from '../src/streaming/fills.js';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { sampleFill } from '../src/streaming/fillSample.js';
import type { VectorTile } from '@mapbox/vector-tile';

describe('原生面几何与样式层级', () => {
  it('同色相邻多边形共享边界且洞保持背景', () => {
    const ring = (points: number[][]) => points.map(([x, y]) => ({ x: x!, y: y! }));
    const shapes = [
      [ring([[0, 0], [8, 0], [8, 16], [0, 16], [0, 0]]), ring([[2, 2], [2, 6], [6, 6], [6, 2], [2, 2]])],
      [ring([[8, 0], [16, 0], [16, 16], [8, 16], [8, 0]])],
    ];
    const tile = { layers: { water: { extent: 16, length: shapes.length,
      feature: (i: number) => ({ type: 3, properties: {}, loadGeometry: () => shapes[i] }) } } } as unknown as VectorTile;
    const data = buildFills(tile, [{ type: 'fill', id: 'water', sourceLayer: 'water', paint: { color: '#a9d7e8' } }]);
    expect(sampleFill(data, -.25, -.25, 8)).toBeUndefined();
    const color = sampleFill(data, .2, .1, 8); expect(color).toBeDefined();
    for (const x of [-1e-7, 0, 1e-7]) expect(sampleFill(data, x, .1, 8)).toEqual(color);
  });
  it('诊断按绘制顺序合成透明图层并跳过零透明度', () => {
    const p = [-.5, 0, -.5, .5, 0, -.5, 0, 0, .5];
    const data = { positions: new Float32Array([...p, ...p]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      styles: new Float32Array([0, 25, 1, 0, 25, 1, 0, 25, 1, 0, 25, .5, 0, 25, .5, 0, 25, .5]) };
    expect(sampleFill(data, 0, 0, 8)).toEqual([.5, 0, .5]);
    for (const i of [11, 14, 17]) data.styles[i] = 0;
    expect(sampleFill(data, 0, 0, 8)).toEqual([1, 0, 0]);
  });
  it('真实海面多边形的三角形面积等于外环减洞面积', () => {
    const tile = decodeVectorTile(readFileSync(new URL('./fixtures/kye-water-z8-215-99.mvt', import.meta.url)));
    const data = buildFills(tile, [{ type: 'fill', id: 'water', sourceLayer: 'water', paint: { color: '#a9d7e8' } }]);
    const layer = tile.layers.water!; let expected = 0, actual = 0;
    for (let i = 0; i < layer.length; i++) for (const ring of layer.feature(i).loadGeometry())
      for (let j = 0; j < ring.length - 1; j++) expected += (ring[j]!.x * ring[j + 1]!.y - ring[j + 1]!.x * ring[j]!.y) / 2 / layer.extent ** 2;
    for (let i = 0; i < data.indices.length; i += 3) {
      const a = data.indices[i]! * 3, b = data.indices[i + 1]! * 3, c = data.indices[i + 2]! * 3;
      actual += Math.abs((data.positions[b]! - data.positions[a]!) * (data.positions[c + 2]! - data.positions[a + 2]!)
        - (data.positions[c]! - data.positions[a]!) * (data.positions[b + 2]! - data.positions[a + 2]!)) / 2;
    }
    expect(data.features).toBe(219); expect(actual).toBeCloseTo(expected, 6);
    expect(fillBytes(data)).toBe(data.positions.byteLength + data.colors.byteLength + data.styles.byteLength + data.indices.byteLength);
    expect(Math.max(...data.indices)).toBeLessThan(data.positions.length / 3);
  });
  it('建筑的样式可见门槛由每个顶点保留，数据构建包含原始建筑', () => {
    const tile = decodeVectorTile(readFileSync(new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url)));
    const data = buildFills(tile, [{ type: 'fill', id: 'building', sourceLayer: 'building', minZoom: 15, paint: { color: '#e1e3e5' } }]);
    expect(data.features).toBeGreaterThan(0);
    for (let i = 0; i < data.styles.length; i += 3) expect(Array.from(data.styles.slice(i, i + 3))).toEqual([15, 25, 1]);
    const [a, b, c] = Array.from(data.indices.slice(0, 3)).map(index => index * 3);
    const x = (data.positions[a!]! + data.positions[b!]! + data.positions[c!]!) / 3;
    const y = (data.positions[a! + 2]! + data.positions[b! + 2]! + data.positions[c! + 2]!) / 3;
    expect(sampleFill(data, x, y, 14.5)).toBeUndefined();
    expect(sampleFill(data, x, y, 15)).toBeDefined();
  });
});
