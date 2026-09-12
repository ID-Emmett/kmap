import { readFileSync } from 'node:fs';

import { Mesh, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { createPolygonLayerRecipe } from '../src/geometry/types.js';
import { MaterialRegistry } from '../src/rendering/materialRegistry.js';
import { PolygonTileGpuRecord } from '../src/rendering/polygonTile.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import {
  getTileAnchorMeters,
  tilePositionToLngLat,
} from '../src/spatial/mercator.js';
import { buildTilePayload } from '../src/worker/buildTile.js';
import { TILE_BUILD_PROTOCOL_VERSION } from '../src/worker/protocol.js';

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;
const FIXTURE_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);

describe('PolygonTileGpuRecord', () => {
  it('按 batch 创建有限 Mesh，共享材质并幂等释放资源', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 1,
      generation: 1,
      key: KEY,
      data: Uint8Array.from(readFileSync(FIXTURE_URL)).buffer,
      layers: [
        createPolygonLayerRecipe({
          type: 'fill',
          id: 'building-base',
          sourceLayer: 'building',
          paint: { color: '#d8dee9', opacity: 0.9 },
        }),
        createPolygonLayerRecipe({
          type: 'fill',
          id: 'building-overlay',
          sourceLayer: 'building',
          paint: { color: '#d8dee9', opacity: 0.9 },
        }),
      ],
    });
    const center = tilePositionToLngLat({
      z: KEY.z,
      x: KEY.x + 0.5,
      y: KEY.y + 0.5,
    });
    const origin = selectMapOrigin(center, KEY.z);
    const materials = new MaterialRegistry();
    const scene = new Scene();
    const record = new PolygonTileGpuRecord(payload, origin, materials);
    scene.add(record.container);

    expect(record.container.children).toHaveLength(2);
    expect(record.container.children.map((mesh) => mesh.renderOrder)).toEqual([
      0,
      1,
    ]);
    expect(record.features).toHaveLength(216);
    expect(record.stats).toMatchObject({
      batches: 2,
      features: 216,
      vertices: 5318,
      indices: 5418,
      objects: 3,
    });
    expect(record.stats.cpuBytes).toBe(record.stats.gpuBytes);
    expect(materials.getStats()).toEqual({ materials: 1, references: 2 });

    const [firstObject, secondObject] = record.container.children;
    const firstMesh = firstObject as Mesh;
    const secondMesh = secondObject as Mesh;
    expect(firstMesh?.type).toBe('Mesh');
    expect(secondMesh?.type).toBe('Mesh');
    expect(firstMesh.material).toBe(secondMesh.material);
    if (Array.isArray(firstMesh.material)) {
      throw new Error('Polygon Mesh 不应使用多材质数组。');
    }
    expect(firstMesh.material.depthTest).toBe(false);
    expect(firstMesh.material.depthWrite).toBe(false);

    const nextOrigin = selectMapOrigin(center, KEY.z + 1);
    record.setOrigin(nextOrigin);
    const globalAnchor = {
      x: nextOrigin.meters.x + record.container.position.x,
      y: nextOrigin.meters.y - record.container.position.z,
    };
    expect(globalAnchor).toEqual(getTileAnchorMeters(KEY.x, KEY.y, KEY.z));

    let materialDisposeCount = 0;
    let geometryDisposeCount = 0;
    if (Array.isArray(firstMesh.material)) {
      throw new Error('Polygon Mesh 不应使用多材质数组。');
    }
    const sharedMaterial = firstMesh.material;
    sharedMaterial.addEventListener('dispose', () => {
      materialDisposeCount += 1;
    });
    firstMesh.geometry.addEventListener('dispose', () => {
      geometryDisposeCount += 1;
    });
    secondMesh.geometry.addEventListener('dispose', () => {
      geometryDisposeCount += 1;
    });

    record.dispose();
    record.dispose();

    expect(scene.children).toHaveLength(0);
    expect(record.disposed).toBe(true);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    expect(geometryDisposeCount).toBe(2);
    expect(materialDisposeCount).toBe(1);
  });
});
