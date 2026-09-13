import type { TileBuildPayloadV1 } from '../geometry/types.js';
import type { TileCoverageEntry, TilePriorityRole } from '../spatial/tileCoverage.js';
import type { MapError, ViewState, ViewportSize, CanonicalTileKey } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';

/** TileStreamingEngine 内部的生命周期状态。 */
export type StreamingTileState =
  | 'queued'
  | 'fetching'
  | 'decoding'
  | 'building'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'disposed';

/** Source 的最小异步边界；实现可由 HTTP Source 或测试替身提供。 */
export interface StreamingSourceAdapter {
  fetch(
    key: CanonicalTileKey,
    options: {
      signal: AbortSignal;
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    },
  ): Promise<{ status: 'data'; data: ArrayBuffer } | { status: 'empty' }>;
  dispose(): void;
}

/** Worker 的最小异步边界；generation 用于拒绝迟到结果。 */
export interface StreamingWorkerAdapter<Payload> {
  enqueue(input: {
    key: CanonicalTileKey;
    generation: number;
    data: ArrayBuffer;
    signal: AbortSignal;
    isGenerationCurrent: (generation: number) => boolean;
  }): { result: Promise<Payload>; cancel(reason?: unknown): void };
  dispose(): void;
}

/** 渲染适配器边界；资源提交由 UploadBudget 控制。 */
export interface StreamingRenderResource {
  cpuBytes: number;
  gpuBytes: number;
  stats: {
    batches: number;
    features: number;
    vertices: number;
    indices: number;
    objects: number;
  };
  setRenderKeys?(keys: readonly RenderTileKey[]): void;
  setDisplayOpacity?(opacity: number): void;
  dispose(): void;
}

export interface StreamingRenderAdapter<Payload> {
  upload(input: {
    key: CanonicalTileKey;
    renderKeys?: readonly RenderTileKey[];
    generation: number;
    payload: Payload;
    signal: AbortSignal;
  }): Promise<StreamingRenderResource> | StreamingRenderResource;
  dispose(): void;
}

export interface TileStreamingEngineOptions<Payload> {
  source: StreamingSourceAdapter;
  sourceId?: string;
  sourceMinZoom?: number;
  sourceMaxZoom?: number;
  worker: StreamingWorkerAdapter<Payload>;
  render: StreamingRenderAdapter<Payload>;
  fetchConcurrency?: number;
  workerConcurrency?: number;
  maxRequestStartsPerFrame?: number;
  maxWorkerStartsPerFrame?: number;
  maxUploadBytesPerFrame?: number;
  maxUploadCommitsPerFrame?: number;
  failedCooldownMs?: number;
  maxEntries?: number;
  maxCpuBytes?: number;
  maxGpuBytes?: number;
  minFallbackZoom?: number;
  reducedMotion?: boolean;
  clock?: { now(): number };
}

export interface TileStreamingRecordSnapshot {
  key: CanonicalTileKey;
  generation: number;
  state: StreamingTileState;
  visible: boolean;
  retained: boolean;
  cpuBytes: number;
  gpuBytes: number;
  retryAt?: number;
  error?: MapError;
}

export interface TileStreamingStats {
  disposed: boolean;
  idle: boolean;
  consumers: { visible: number; prefetch: number };
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
  requests: { active: number; queued: number };
  workers: { active: number; queued: number };
  uploads: { active: number };
  resources: {
    cpuBytes: number;
    gpuBytes: number;
    batches: number;
    features: number;
    vertices: number;
    indices: number;
    objects: number;
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
    pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[];
  };
  scheduling: {
    requestStarts: number;
    initialRequestStarts: number;
    retryRequestStarts: number;
    requestCancels: number;
    workerStarts: number;
    workerCancels: number;
    uploadCommits: number;
    oldestQueueAgeMs: number;
    queuedNotBeforeCount: number;
  };
}

export interface TileStreamingEventMap {
  error: MapError;
  stats: TileStreamingStats;
  idle: { stats: TileStreamingStats };
}

export interface StreamingCoverageEntry extends TileCoverageEntry {
  priority: TileCoverageEntry['priority'] & {
    role: TilePriorityRole;
    visible: boolean;
  };
}

export interface TileStreamingViewContext {
  view: ViewState;
  viewport: ViewportSize;
  coverage: readonly TileCoverageEntry[];
  now?: number;
}

export type DefaultTilePayload = TileBuildPayloadV1;
