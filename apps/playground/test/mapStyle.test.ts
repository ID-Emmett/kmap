import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { matches as matchesLayerFilters, decodeVectorTile } from '../../../packages/map3d/src/streaming/paint.js';
import { lineWidth } from '../../../packages/map3d/src/streaming/lineStyle.js';
import {
  MAJOR_ROAD_CLASSES,
  PLAYGROUND_LAYERS,
  PLAYGROUND_STYLE_TOKENS,
} from '../src/mapStyle.js';

const FIXTURE_URL = new URL(
  '../../../packages/map3d/test/fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);

function decodeMvt(buffer: Uint8Array) {
  const tile = decodeVectorTile(buffer);
  return { layers: Object.fromEntries(Object.entries(tile.layers).map(([name, layer]) => [name, { features: Array.from({ length: layer.length }, (_, i) => layer.feature(i)) }])) };
}

describe('Playground light basemap style', () => {
  it('截图层级的高速宽度受屏幕像素约束，概览草地使用显式样式范围', () => {
    const road = PLAYGROUND_LAYERS.find(l => l.id === 'motorway-road-fill')!;
    if (road.type !== 'line') throw new Error('道路类型错误');
    expect(road.paint.widthUnit).toBe('pixels');
    expect(lineWidth(road.paint, 19.89)).toBeGreaterThan(10);
    expect(lineWidth(road.paint, 21)).toBe(18);
    expect(lineWidth(road.paint, 22)).toBeLessThan(25);
    expect(PLAYGROUND_LAYERS.some(l => l.sourceLayer === 'landcover_0')).toBe(false);
  });
  it('道路按真实类别分层，建筑具有精确可见门槛和分类色', () => {
    const building = PLAYGROUND_LAYERS.find(l => l.type === 'fill-extrusion')!;
    expect(building).toMatchObject({ sourceLayer: 'building', minZoom: 15.74, paint: { colorProperty: 'kind', heightProperty: 'height' } });
    for (const layer of PLAYGROUND_LAYERS) if (layer.type === 'line') {
      if (/road|transportation/.test(layer.id)) expect(layer.paint.widthUnit).toBe('pixels');
      expect(layer.paint.widthStops?.length).toBeGreaterThan(1);
    }
    expect(PLAYGROUND_STYLE_TOKENS.canvas).toBe('#dbdeff');
    for (const id of ['province-boundary', 'rail-dash', 'tunnel', 'ferry']) {
      const layer = PLAYGROUND_LAYERS.find(l => l.id === id)!;
      expect(layer.type === 'line' && layer.paint.dashArray?.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('keeps vegetation and neutral landuse categories separate on the fixed fixture', () => {
    const tile = decodeMvt(readFileSync(FIXTURE_URL));
    const landuse = tile.layers.landuse;
    expect(landuse).toBeDefined();

    const vegetationFilter = PLAYGROUND_LAYERS.find(layer => layer.id === 'landuse-vegetation')!.filters;
    const neutralFilter = PLAYGROUND_LAYERS.find(layer => layer.id === 'landuse-neutral')!.filters;
    const vegetationCount = landuse?.features.filter((feature) =>
      matchesLayerFilters(feature.properties, vegetationFilter),
    ).length;
    const neutralCount = landuse?.features.filter((feature) =>
      matchesLayerFilters(feature.properties, neutralFilter),
    ).length;

    expect(vegetationCount).toBeGreaterThan(0);
    expect(neutralCount).toBeGreaterThan(0);
    expect((vegetationCount ?? 0) + (neutralCount ?? 0)).toBe(
      landuse?.features.length,
    );
    expect(
      landuse?.features
        .filter((feature) => matchesLayerFilters(feature.properties, vegetationFilter))
        .every((feature) => feature.properties.class === 'grass'),
    ).toBe(true);
  });

  it('真实样本道路由一个道路或轨道填色规则覆盖', () => {
    const tile = decodeMvt(readFileSync(FIXTURE_URL));
    const layers = PLAYGROUND_LAYERS.filter(l => l.type === 'line' && l.sourceLayer === 'road' && (l.id.endsWith('-fill') || ['rail-border', 'tunnel', 'ferry'].includes(l.id)));
    expect(MAJOR_ROAD_CLASSES).toEqual(['motorway', 'trunk', 'primary']);
    for (const feature of tile.layers.road!.features) {
      const matching = layers.filter(l => matchesLayerFilters(feature.properties, l.filters));
      expect(matching.map(l => l.id), JSON.stringify(feature.properties)).toHaveLength(1);
    }
  });
});
