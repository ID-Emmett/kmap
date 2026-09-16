import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { MapLayerOptions } from '@kmap/map3d';

import { matches as matchesLayerFilters, decodeVectorTile } from '../../../packages/map3d/src/streaming/paint.js';
import {
  MAJOR_ROAD_CLASSES,
  PLAYGROUND_LAYERS,
  PLAYGROUND_STYLE_TOKENS,
} from './mapStyle.js';

const FIXTURE_URL = new URL(
  '../../../packages/map3d/test/fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);

function decodeMvt(buffer: Uint8Array) {
  const tile = decodeVectorTile(buffer);
  return { layers: Object.fromEntries(Object.entries(tile.layers).map(([name, layer]) => [name, { features: Array.from({ length: layer.length }, (_, i) => layer.feature(i)) }])) };
}

describe('Playground light basemap style', () => {
  it('uses the approved light token palette and semantic layer order', () => {
    expect(PLAYGROUND_STYLE_TOKENS).toMatchObject({
      canvas: '#F5F5F2',
      water: '#A9D7E8',
      landuseNeutral: '#ECEDEB',
      vegetation: '#DCEBD7',
      building: '#E1E3E5',
      roadCasing: '#D4D7DA',
      roadFill: '#FFFFFF',
      majorRoadCasing: '#E1C875',
      majorRoadFill: '#F8E7AE',
    });
    expect(PLAYGROUND_LAYERS.map((layer) => layer.id)).toEqual([
      'landuse-neutral',
      'landuse-vegetation',
      'water-fill',
      'waterway-line',
      'building-fill',
      'road-casing',
      'road-fill',
      'major-road-casing',
      'major-road-fill',
      'local-road-casing',
      'local-road-fill',
      'overview-road-casing',
      'overview-road-fill',
      'transportation-casing',
      'transportation-fill',
    ]);
    expect(PLAYGROUND_LAYERS[0]).toMatchObject({
      minZoom: 5,
      filters: [{ operator: '!=', property: 'class', value: 'grass' }],
    });
    expect(PLAYGROUND_LAYERS[1]).toMatchObject({
      minZoom: 5,
      filters: [{ operator: '==', property: 'class', value: 'grass' }],
    });
    expect(PLAYGROUND_LAYERS[2]?.minZoom).toBe(0);
    expect(PLAYGROUND_LAYERS.find(l => l.id === 'transportation-casing')).toMatchObject({ minZoom: 5, maxZoom: 8 });
  });

  it('概览的 road 与 transportation 使用相同缩放范围和线宽，细路从同一相机层级启用', () => {
    const layers = PLAYGROUND_LAYERS as readonly MapLayerOptions[];
    for (const part of ['casing', 'fill']) {
      const road = layers.find(l => l.id === `overview-road-${part}`)!;
      const transport = layers.find(l => l.id === `transportation-${part}`)!;
      expect(road.paint).toEqual(transport.paint);
      expect([road.minZoom, road.maxZoom]).toEqual([transport.minZoom, transport.maxZoom]);
      expect(layers.find(l => l.id === `local-road-${part}`)!.minZoom).toBe(15);
    }
  });
  it('keeps vegetation and neutral landuse categories separate on the fixed fixture', () => {
    const tile = decodeMvt(readFileSync(FIXTURE_URL));
    const landuse = tile.layers.landuse;
    expect(landuse).toBeDefined();

    const vegetationFilter = PLAYGROUND_LAYERS[1]?.filters;
    const neutralFilter = PLAYGROUND_LAYERS[0]?.filters;
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

  it('keeps major and ordinary road filters as a complete fixture partition', () => {
    const tile = decodeMvt(readFileSync(FIXTURE_URL));
    const road = tile.layers.road;
    expect(road).toBeDefined();

    const majorFilter = PLAYGROUND_LAYERS[7]?.filters;
    const ordinaryFilter = PLAYGROUND_LAYERS[5]?.filters;
    const majorCount = road?.features.filter((feature) =>
      matchesLayerFilters(feature.properties, majorFilter),
    ).length;
    const ordinaryCount = road?.features.filter((feature) =>
      matchesLayerFilters(feature.properties, ordinaryFilter),
    ).length;
    const localFilter = (PLAYGROUND_LAYERS.find(l => l.id === 'local-road-casing') as MapLayerOptions).filters;
    const localCount = road?.features.filter(feature => matchesLayerFilters(feature.properties, localFilter)).length;

    expect(MAJOR_ROAD_CLASSES).toEqual(['motorway', 'trunk', 'primary']);
    expect(majorCount).toBeGreaterThan(0);
    expect(ordinaryCount).toBeGreaterThan(0);
    expect(localCount).toBeGreaterThan(0);
    expect((majorCount ?? 0) + (ordinaryCount ?? 0) + (localCount ?? 0)).toBe(road?.features.length);
  });
});
