import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { requestTile } from '../src/streaming/tileRequest.js';
import { OverlayCache } from '../src/streaming/overlayCache.js';
import { decodeTileSources, packTileSources } from '../src/streaming/tileSources.js';
import { buildFills } from '../src/streaming/fills.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';
import { buildLines } from '../src/streaming/lines.js';
import { PLAYGROUND_LAYERS } from '../../../apps/playground/src/mapStyle.js';
import { matches } from '../src/streaming/paint.js';

const fixture = (name: string) => Uint8Array.from(readFileSync(new URL(`../../../docs/evidence/map-continuity/${name}.mvt`, import.meta.url))).buffer;
describe('真实台湾 canonical 祖先覆盖与数据层补全', () => {
  it('主源 204 时独立海洋来源按自身层级提供真实台湾东岸几何', async () => {
    const ocean = fixture('kye-ocean-7-107-55');
    const fetcher = vi.fn(async (url: string) => url.startsWith('/ocean/') ? new Response(ocean.slice(0)) : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher); const cache = new OverlayCache();
    const overlays = [{ tiles: ['/ocean/{z}/{x}/{y}'], minZoom: 7, maxZoom: 7, sourceLayer: 'water', targetLayer: 'ocean' }];
    try {
      const address = { z: 7, x: 107, y: 55 };
      const result = await requestTile(address, { id: 'test', tiles: ['/main/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17, overlays }, 1,
        cache, new AbortController().signal, () => {}, () => {});
      expect(result).toMatchObject({ empty: false, primaryEmpty: true });
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/main/7/107/55', '/ocean/7/107/55']);
      const tile = decodeTileSources(result.buffer, address, overlays);
      expect(tile.layers.ocean!.length).toBeGreaterThan(0);
      expect(buildFills(tile, PLAYGROUND_LAYERS).positions.length).toBeGreaterThan(300);
    } finally { cache.dispose(); vi.unstubAllGlobals(); }
  });
  it('台湾区域草地网格遵循 KYE 官方 subclass 筛选，城市绿地仍可见', () => {
    const tile = decodeTileSources(fixture('v8Maptile-7-106-55'), { z: 7, x: 106, y: 55 });
    const layer = tile.layers.landuse!, style = PLAYGROUND_LAYERS.find(l => l.id === 'landuse-vegetation')!;
    expect(layer.length).toBe(173);
    expect(Array.from({ length: layer.length }, (_, i) => layer.feature(i)).filter(f => matches(f.properties, style.filters))).toHaveLength(0);
    expect(matches({ class: 'grass', subclass: 'park' }, style.filters)).toBe(true);
  });
  it.each([7, 8, 10, 12])('z%s 复用真实祖先资源覆盖台湾东侧空主源区域', z => {
    const address = { z, x: Math.floor((121.5 + 180) / 360 * 2 ** z), y: Math.floor((1 - Math.asinh(Math.tan(23.5 * Math.PI / 180)) / Math.PI) / 2 * 2 ** z) };
    const parent = { z: 6, x: 53, y: 27 };
    const cover = resolveRenderCover([address], new Set(['6/53/27']), 0);
    expect(cover.uncovered).toBe(0); expect(cover.patches[0]!.source).toEqual(parent);
    const tile = decodeTileSources(fixture('v8Maptile-6-53-27'), parent);
    expect(tile.layers.landcover_0!.length).toBeGreaterThan(0);
    const fills = buildFills(tile, PLAYGROUND_LAYERS);
    expect(fills.indices.length).toBeGreaterThan(0);
    expect(Array.from(fills.positions).every(Number.isFinite)).toBe(true);
  });
  it('补全缺失的国境线和河流，保留主源已有数据层', () => {
    const main = fixture('v8Maptile-7-106-55'), ancestor = fixture('v8Maptile-6-53-27');
    const sources = ['boundary', 'waterway', 'landcover_0'].map(sourceLayer => ({ tiles: [], minZoom: 7, maxZoom: 6, sourceLayer, targetLayer: sourceLayer, onlyWhenLayerMissing: true }));
    const tile = decodeTileSources(packTileSources([main, ancestor, ancestor, ancestor]), { z: 7, x: 106, y: 55 }, sources);
    expect(tile.layers.water!.length).toBe(983); expect(tile.layers.landuse!.length).toBe(173);
    expect(tile.layers.boundary!.length).toBeGreaterThan(0);
    expect(buildLines(tile, PLAYGROUND_LAYERS).segments.length).toBeGreaterThan(0);
  });
  it('同一祖先的多个图层共用一个传输体，实际主源几何保持独立', () => {
    const main = fixture('v8Maptile-7-106-55'), ancestor = fixture('v8Maptile-6-53-27');
    const packed = packTileSources([main, ancestor, ancestor]);
    expect(packed.byteLength).toBe(main.byteLength + ancestor.byteLength + 28);
    const sources = ['boundary', 'waterway'].map(sourceLayer => ({ tiles: [], minZoom: 7, maxZoom: 6, sourceLayer, targetLayer: sourceLayer, onlyWhenLayerMissing: true }));
    const result = decodeTileSources(packed, { z: 7, x: 106, y: 55 }, sources);
    expect(result.layers.water!.length).toBe(983);
    expect(result.layers.boundary!.length).toBeGreaterThan(0); expect(result.layers.waterway!.length).toBe(0);
  });
});
