import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
    expect(PLAYGROUND_LAYERS[9]).toMatchObject({ minZoom: 5, maxZoom: 8 });
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

    expect(MAJOR_ROAD_CLASSES).toEqual(['motorway', 'trunk', 'primary']);
    expect(majorCount).toBeGreaterThan(0);
    expect(ordinaryCount).toBeGreaterThan(0);
    expect((majorCount ?? 0) + (ordinaryCount ?? 0)).toBe(road?.features.length);
  });
});
