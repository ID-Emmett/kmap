import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_SOURCE } from '../../../apps/playground/src/mapSource.js';
import { PLAYGROUND_LAYERS } from '../../../apps/playground/src/mapStyle.js';
import { decodeTileSources, packTileSources } from '../src/streaming/tileSources.js';
import { buildFills } from '../src/streaming/fills.js';
import { sampleFill } from '../src/streaming/fillSample.js';
import { requestTile } from '../src/streaming/tileRequest.js';
import { OverlayCache } from '../src/streaming/overlayCache.js';

const fixture = (name: string) => Uint8Array.from(readFileSync(new URL(`./fixtures/${name}.mvt`, import.meta.url))).buffer;
const sources = PLAYGROUND_SOURCE.overlays!.filter(s => s.targetLayer.startsWith('ocean'));
const layers = PLAYGROUND_LAYERS.filter(l => l.sourceLayer.startsWith('ocean'));
const empty = new ArrayBuffer(0);
const build = (x: number, base: ArrayBuffer, detail: ArrayBuffer, z = 7, y = 55) =>
  buildFills(decodeTileSources(packTileSources([empty, base, detail]), { z, x, y }, sources), layers);

describe('真实海洋内容覆盖与视图缩放解耦', () => {
  it.each([108, 109])('详细源局部覆盖或 204：z7/%s/55 在连续缩放中保持完整海面', x => {
    const detail = x === 108 ? fixture('kye-ocean-z7-108-55') : empty;
    const base = fixture('kye-water-z6-54-27'), full = build(x, base, detail);
    const sparse = build(x, empty, detail); let detailSamples = 0;
    for (let y = 0; y < 32; y++) for (let px = 0; px < 32; px++) {
      const sx = (px + .5) / 32 - .5, sy = (y + .5) / 32 - .5;
      if (sampleFill(sparse, sx, sy, 7.34)) detailSamples++;
      for (const zoom of [6.84, 6.999, 7, 7.001, 7.34, 8, 10, 17, 22])
        expect(sampleFill(full, sx, sy, zoom), `${x}: ${px},${y},zoom=${zoom}`).toBeDefined();
    }
    expect(detailSamples).toBeLessThan(512);
    if (x === 108) expect(detailSamples).toBeGreaterThan(300);
  });
  it('台湾陆地孔洞与东岸外海保留真实几何，祖先回退仍有海面', () => {
    const base = fixture('kye-water-z6-53-27');
    const detail = Uint8Array.from(readFileSync(new URL('../../../docs/evidence/map-continuity/kye-ocean-7-107-55.mvt', import.meta.url))).buffer;
    const full = build(107, base, detail);
    const sample = (lng: number, lat: number) => sampleFill(full, (lng + 180) / 360 * 128 - 107.5,
      (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) * 64 - 55.5, 7.34);
    expect(sample(121.1, 23.5)).toBeUndefined();
    expect(sample(121.7, 23.5)).toBeDefined();
    const ancestor = build(54, fixture('kye-water-z6-54-27'), empty, 6, 27);
    expect(sampleFill(ancestor, 0, 0, 7.34)).toBeDefined();
  });
  it('主源有效时独占海陆区域，海洋回退请求按需准入且共享 URL', async () => {
    const main = fixture('kye-main-z15-26978-12416'), base = fixture('kye-water-z6-54-27');
    const fetcher = vi.fn(async (url: string) => new Response((url.includes('/kye_water/') ? base : url.includes('/kye_water_ocean/') ? empty : main).slice(0)));
    vi.stubGlobal('fetch', fetcher); const cache = new OverlayCache();
    try {
      for (const x of [108, 109]) {
        const result = await requestTile({ z: 7, x, y: 55 }, { ...PLAYGROUND_SOURCE, overlays: sources }, 1, cache, new AbortController().signal, () => {}, () => {});
        expect(result.primaryEmpty).toBe(false);
        expect(decodeTileSources(result.buffer, { z: 7, x, y: 55 }, sources).layers.ocean_base).toBeUndefined();
      }
      expect(fetcher.mock.calls.filter(([url]) => url.includes('/kye_water'))).toHaveLength(0);
      fetcher.mockImplementation(async (url: string) => url.includes('/v8Maptile/') ? new Response(null, { status: 204 }) : new Response(base.slice(0)));
      cache.dispose();
      for (const x of [108, 109]) await requestTile({ z: 7, x, y: 55 }, { ...PLAYGROUND_SOURCE, overlays: sources }, 1, cache, new AbortController().signal, () => {}, () => {});
      expect(fetcher.mock.calls.filter(([url]) => url.includes('/kye_water/'))).toHaveLength(1);
    } finally { cache.dispose(); vi.unstubAllGlobals(); }
  });
});
