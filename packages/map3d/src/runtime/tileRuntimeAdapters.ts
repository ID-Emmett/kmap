import type { TileBuildPayloadV1, TileLayerRecipeV1 } from '../geometry/types.js';
import { fetchVectorTile } from '../source/fetchTile.js';
import type { TileFetchOptions, VectorTileSource } from '../source/types.js';
import type { TileWorkerPool } from '../worker/pool.js';
import type {
  TileRuntimeSourceAdapter,
  TileRuntimeWorkerAdapter,
} from './tileRuntimeTypes.js';

/** 将 T004 Vector source/fetch 实现接入通用 TileRuntime。 */
export class VectorTileSourceAdapter implements TileRuntimeSourceAdapter {
  readonly #source: VectorTileSource;
  readonly #fetchOptions: Omit<TileFetchOptions, 'signal'>;

  constructor(
    source: VectorTileSource,
    fetchOptions: Omit<TileFetchOptions, 'signal'> = {},
  ) {
    this.#source = source;
    this.#fetchOptions = fetchOptions;
  }

  async fetch(
    key: Parameters<TileRuntimeSourceAdapter['fetch']>[0],
    options: Parameters<TileRuntimeSourceAdapter['fetch']>[1],
  ) {
    const fetchOptions: TileFetchOptions = {
      ...this.#fetchOptions,
      signal: options.signal,
    };
    if (options.onProgress !== undefined) {
      fetchOptions.onProgress = options.onProgress;
    }
    const result = await fetchVectorTile(this.#source, key, fetchOptions);
    return result.status === 'empty'
      ? { status: 'empty' as const }
      : { status: 'data' as const, data: result.data };
  }

  dispose(): void {}
}

/** 将既有 Worker Pool 和 Polygon layer recipe 接入通用 TileRuntime。 */
export class PolygonTileWorkerAdapter
implements TileRuntimeWorkerAdapter<TileBuildPayloadV1> {
  readonly #pool: TileWorkerPool;
  readonly #layers: readonly TileLayerRecipeV1[];

  constructor(pool: TileWorkerPool, layers: readonly TileLayerRecipeV1[]) {
    this.#pool = pool;
    this.#layers = layers;
  }

  enqueue(input: Parameters<TileRuntimeWorkerAdapter<TileBuildPayloadV1>['enqueue']>[0]) {
    return this.#pool.enqueue(
      {
        key: input.key,
        generation: input.generation,
        data: input.data,
        layers: this.#layers,
      },
      {
        signal: input.signal,
        isGenerationCurrent: input.isGenerationCurrent,
      },
    );
  }

  dispose(): void {
    this.#pool.dispose();
  }
}
