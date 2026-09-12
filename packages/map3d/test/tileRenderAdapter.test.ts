import { Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import {
  createLineLayerRecipe,
  createPolygonLayerRecipe,
} from '../src/geometry/types.js';
import { buildTilePayload } from '../src/worker/buildTile.js';
import { TILE_BUILD_PROTOCOL_VERSION } from '../src/worker/protocol.js';
import { ThreeTileRenderAdapter } from '../src/rendering/tileRenderAdapter.js';
import { MaterialRegistry } from '../src/rendering/materialRegistry.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { createSyntheticMvt } from './helpers/mvtFixture.js';

const KEY = { sourceId: 'main', z: 5, x: 10, y: 12 } as const;

describe('ThreeTileRenderAdapter', () => {
  it('挂载 Polygon/Line Tile 资源、重定位并幂等释放', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 1,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createPolygonLayerRecipe({
          type: 'fill',
          id: 'fill',
          sourceLayer: 'synthetic',
          paint: { color: '#155e75' },
        }),
        createLineLayerRecipe({
          type: 'line',
          id: 'line',
          sourceLayer: 'synthetic',
          paint: { color: '#f8fafc', width: 3 },
        }, 1),
      ],
    });
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const origin = selectMapOrigin({ lng: 0, lat: 0 }, KEY.z);
    const adapter = new ThreeTileRenderAdapter(scene, materials, origin);
    const resource = adapter.upload({
      key: KEY,
      generation: 1,
      payload,
      signal: new AbortController().signal,
    });

    expect(scene.children).toHaveLength(1);
    expect(resource.stats).toMatchObject({ batches: 2, objects: 4 });
    expect(resource.stats.vertices).toBeGreaterThan(0);
    const lineMesh = scene.getObjectByName('nova-line:line');
    expect(lineMesh?.type).toBe('Mesh');
    expect(lineMesh?.renderOrder).toBe(1);
    expect(
      (lineMesh as unknown as { geometry: { getAttribute(name: string): unknown } })
        .geometry.getAttribute('previous'),
    ).toBeDefined();
    expect(
      (lineMesh as unknown as { geometry: { getAttribute(name: string): unknown } })
        .geometry.getAttribute('side'),
    ).toBeDefined();
    expect(materials.getStats()).toEqual({ materials: 2, references: 2 });

    adapter.setOrigin(selectMapOrigin({ lng: 0.1, lat: 0 }, KEY.z));
    resource.dispose();
    resource.dispose();
    expect(scene.children).toHaveLength(0);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    adapter.dispose();
    adapter.dispose();
  });

  it('复用相同 Line geometry，同时保留独立材质和 renderOrder', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 3,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createLineLayerRecipe(
          {
            type: 'line',
            id: 'line-casing',
            sourceLayer: 'synthetic',
            filters: [{ operator: 'has', property: 'name' }],
            paint: { color: '#94a3b8', opacity: 0.8, width: 6 },
          },
          7,
        ),
        createLineLayerRecipe(
          {
            type: 'line',
            id: 'line-fill',
            sourceLayer: 'synthetic',
            filters: [{ operator: 'has', property: 'name' }],
            paint: { color: '#f8fafc', opacity: 1, width: 2 },
          },
          8,
        ),
      ],
    });
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const adapter = new ThreeTileRenderAdapter(
      scene,
      materials,
      selectMapOrigin({ lng: 0, lat: 0 }, KEY.z),
    );
    const resource = adapter.upload({
      key: KEY,
      generation: 1,
      payload,
      signal: new AbortController().signal,
    });

    expect(resource.cpuBytes).toBe(payload.stats.outputBytes);
    expect(resource.stats).toMatchObject({ batches: 2, objects: 4 });
    const casingMesh = scene.getObjectByName('nova-line:line-casing');
    const fillMesh = scene.getObjectByName('nova-line:line-fill');
    expect(casingMesh).toBeInstanceOf(Mesh);
    expect(fillMesh).toBeInstanceOf(Mesh);
    const casing = casingMesh as Mesh;
    const fill = fillMesh as Mesh;
    expect(casing.geometry).toBe(fill.geometry);
    const disposeGeometry = vi.spyOn(casing.geometry, 'dispose');
    expect(casing.material).not.toBe(fill.material);
    expect(casing.renderOrder).toBe(7);
    expect(fill.renderOrder).toBe(8);
    expect(materials.getStats()).toEqual({ materials: 2, references: 2 });

    resource.setDisplayOpacity?.(0.5);
    expect((casing.material as MeshBasicNodeMaterial).opacity).toBeCloseTo(0.4);
    expect((fill.material as MeshBasicNodeMaterial).opacity).toBeCloseTo(0.5);

    resource.dispose();
    resource.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    adapter.dispose();
  });

  it('为同一 canonical Tile 挂载独立 world-wrap 实例并共享批次资源', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 2,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createLineLayerRecipe({
          type: 'line',
          id: 'line',
          sourceLayer: 'synthetic',
          paint: { color: '#22d3ee', opacity: 0.6, width: 3 },
        }),
      ],
    });
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const adapter = new ThreeTileRenderAdapter(
      scene,
      materials,
      selectMapOrigin({ lng: 0, lat: 0 }, KEY.z),
    );
    const resource = adapter.upload({
      key: KEY,
      renderKeys: [
        { canonical: KEY, wrap: 0 },
        { canonical: KEY, wrap: 1 },
      ],
      generation: 1,
      payload,
      signal: new AbortController().signal,
    });

    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.children).toHaveLength(2);
    expect(resource.stats).toMatchObject({ batches: 1, objects: 5 });
    expect(materials.getStats()).toEqual({ materials: 1, references: 1 });

    resource.setRenderKeys?.([{ canonical: KEY, wrap: 2 }]);
    expect(scene.children[0]?.children).toHaveLength(1);
    expect(scene.children[0]?.children[0]?.name).toContain('@2');
    expect(resource.stats.objects).toBe(3);

    resource.setDisplayOpacity?.(0.5);
    const displayMesh = scene.getObjectByName('nova-line:line');
    expect(displayMesh).toBeInstanceOf(Mesh);
    expect((displayMesh as Mesh).material).toMatchObject({
      opacity: 0.3,
      transparent: true,
    });
    expect((displayMesh as Mesh).material).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(((displayMesh as Mesh).material as MeshBasicNodeMaterial).colorNode)
      .toBeDefined();

    resource.dispose();
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    adapter.dispose();
  });

  it('Render key 暂时移除时保留实例和材质，重新进入复用原对象', () => {
    const payload = buildTilePayload({
      type: 'build',
      protocolVersion: TILE_BUILD_PROTOCOL_VERSION,
      jobId: 4,
      generation: 1,
      key: KEY,
      data: createSyntheticMvt().buffer as ArrayBuffer,
      layers: [
        createLineLayerRecipe({
          type: 'line',
          id: 'line',
          sourceLayer: 'synthetic',
          paint: { color: '#22d3ee', opacity: 1, width: 3 },
        }),
      ],
    });
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const adapter = new ThreeTileRenderAdapter(
      scene,
      materials,
      selectMapOrigin({ lng: 0, lat: 0 }, KEY.z),
    );
    const resource = adapter.upload({
      key: KEY,
      renderKeys: [
        { canonical: KEY, wrap: 0 },
        { canonical: KEY, wrap: 1 },
      ],
      generation: 1,
      payload,
      signal: new AbortController().signal,
    });
    const container = scene.children[0];
    if (container === undefined) {
      throw new Error('未找到 Tile container。');
    }
    const wrapZero = container.children.find((child) =>
      child.name.endsWith('@0'),
    );
    const wrapZeroMesh = wrapZero?.getObjectByName('nova-line:line');
    if (wrapZero === undefined || wrapZeroMesh === undefined) {
      throw new Error('未找到初始 Render instance。');
    }
    const disposeMaterial = vi.spyOn(
      (wrapZeroMesh as Mesh).material as MeshBasicNodeMaterial,
      'dispose',
    );

    resource.setRenderKeys?.([{ canonical: KEY, wrap: 1 }]);
    expect(wrapZero.parent).toBeNull();
    expect(disposeMaterial).not.toHaveBeenCalled();

    resource.setRenderKeys?.([{ canonical: KEY, wrap: 0 }]);
    expect(container.children.find((child) =>
      child.name.endsWith('@0'),
    )).toBe(wrapZero);
    expect(wrapZeroMesh).toBe(
      container.children
        .find((child) => child.name.endsWith('@0'))
        ?.getObjectByName('nova-line:line'),
    );
    expect(disposeMaterial).not.toHaveBeenCalled();

    resource.setDisplayOpacity?.(0.5);
    resource.setRenderKeys?.([{ canonical: KEY, wrap: 2 }]);
    const wrapTwoMesh = container.children
      .find((child) => child.name.endsWith('@2'))
      ?.getObjectByName('nova-line:line');
    expect((wrapTwoMesh as Mesh).material).toMatchObject({
      opacity: 0.5,
      transparent: true,
    });

    resource.dispose();
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
});
