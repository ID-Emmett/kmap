import { describe, expect, it } from 'vitest';
import { activeVectorLayers, normalizeBasemap, validateSatelliteSource } from '../src/basemap.js';
import { isMissingRasterTile, rasterTargetZoom, sourceRect } from '../src/raster/rasterMath.js';
import { childrenOf } from '../src/streaming/address.js';
import type { MapLayerOptions, RasterTileSourceOptions } from '../src/types.js';

const source: RasterTileSourceOptions = { id: 'satellite', tiles: ['https://example.test/{z}/{x}/{y}.jpg'],
  tileSize: 256, minZoom: 1, maxZoom: 18 };

describe('卫星底图契约', () => {
  it('全球概览按真实像素密度从有效层级读取，高缩放止于原生层级', () => {
    expect(rasterTargetZoom(0, 1, source)).toBe(1);
    expect(rasterTargetZoom(0, 2, source)).toBe(1);
    expect(rasterTargetZoom(.9, 2, source)).toBe(2);
    expect(rasterTargetZoom(17.2, 1, source)).toBe(18);
    expect(rasterTargetZoom(20, 2, source)).toBe(18);
  });
  it('祖先影像四象限 UV 连续分割，深层子区域落在正确位置', () => {
    const parent = { z: 5, x: 26, y: 12 };
    const [nw, ne, sw, se] = childrenOf(parent);
    expect(sourceRect(parent, nw!)).toEqual({ u0: 0, v0: 0, u1: .5, v1: .5 });
    expect(sourceRect(parent, ne!)).toEqual({ u0: .5, v0: 0, u1: 1, v1: .5 });
    expect(sourceRect(parent, sw!)).toEqual({ u0: 0, v0: .5, u1: .5, v1: 1 });
    expect(sourceRect(parent, se!)).toEqual({ u0: .5, v0: .5, u1: 1, v1: 1 });
    expect(() => sourceRect(parent, { z: 6, x: 0, y: 0 })).toThrow();
  });
  it('面、线和文字按独立开关产生 Worker 图层集合', () => {
    const layers = [
      { type: 'fill', id: 'land', sourceLayer: 'land', paint: { color: '#fff' } },
      { type: 'line', id: 'road', sourceLayer: 'road', paint: { color: '#fff', width: 1 } },
      { type: 'symbol', id: 'name', sourceLayer: 'place', layout: {}, paint: {} },
      { type: 'fill-extrusion', id: 'building', sourceLayer: 'building', paint: { color: '#fff', heightProperty: 'height' } },
    ] as MapLayerOptions[];
    expect(activeVectorLayers(layers, { satellite: true, vectorLines: false, labels: false })).toEqual([]);
    expect(activeVectorLayers(layers, { satellite: true, vectorLines: true, labels: false }).map(layer => layer.id)).toEqual(['road']);
    expect(activeVectorLayers(layers, { satellite: true, vectorLines: false, labels: true }).map(layer => layer.id)).toEqual(['name']);
    expect(activeVectorLayers(layers, { satellite: false, vectorLines: true, labels: true })).toHaveLength(4);
  });
  it('占位图片用内容身份判定，URL 返回 200 仍可标记为空', async () => {
    const bytes = new TextEncoder().encode('此区域无卫星图').buffer;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    expect(await isMissingRasterTile(bytes, [hash])).toBe(true);
    expect(await isMissingRasterTile(new TextEncoder().encode('有效影像').buffer, [hash])).toBe(false);
  });
  it('无效源和非布尔开关在入口拒绝', () => {
    expect(() => validateSatelliteSource({ ...source, tileSize: 300 })).toThrow('tileSize');
    expect(() => validateSatelliteSource({ ...source, tiles: ['https://example.test/{z}/{x}'] })).toThrow('XYZ');
    expect(() => normalizeBasemap({ labels: 1 as never })).toThrow('布尔');
  });
});
