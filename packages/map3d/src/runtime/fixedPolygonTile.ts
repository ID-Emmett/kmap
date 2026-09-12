import type { Scene } from 'three/webgpu';

import type { PolygonLayerRecipeV1 } from '../geometry/types.js';
import type {
  MaterialRegistry,
} from '../rendering/materialRegistry.js';
import {
  PolygonTileGpuRecord,
} from '../rendering/polygonTile.js';
import type { PolygonTileGpuStats } from '../rendering/polygonTile.js';
import { fetchVectorTile } from '../source/fetchTile.js';
import type { TileFetchOptions, VectorTileSource } from '../source/types.js';
import type { MapOrigin } from '../spatial/types.js';
import type { CanonicalTileKey } from '../types.js';
import type { TileBuildJob, TileWorkerPool } from '../worker/pool.js';

export type FixedPolygonTileState =
  | 'idle'
  | 'fetching'
  | 'building'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'disposed';

export interface FixedPolygonTileStats extends PolygonTileGpuStats {
  state: FixedPolygonTileState;
  inputBytes: number;
}

export interface FixedPolygonTileControllerOptions {
  source: VectorTileSource;
  layers: readonly PolygonLayerRecipeV1[];
  scene: Scene;
  workerPool: TileWorkerPool;
  materials: MaterialRegistry;
  fetchOptions?: Omit<TileFetchOptions, 'signal'>;
}

const EMPTY_GPU_STATS: Readonly<PolygonTileGpuStats> = Object.freeze({
  batches: 0,
  features: 0,
  vertices: 0,
  indices: 0,
  cpuBytes: 0,
  gpuBytes: 0,
  objects: 0,
});

/** 只管理一个固定 Polygon Tile 的 Fetch → Worker → GPU 生命周期。 */
export class FixedPolygonTileController {
  readonly #options: FixedPolygonTileControllerOptions;
  #state: FixedPolygonTileState = 'idle';
  #generation = 0;
  #abortController: AbortController | undefined;
  #job: TileBuildJob | undefined;
  #record: PolygonTileGpuRecord | undefined;
  #origin: MapOrigin | undefined;
  #inputBytes = 0;
  #disposed = false;

  constructor(options: FixedPolygonTileControllerOptions) {
    this.#options = options;
  }

  get state(): FixedPolygonTileState {
    return this.#state;
  }

  async load(key: CanonicalTileKey, origin: MapOrigin): Promise<void> {
    if (this.#disposed) {
      throw new Error('FixedPolygonTileController 已销毁。');
    }
    if (this.#state !== 'idle') {
      throw new Error(`固定 Tile 不能从 ${this.#state} 状态开始加载。`);
    }

    const generation = this.#generation + 1;
    this.#generation = generation;
    const abortController = new AbortController();
    let activeJob: TileBuildJob | undefined;
    this.#origin = origin;
    this.#abortController = abortController;
    this.#state = 'fetching';

    try {
      const result = await fetchVectorTile(this.#options.source, key, {
        ...this.#options.fetchOptions,
        signal: abortController.signal,
      });

      if (result.status === 'empty') {
        this.#state = 'empty';
        return;
      }

      this.#inputBytes = result.data.byteLength;
      this.#state = 'building';
      const job = this.#options.workerPool.enqueue(
        {
          key,
          generation,
          data: result.data,
          layers: this.#options.layers,
        },
        {
          signal: abortController.signal,
          isGenerationCurrent: (candidate) =>
            !this.#disposed && candidate === this.#generation,
        },
      );
      this.#job = job;
      activeJob = job;
      const payload = await job.result;
      const record = new PolygonTileGpuRecord(
        payload,
        this.#origin ?? origin,
        this.#options.materials,
      );
      this.#record = record;
      this.#options.scene.add(record.container);
      this.#state = 'ready';
    } catch (error) {
      if (!this.#disposed && generation === this.#generation) {
        this.#state = 'failed';
      }
      throw error;
    } finally {
      if (this.#abortController === abortController) {
        this.#abortController = undefined;
      }
      if (this.#job === activeJob) {
        this.#job = undefined;
      }
    }
  }

  /** 模拟固定 Tile 被移除；Controller 可再次加载同一或另一 Tile。 */
  unload(): void {
    if (this.#disposed) {
      return;
    }

    this.#generation += 1;
    this.#abortController?.abort(
      new DOMException('固定 Tile 已移除。', 'AbortError'),
    );
    this.#job?.cancel(new DOMException('固定 Tile 已移除。', 'AbortError'));
    this.#record?.dispose();
    this.#record = undefined;
    this.#origin = undefined;
    this.#inputBytes = 0;
    this.#state = 'idle';
  }

  getStats(): FixedPolygonTileStats {
    return {
      state: this.#state,
      inputBytes: this.#inputBytes,
      ...(this.#record?.stats ?? EMPTY_GPU_STATS),
    };
  }

  /** 浮动原点变化时更新已挂载 Tile 的 container transform。 */
  reposition(origin: MapOrigin): void {
    this.#origin = origin;
    this.#record?.setOrigin(origin);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.unload();
    this.#disposed = true;
    this.#state = 'disposed';
  }
}
