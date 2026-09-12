import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import type { CanonicalTileKey, MapError } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import type {
  TileResourceStats,
  TileRuntimeJob,
  TileRuntimeResource,
  TileState,
} from './tileRecord.js';

export interface TileRuntimeClock {
  now(): number;
}

export type TileRuntimeFetchResult =
  | { status: 'empty' }
  | { status: 'data'; data: ArrayBuffer };

export interface TileRuntimeSourceAdapter {
  fetch(
    key: CanonicalTileKey,
    options: {
      signal: AbortSignal;
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    },
  ): Promise<TileRuntimeFetchResult>;
  dispose(): void;
}

export interface TileRuntimeWorkerInput {
  key: CanonicalTileKey;
  generation: number;
  data: ArrayBuffer;
  signal: AbortSignal;
  isGenerationCurrent: (generation: number) => boolean;
}

export interface TileRuntimeWorkerAdapter<Payload> {
  enqueue(input: TileRuntimeWorkerInput): TileRuntimeJob<Payload>;
  dispose(): void;
}

export interface TileRuntimeRenderInput<Payload> {
  key: CanonicalTileKey;
  /** 同一 canonical Tile 当前需要挂载的 world-wrap 渲染实例。 */
  renderKeys?: readonly RenderTileKey[];
  generation: number;
  payload: Payload;
  signal: AbortSignal;
}

export interface TileRuntimeRenderAdapter<Payload> {
  upload(
    input: TileRuntimeRenderInput<Payload>,
  ): Promise<TileRuntimeResource> | TileRuntimeResource;
  dispose(): void;
}

export interface TileRuntimeOptions<Payload> {
  source: TileRuntimeSourceAdapter;
  worker: TileRuntimeWorkerAdapter<Payload>;
  render: TileRuntimeRenderAdapter<Payload>;
  fetchConcurrency?: number;
  workerConcurrency?: number;
  failedCooldownMs?: number;
  maxEntries?: number;
  maxCpuBytes?: number;
  maxGpuBytes?: number;
  clock?: TileRuntimeClock;
  /** 遵循宿主环境 reduced-motion 偏好，仅跳过淡入动画。 */
  reducedMotion?: boolean;
  /** Source 实际最小数据层级，防止 fallback 访问不存在的 zoom。 */
  minFallbackZoom?: number;
}

export interface TileRuntimeStats {
  disposed: boolean;
  idle: boolean;
  consumers: {
    visible: number;
    prefetch: number;
  };
  tiles: {
    total: number;
    visible: number;
    prefetch: number;
    queued: number;
    fetching: number;
    decoding: number;
    building: number;
    ready: number;
    empty: number;
    failed: number;
  };
  requests: {
    active: number;
    queued: number;
  };
  workers: {
    active: number;
    queued: number;
  };
  uploads: {
    active: number;
  };
  resources: TileResourceStats & {
    cpuBytes: number;
    gpuBytes: number;
  };
  cache: {
    entries: number;
    retainedEntries: number;
    retainedReady: number;
    retainedEmpty: number;
    retainedFailed: number;
    readyHits: number;
    emptyHits: number;
    evictions: number;
    maxEntries: number;
    maxCpuBytes: number;
    maxGpuBytes: number;
    prefetchEnabled: boolean;
    pressure: boolean;
    pressureReasons: readonly TileMemoryPressureReason[];
  };
  scheduling: {
    coarseCoverMs?: number;
    idealRefinementMs?: number;
    requestStarts: number;
    initialRequestStarts: number;
    retryRequestStarts: number;
    evictionReloadStarts: number;
    cancellationReloadStarts: number;
    duplicateRequestStarts: number;
    requestCancels: number;
    workerStarts: number;
    workerCancels: number;
    discardedBuilds: number;
    discardedDownloadBytes: number;
    oldestQueueAgeMs: number;
  };
}

export type TileMemoryPressureReason = 'entries' | 'cpu' | 'gpu';

export interface TileRuntimeEventMap {
  error: MapError;
  idle: { stats: TileRuntimeStats };
  stats: TileRuntimeStats;
  memorypressure: {
    reasons: readonly TileMemoryPressureReason[];
    stats: TileRuntimeStats;
  };
}

export interface TileRecordSnapshot {
  key: CanonicalTileKey;
  generation: number;
  state: TileState;
  visible: boolean;
  consumers: number;
  retained: boolean;
  cpuBytes: number;
  gpuBytes: number;
  retryAt?: number;
  error?: MapError;
}

export type TileRuntimeCoverage = readonly TileCoverageEntry[];
