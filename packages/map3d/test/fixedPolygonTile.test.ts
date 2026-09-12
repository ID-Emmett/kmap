import { readFileSync } from 'node:fs';

import { Scene } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import { createPolygonLayerRecipe } from '../src/geometry/types.js';
import { MaterialRegistry } from '../src/rendering/materialRegistry.js';
import { FixedPolygonTileController } from '../src/runtime/fixedPolygonTile.js';
import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import {
  getTileAnchorMeters,
  tilePositionToLngLat,
} from '../src/spatial/mercator.js';
import { TileWorkerPool } from '../src/worker/pool.js';
import { ControlledTileWorker } from './helpers/controlledTileWorker.js';

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;
const FIXTURE_URL = new URL(
  './fixtures/kye-main-z15-26978-12416.mvt',
  import.meta.url,
);
const SOURCE = normalizeVectorTileSourceOptions({
  id: 'main',
  tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  minZoom: 0,
  maxZoom: 17,
});
const LAYERS = [
  createPolygonLayerRecipe({
    type: 'fill',
    id: 'water',
    sourceLayer: 'water',
    paint: { color: '#164e63' },
  }),
  createPolygonLayerRecipe({
    type: 'fill',
    id: 'landuse',
    sourceLayer: 'landuse',
    paint: { color: '#365314' },
  }),
  createPolygonLayerRecipe({
    type: 'fill',
    id: 'building',
    sourceLayer: 'building',
    paint: { color: '#d8dee9', opacity: 0.9 },
  }),
];

describe('FixedPolygonTileController', () => {
  it('完成固定 fixture 的 Fetch → Worker → GPU 并可 unload', async () => {
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const worker = new ControlledTileWorker();
    const workerPool = new TileWorkerPool({
      size: 1,
      createWorker: () => worker,
    });
    const fetchImpl = vi.fn(async () =>
      new Response(Uint8Array.from(readFileSync(FIXTURE_URL))),
    );
    const controller = new FixedPolygonTileController({
      source: SOURCE,
      layers: LAYERS,
      scene,
      workerPool,
      materials,
      fetchOptions: { fetch: fetchImpl },
    });
    const center = tilePositionToLngLat({
      z: KEY.z,
      x: KEY.x + 0.5,
      y: KEY.y + 0.5,
    });
    const load = controller.load(KEY, selectMapOrigin(center, KEY.z));

    await new Promise((resolve) => setTimeout(resolve, 0));
    const latestOrigin = selectMapOrigin(center, KEY.z + 1);
    controller.reposition(latestOrigin);
    await worker.drain();
    await load;

    expect(controller.state).toBe('ready');
    expect(controller.getStats()).toMatchObject({
      state: 'ready',
      inputBytes: 35594,
      batches: 3,
      features: 258,
      vertices: 4484,
      indices: 4632,
      cpuBytes: 90272,
      gpuBytes: 90272,
      objects: 4,
    });
    expect(scene.children).toHaveLength(1);
    const container = scene.children[0]!;
    expect({
      x: latestOrigin.meters.x + container.position.x,
      y: latestOrigin.meters.y - container.position.z,
    }).toEqual(getTileAnchorMeters(KEY.x, KEY.y, KEY.z));
    expect(materials.getStats()).toEqual({ materials: 3, references: 3 });
    expect(workerPool.getStats()).toEqual({ active: 0, queued: 0 });

    controller.unload();
    controller.unload();

    expect(controller.getStats()).toEqual({
      state: 'idle',
      inputBytes: 0,
      batches: 0,
      features: 0,
      vertices: 0,
      indices: 0,
      cpuBytes: 0,
      gpuBytes: 0,
      objects: 0,
    });
    expect(scene.children).toHaveLength(0);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });

    controller.dispose();
    workerPool.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('HTTP 204 形成 empty 且不创建 GPU 对象', async () => {
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const worker = new ControlledTileWorker();
    const workerPool = new TileWorkerPool({
      size: 1,
      createWorker: () => worker,
    });
    const controller = new FixedPolygonTileController({
      source: SOURCE,
      layers: LAYERS,
      scene,
      workerPool,
      materials,
      fetchOptions: { fetch: async () => new Response(null, { status: 204 }) },
    });
    const center = tilePositionToLngLat({
      z: KEY.z,
      x: KEY.x + 0.5,
      y: KEY.y + 0.5,
    });

    await controller.load(KEY, selectMapOrigin(center, KEY.z));

    expect(controller.getStats().state).toBe('empty');
    expect(scene.children).toHaveLength(0);
    expect(workerPool.getStats()).toEqual({ active: 0, queued: 0 });
    controller.dispose();
    workerPool.dispose();
  });

  it('fetch 中 unload 会取消请求并保持资源归零', async () => {
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const worker = new ControlledTileWorker();
    const workerPool = new TileWorkerPool({
      size: 1,
      createWorker: () => worker,
    });
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;

        if (signal === undefined || signal === null) {
          reject(new Error('测试请求缺少 AbortSignal。'));
          return;
        }

        signal.addEventListener(
          'abort',
          () => reject(signal.reason),
          { once: true },
        );
      });
    const controller = new FixedPolygonTileController({
      source: SOURCE,
      layers: LAYERS,
      scene,
      workerPool,
      materials,
      fetchOptions: { fetch: fetchImpl },
    });
    const center = tilePositionToLngLat({
      z: KEY.z,
      x: KEY.x + 0.5,
      y: KEY.y + 0.5,
    });
    const load = controller.load(KEY, selectMapOrigin(center, KEY.z));
    const rejection = expect(load).rejects.toMatchObject({ name: 'AbortError' });

    expect(controller.state).toBe('fetching');
    controller.unload();
    await rejection;

    expect(controller.getStats()).toEqual({
      state: 'idle',
      inputBytes: 0,
      batches: 0,
      features: 0,
      vertices: 0,
      indices: 0,
      cpuBytes: 0,
      gpuBytes: 0,
      objects: 0,
    });
    expect(scene.children).toHaveLength(0);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    expect(workerPool.getStats()).toEqual({ active: 0, queued: 0 });

    controller.dispose();
    workerPool.dispose();
  });

  it('Worker build 中 dispose 会取消 job 且拒绝迟到结果', async () => {
    const scene = new Scene();
    const materials = new MaterialRegistry();
    const worker = new ControlledTileWorker();
    const workerPool = new TileWorkerPool({
      size: 1,
      createWorker: () => worker,
    });
    const controller = new FixedPolygonTileController({
      source: SOURCE,
      layers: LAYERS,
      scene,
      workerPool,
      materials,
      fetchOptions: {
        fetch: async () =>
          new Response(Uint8Array.from(readFileSync(FIXTURE_URL))),
      },
    });
    const center = tilePositionToLngLat({
      z: KEY.z,
      x: KEY.x + 0.5,
      y: KEY.y + 0.5,
    });
    const load = controller.load(KEY, selectMapOrigin(center, KEY.z));
    const rejection = expect(load).rejects.toMatchObject({ name: 'AbortError' });

    await vi.waitFor(() => {
      expect(controller.state).toBe('building');
      expect(workerPool.getStats()).toEqual({ active: 1, queued: 0 });
    });
    controller.dispose();
    await rejection;
    await worker.drain();

    expect(controller.getStats()).toEqual({
      state: 'disposed',
      inputBytes: 0,
      batches: 0,
      features: 0,
      vertices: 0,
      indices: 0,
      cpuBytes: 0,
      gpuBytes: 0,
      objects: 0,
    });
    expect(scene.children).toHaveLength(0);
    expect(materials.getStats()).toEqual({ materials: 0, references: 0 });
    expect(workerPool.getStats()).toEqual({ active: 0, queued: 0 });

    workerPool.dispose();
  });
});
