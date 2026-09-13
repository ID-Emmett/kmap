import type { TileBuildPayloadV1, TileLayerRecipeV1 } from '../geometry/types.js';
import { fetchVectorTile } from '../source/fetchTile.js';
import type { VectorTileSource } from '../source/types.js';
import type { TileWorkerPool } from '../worker/pool.js';
import type { StreamingSourceAdapter, StreamingWorkerAdapter } from './types.js';

/** 将已验证 KYE Source 接入新引擎，不依赖旧 Runtime adapter。 */
export class StreamingVectorSourceAdapter implements StreamingSourceAdapter {
  readonly #source: VectorTileSource;
  constructor(source: VectorTileSource) { this.#source = source; }
  async fetch(key: Parameters<StreamingSourceAdapter['fetch']>[0], options: Parameters<StreamingSourceAdapter['fetch']>[1]) {
    const result = await fetchVectorTile(this.#source, key, {
      signal: options.signal,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
    return result.status === 'empty' ? { status: 'empty' as const } : { status: 'data' as const, data: result.data };
  }
  dispose(): void {}
}

/** 将既有 Worker protocol v1 接入新引擎。 */
export class StreamingTileWorkerAdapter implements StreamingWorkerAdapter<TileBuildPayloadV1> {
  readonly #pool: TileWorkerPool;
  readonly #layers: readonly TileLayerRecipeV1[];
  constructor(pool: TileWorkerPool, layers: readonly TileLayerRecipeV1[]) { this.#pool = pool; this.#layers = layers; }
  enqueue(input: Parameters<StreamingWorkerAdapter<TileBuildPayloadV1>['enqueue']>[0]) {
    return this.#pool.enqueue({ key: input.key, generation: input.generation, data: input.data, layers: this.#layers }, { signal: input.signal, isGenerationCurrent: input.isGenerationCurrent });
  }
  dispose(): void { this.#pool.dispose(); }
}
