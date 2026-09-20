import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYGROUND_SOURCE } from '../../../apps/playground/src/mapSource.js';
import { PLAYGROUND_LAYERS } from '../../../apps/playground/src/mapStyle.js';
import { decodeTileSources, packTileSources } from '../src/streaming/tileSources.js';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { buildFills } from '../src/streaming/fills.js';
import { sampleFill } from '../src/streaming/fillSample.js';

const fixture = (name: string) => Uint8Array.from(readFileSync(new URL(`./fixtures/${name}.mvt`, import.meta.url))).buffer;
const sources = PLAYGROUND_SOURCE.overlays!.filter(s => s.targetLayer.startsWith('ocean'));
const waterLayers = PLAYGROUND_LAYERS.filter(l => ['ocean_base', 'ocean', 'water'].includes(l.sourceLayer));
const base = fixture('kye-water-z6-52-27'), detail = fixture('kye-ocean-z7-104-55');

describe('KYE 近岸海陆权威与空水面语义', () => {
  it.each([[53561, 28621, 40], [53560, 28620, 10]])('赤柱 z16/%s/%s：水面保持主源拓扑，%s 座建筑位于陆地', (x, y, count) => {
    const address = { z: 16, x: x!, y: y! }, main = fixture(`kye-stanley-z16-${x}-${y}`);
    const primary = decodeVectorTile(main);
    const combined = decodeTileSources(packTileSources([main, base, detail]), address, sources);
    expect(combined.layers.ocean).toBeUndefined(); expect(combined.layers.ocean_base).toBeUndefined();
    const result = buildFills(combined, waterLayers), expected = buildFills(primary, waterLayers);
    const fallback = buildFills(decodeTileSources(packTileSources([new ArrayBuffer(0), base, detail]), address, sources), waterLayers);
    let sea = 0, land = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const sx = (x + .5) / 48 - .5, sy = (y + .5) / 48 - .5;
      const water = sampleFill(expected, sx, sy, 16);
      expect(sampleFill(result, sx, sy, 16)).toEqual(water);
      if (water) sea++; else land++;
    }
    expect(sea).toBeGreaterThan(0); expect(land).toBeGreaterThan(0);
    const buildings = primary.layers.building!; expect(buildings.length).toBe(count);
    let coarseFlood = 0;
    for (let i = 0; i < buildings.length; i++) {
      const ring = buildings.feature(i).loadGeometry()[0]!.slice(0, -1);
      const sx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length / buildings.extent - .5;
      const sy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length / buildings.extent - .5;
      expect(sampleFill(result, sx, sy, 16), `building ${i}`).toBeUndefined();
      if (sampleFill(fallback, sx, sy, 16)) coarseFlood++;
    }
    expect(coarseFlood).toBe(count);
  });
  it('有效的空数据层保留主瓦片陆地语义，Worker 按同一来源条件选择', () => {
    // MVT v2 的有效空 land 层；无要素是该瓦片的实际内容。
    const emptyLand = new Uint8Array([26, 11, 10, 4, 108, 97, 110, 100, 40, 128, 32, 120, 2]).buffer;
    const tile = decodeTileSources(packTileSources([emptyLand, base, detail]), { z: 16, x: 53561, y: 28621 }, sources);
    expect(Object.keys(tile.layers)).toHaveLength(0);
    expect(buildFills(tile, waterLayers).indices).toHaveLength(0);
  });
});
