import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildPolygonBatches } from '../src/geometry/polygonBatch.js';
import { createPolygonLayerRecipe } from '../src/geometry/types.js';
import { decodeMvt } from '../src/mvt/decodeMvt.js';
import type { DecodedMvtTile } from '../src/mvt/types.js';
import { getTileSpanMeters } from '../src/spatial/mercator.js';

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;
const FIXTURE_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);

describe('buildPolygonBatches', () => {
  it('合并多个 Feature/outer ring，保留 hole 和 feature range', () => {
    const result = buildPolygonBatches(
      createPolygonTile(),
      KEY,
      [
        createPolygonLayerRecipe({
          type: 'fill',
          id: 'area-fill',
          sourceLayer: 'area',
          filters: [{ operator: '==', property: 'kind', value: 'keep' }],
          paint: { color: '#336699', opacity: 0.75 },
        }),
      ],
    );
    const batch = result.batches[0];

    expect(result.batches).toHaveLength(1);
    expect(result.features).toHaveLength(2);
    expect(result.matchedPolygonFeatures).toBe(2);
    expect(result.skippedPolygonFeatures).toBe(1);
    expect(batch?.featureRanges).toHaveLength(2);
    expect(batch?.material).toMatchObject({ color: '#336699', opacity: 0.75 });
    expect(batch?.featureIds.length).toBe((batch?.positions.length ?? 0) / 3);
    expect(Math.max(...(batch?.indices ?? []))).toBeLessThan(
      (batch?.positions.length ?? 0) / 3,
    );
    expect(allTrianglesHaveArea(batch!.positions, batch!.indices)).toBe(true);
    expect(pointIsCovered(batch!.positions, batch!.indices, 50, 50)).toBe(false);

    const metersPerExtent = getTileSpanMeters(KEY.z) / 4096;
    expect(
      triangleArea(batch!.positions, batch!.indices) /
        (metersPerExtent * metersPerExtent),
    ).toBeCloseTo(12_500, 2);
  });

  it('空 layer、过滤为空和无效 ring 不产生批次', () => {
    const tile = createPolygonTile();
    const recipes = [
      createPolygonLayerRecipe({
        type: 'fill',
        id: 'missing',
        sourceLayer: 'missing',
        paint: { color: 0xff0000 },
      }),
      createPolygonLayerRecipe({
        type: 'fill',
        id: 'filtered',
        sourceLayer: 'area',
        filters: [{ operator: '==', property: 'kind', value: 'absent' }],
        paint: { color: 0x00ff00 },
      }),
    ];

    expect(buildPolygonBatches(tile, KEY, recipes).batches).toHaveLength(0);
  });

  it('真实 KYE building Polygon 形成单一 layer/material 批次', () => {
    const tile = decodeMvt(readFileSync(FIXTURE_URL));
    const result = buildPolygonBatches(tile, KEY, [
      createPolygonLayerRecipe({
        type: 'fill',
        id: 'building-fill',
        sourceLayer: 'building',
        filters: [{ operator: 'has', property: 'buildingId' }],
        paint: { color: '#999999' },
      }),
      createPolygonLayerRecipe({
        type: 'fill',
        id: 'empty-water',
        sourceLayer: 'water',
        filters: [{ operator: '==', property: 'class', value: 'absent' }],
        paint: { color: '#0000ff' },
      }),
    ]);
    const batch = result.batches[0];


    expect(result.batches).toHaveLength(1);
    expect(result.matchedPolygonFeatures).toBe(216);
    expect(result.features).toHaveLength(216);
    expect(batch?.layerId).toBe('building-fill');
    expect(batch?.featureRanges).toHaveLength(216);
    expect(Math.max(...(batch?.indices ?? []))).toBeLessThan(
      (batch?.positions.length ?? 0) / 3,
    );
    expect(allTrianglesHaveArea(batch!.positions, batch!.indices)).toBe(true);
    const extentMeters = getTileSpanMeters(KEY.z);
    for (let index = 0; index < batch!.positions.length; index += 3) {
      expect(batch!.positions[index]!).toBeGreaterThanOrEqual(0);
      expect(batch!.positions[index]!).toBeLessThanOrEqual(extentMeters);
      expect(batch!.positions[index + 2]!).toBeGreaterThanOrEqual(0);
      expect(batch!.positions[index + 2]!).toBeLessThanOrEqual(extentMeters);
    }
  });
});

function createPolygonTile(): DecodedMvtTile {
  const outer = ring([
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ]);
  const hole = ring([
    [25, 25],
    [25, 75],
    [75, 75],
    [75, 25],
  ]);
  const secondOuter = ring([
    [150, 0],
    [200, 0],
    [200, 50],
    [150, 50],
  ]);

  return {
    layers: {
      area: {
        name: 'area',
        version: 2,
        extent: 4096,
        features: [
          {
            index: 0,
            type: 'polygon',
            properties: { kind: 'keep' },
            geometry: [outer, hole, secondOuter],
          },
          {
            index: 1,
            type: 'polygon',
            properties: { kind: 'keep' },
            geometry: [
              ring([
                [250, 0],
                [300, 0],
                [300, 50],
                [250, 50],
              ]),
            ],
          },
          {
            index: 2,
            type: 'polygon',
            properties: { kind: 'keep' },
            geometry: [ring([[0, 0], [10, 10], [20, 20]])],
          },
          {
            index: 3,
            type: 'polygon',
            properties: { kind: 'skip' },
            geometry: [outer],
          },
        ],
      },
    },
  };
}

function ring(points: readonly (readonly [number, number])[]) {
  const closed = [...points, points[0]!];
  return closed.map(([x, y]) => ({ x, y }));
}

function allTrianglesHaveArea(
  positions: Float32Array,
  indices: Uint32Array,
): boolean {
  for (let offset = 0; offset < indices.length; offset += 3) {
    if (singleTriangleArea(positions, indices, offset) === 0) {
      return false;
    }
  }
  return true;
}

function triangleArea(positions: Float32Array, indices: Uint32Array): number {
  let total = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    total += singleTriangleArea(positions, indices, offset);
  }
  return total;
}

function singleTriangleArea(
  positions: Float32Array,
  indices: Uint32Array,
  offset: number,
): number {
  const a = indices[offset]! * 3;
  const b = indices[offset + 1]! * 3;
  const c = indices[offset + 2]! * 3;
  return Math.abs(
    ((positions[b]! - positions[a]!) * (positions[c + 2]! - positions[a + 2]!) -
      (positions[b + 2]! - positions[a + 2]!) *
        (positions[c]! - positions[a]!)) /
      2,
  );
}

function pointIsCovered(
  positions: Float32Array,
  indices: Uint32Array,
  extentX: number,
  extentY: number,
): boolean {
  const scale = getTileSpanMeters(KEY.z) / 4096;
  const x = extentX * scale;
  const y = extentY * scale;

  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!]
      .map((index) => ({ x: positions[index * 3]!, y: positions[index * 3 + 2]! }));
    const [a, b, c] = vertices;

    if (a && b && c && pointInTriangle(x, y, a, b, c)) {
      return true;
    }
  }
  return false;
}

function pointInTriangle(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  const d1 = sign(x, y, a, b);
  const d2 = sign(x, y, b, c);
  const d3 = sign(x, y, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function sign(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return (x - b.x) * (a.y - b.y) - (a.x - b.x) * (y - b.y);
}
