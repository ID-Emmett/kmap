import { describe, expect, it } from 'vitest';

import { getLineGeometryBytes } from '../src/geometry/lineGeometrySharing.js';
import { buildLineBatches } from '../src/geometry/lineBatch.js';
import { createLineLayerRecipe } from '../src/geometry/types.js';
import { decodeMvt } from '../src/mvt/decodeMvt.js';
import type { TileFeatureRecord } from '../src/geometry/types.js';
import { buildTilePayload } from '../src/worker/buildTile.js';
import { TILE_BUILD_PROTOCOL_VERSION } from '../src/worker/protocol.js';
import { createSyntheticMvt } from './helpers/mvtFixture.js';

const KEY = { sourceId: 'main', z: 5, x: 10, y: 12 } as const;

describe('buildLineBatches', () => {
  it('把 LineString 构建为有限三角带并保留 feature 映射', () => {
    const features: TileFeatureRecord[] = [];
    const result = buildLineBatches(
      decodeMvt(createSyntheticMvt()),
      KEY,
      [
        createLineLayerRecipe({
          type: 'line',
          id: 'line',
          sourceLayer: 'synthetic',
          paint: { color: '#22d3ee', width: 4 },
        }),
      ],
      features,
      new Map(),
    );

    expect(result.matchedLineFeatures).toBe(1);
    expect(result.skippedLineFeatures).toBe(0);
    expect(result.batches).toHaveLength(1);
    const batch = result.batches[0]!;
    expect(batch.type).toBe('line');
    expect(batch.material.width).toBe(4);
    expect(batch.positions.length).toBeGreaterThanOrEqual(12);
    expect(batch.previous.length).toBe(batch.positions.length);
    expect(batch.next.length).toBe(batch.positions.length);
    expect(batch.sides.length).toBe(batch.positions.length / 3);
    expect(new Set(batch.sides)).toEqual(new Set([-1, 0, 1]));
    expect(batch.positions[0]).toBe(batch.positions[3]);
    expect(batch.positions[2]).toBe(batch.positions[5]);
    expect(batch.previous[0]).not.toBe(batch.positions[0]);
    expect(batch.indices.length % 3).toBe(0);
    expect(batch.featureIds.length).toBe(batch.positions.length / 3);
    expect(batch.featureRanges).toHaveLength(1);
    expect(features).toHaveLength(1);
    expect(new Set(batch.featureIds)).toEqual(new Set([0]));
  });

  it('拒绝非正 Line 宽度', () => {
    expect(() =>
      createLineLayerRecipe({
        type: 'line',
        id: 'line',
        sourceLayer: 'synthetic',
        paint: { color: '#fff', width: 0 },
      }),
    ).toThrow('line width');
  });

  it('相同 topology 的 Line 样式 pass 共享 Worker geometry buffers', () => {
    const features: TileFeatureRecord[] = [];
    const result = buildLineBatches(
      decodeMvt(createSyntheticMvt()),
      KEY,
      [
        createLineLayerRecipe(
          {
            type: 'line',
            id: 'line-casing',
            sourceLayer: 'synthetic',
            filters: [{ operator: 'has', property: 'name' }],
            paint: { color: '#94a3b8', width: 6 },
          },
          3,
        ),
        createLineLayerRecipe(
          {
            type: 'line',
            id: 'line-fill',
            sourceLayer: 'synthetic',
            filters: [{ operator: 'has', property: 'name' }],
            paint: { color: '#f8fafc', width: 2 },
          },
          4,
        ),
      ],
      features,
      new Map(),
    );

    expect(result.batches).toHaveLength(2);
    const [casing, fill] = result.batches;
    expect(casing?.geometryKey).toBe(fill?.geometryKey);
    expect(casing?.positions).toBe(fill?.positions);
    expect(casing?.previous).toBe(fill?.previous);
    expect(casing?.next).toBe(fill?.next);
    expect(casing?.sides).toBe(fill?.sides);
    expect(casing?.indices).toBe(fill?.indices);
    expect(casing?.featureIds).toBe(fill?.featureIds);
    expect(casing?.material.width).toBe(6);
    expect(fill?.material.width).toBe(2);
    expect(casing?.renderOrder).toBe(3);
    expect(fill?.renderOrder).toBe(4);
    expect(result.matchedLineFeatures).toBe(2);
    expect(result.outputBytes).toBe(getLineGeometryBytes(casing!));
    expect(result.vertices).toBe(casing!.positions.length / 3);
    expect(features).toHaveLength(1);
  });

  it('不同 filters 的 Line 图层不会错误共享 topology', () => {
    const features: TileFeatureRecord[] = [];
    const result = buildLineBatches(
      decodeMvt(createSyntheticMvt()),
      KEY,
      [
        createLineLayerRecipe({
          type: 'line',
          id: 'line-a',
          sourceLayer: 'synthetic',
          filters: [{ operator: 'has', property: 'name' }],
          paint: { color: '#94a3b8', width: 6 },
        }),
        createLineLayerRecipe({
          type: 'line',
          id: 'line-b',
          sourceLayer: 'synthetic',
          filters: [{ operator: '==', property: 'name', value: 'line' }],
          paint: { color: '#f8fafc', width: 2 },
        }),
      ],
      features,
      new Map(),
    );

    expect(result.batches).toHaveLength(2);
    const [first, second] = result.batches;
    expect(first?.geometryKey).not.toBe(second?.geometryKey);
    expect(first?.positions).not.toBe(second?.positions);
    expect(result.matchedLineFeatures).toBe(2);
    expect(result.outputBytes).toBe(
      getLineGeometryBytes(first!) + getLineGeometryBytes(second!),
    );
  });

  it('Worker payload 同时输出 Polygon/Line batch 和统一 feature table', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 1,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createLineLayerRecipe({
          type: 'line',
          id: 'line',
          sourceLayer: 'synthetic',
          paint: { color: '#22d3ee', width: 2 },
        }),
      ],
    });

    expect(payload.batches.map((batch) => batch.type)).toEqual(['line']);
    expect(payload.stats.matchedLineFeatures).toBe(1);
    expect(payload.stats.matchedPolygonFeatures).toBe(0);
    expect(payload.features).toHaveLength(1);
  });
});
