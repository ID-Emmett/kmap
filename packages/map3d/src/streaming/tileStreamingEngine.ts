import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import { canonicalTileKeyToString, renderTileKeyToString } from '../spatial/tileKey.js';
import type { CanonicalTileKey, MapError, ViewState, ViewportSize } from '../types.js';
import type { VectorTileSource } from '../source/types.js';
import type { RenderTileKey } from '../spatial/types.js';
import { TypedEventEmitter } from '../runtime/events.js';
import { normalizeStreamingError, isStreamingAbortError } from './errors.js';
import { TilePyramid } from './tilePyramid.js';
import { TileCoverSelector } from './tileCoverSelector.js';
import { TileRequestScheduler, type TileRequestTask } from './tileRequestScheduler.js';
import { TileCache } from './tileCache.js';
import { TileUploadBudget } from './tileUploadBudget.js';
import { TileRenderCover, type RenderCoverCandidate } from './tileRenderCover.js';
import { TileDiagnostics } from './tileDiagnostics.js';
import type {
  StreamingRenderResource,
  StreamingTileState,
  TileStreamingEngineOptions,
  TileStreamingEventMap,
  TileStreamingRecordSnapshot,
  TileStreamingStats,
} from './types.js';

interface StreamingRecord<Payload> {
  key: CanonicalTileKey;
  id: string;
  generation: number;
  state: StreamingTileState;
  visible: boolean;
  prefetch: boolean;
  consumers: Map<string, TileCoverageEntry>;
  resource?: StreamingRenderResource;
  payload?: Payload;
  cpuBytes: number;
  gpuBytes: number;
  error: MapError | undefined;
  retryAt: number | undefined;
  controller: AbortController;
  task?: TileRequestTask;
  queuedUpload: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

/** 全新的瓦片流式垂直切片；调度、缓存、上传和 Render Cover 在此显式编排。 */
export class TileStreamingEngine<Payload> {
  readonly #options: TileStreamingEngineOptions<Payload>;
  readonly #events = new TypedEventEmitter<TileStreamingEventMap>();
  readonly #pyramid: TilePyramid;
  readonly #selector = new TileCoverSelector();
  readonly #scheduler: TileRequestScheduler;
  readonly #cache: TileCache<Payload>;
  readonly #uploadBudget: TileUploadBudget;
  readonly #renderCover: TileRenderCover;
  readonly #diagnostics = new TileDiagnostics();
  readonly #records = new Map<string, StreamingRecord<Payload>>();
  readonly #desired = new Map<string, TileCoverageEntry>();
  readonly #idleWaiters = new Set<() => void>();
  readonly #clock: { now(): number };
  #generation = 1;
  #disposed = false;
  #lastIdle = true;
  #uploadTimer: ReturnType<typeof setTimeout> | undefined;
  #totalInitialStarts = 0;
  #totalRetryStarts = 0;
  #totalWorkerStarts = 0;
  #totalWorkerCancels = 0;
  #totalUploadCommits = 0;
  #totalRequestCancels = 0;
  #activeFetches = 0;
  #activeWorkers = 0;
  #prefetchEnabled = true;
  #pressureReasons: readonly ('entries' | 'cpu' | 'gpu')[] = Object.freeze([]);

  constructor(options: TileStreamingEngineOptions<Payload>) {
    this.#options = options;
    this.#pyramid = new TilePyramid({
      sourceId: options.sourceId ?? 'unknown',
      minZoom: options.sourceMinZoom ?? 0,
      maxZoom: options.sourceMaxZoom ?? 24,
    });
    this.#scheduler = new TileRequestScheduler({ maxStartsPerFrame: options.maxRequestStartsPerFrame ?? 8 });
    this.#cache = new TileCache({
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
      ...(options.maxCpuBytes === undefined ? {} : { maxCpuBytes: options.maxCpuBytes }),
      ...(options.maxGpuBytes === undefined ? {} : { maxGpuBytes: options.maxGpuBytes }),
    });
    this.#uploadBudget = new TileUploadBudget({
      ...(options.maxUploadBytesPerFrame === undefined ? {} : { maxBytesPerFrame: options.maxUploadBytesPerFrame }),
      ...(options.maxUploadCommitsPerFrame === undefined ? {} : { maxCommitsPerFrame: options.maxUploadCommitsPerFrame }),
    });
    this.#renderCover = new TileRenderCover(this.#pyramid);
    this.#clock = options.clock ?? { now: () => performance.now() };
  }

  on<Type extends keyof TileStreamingEventMap>(type: Type, listener: (event: TileStreamingEventMap[Type]) => void): () => void {
    if (this.#disposed) throw new Error('TileStreamingEngine 已销毁。');
    return this.#events.on(type, listener);
  }

  setMotion(_snapshot: unknown): void {
    if (this.#disposed) throw new Error('TileStreamingEngine 已销毁。');
  }

  setViewContext(view: ViewState, viewport: ViewportSize, source: VectorTileSource, _coverage: { tiles: readonly TileCoverageEntry[] }, now = this.#clock.now()): void {
    if (this.#disposed) throw new Error('TileStreamingEngine 已销毁。');
    this.#diagnostics.record({ type: 'view', at: now, detail: { zoom: view.zoom, bearing: view.bearing, pitch: view.pitch, width: viewport.width, height: viewport.height } });
    const selected = this.#selector.select({ view, viewport, source, previous: [...this.#desired.values()].map((entry) => entry.key) });
    this.#diagnostics.record({ type: 'selected-cover', at: now, detail: selected.diagnostics });
    this.setCoverage(selected.tiles, now);
  }

  setCoverage(entries: readonly TileCoverageEntry[], now = this.#clock.now()): void {
    if (this.#disposed) throw new Error('TileStreamingEngine 已销毁。');
    this.#scheduler.beginFrame(now);
    this.#desired.clear();
    for (const record of this.#records.values()) {
      record.visible = false;
      record.prefetch = false;
      record.consumers.clear();
    }
    for (const entry of entries) this.#desired.set(renderTileKeyToString(entry.key), entry);
    const canonicalEntries = new Map<string, TileCoverageEntry>();
    for (const entry of entries) {
      const id = canonicalTileKeyToString(entry.key.canonical);
      const existing = canonicalEntries.get(id);
      if (existing === undefined || (entry.priority.visible && !existing.priority.visible)) canonicalEntries.set(id, entry);
      const record = this.#ensureRecord(entry.key.canonical, now);
      record.consumers.set(renderTileKeyToString(entry.key), entry);
      record.visible = record.visible || entry.priority.visible;
      record.prefetch = !record.visible;
      record.lastAccessedAt = now;
    }
    this.#scheduler.replace([...canonicalEntries.values()], now);
    this.#lastIdle = false;
    this.#pumpRequests(now);
    this.#pumpUploads(now);
    this.#emitStats();
  }

  getTile(key: CanonicalTileKey): TileStreamingRecordSnapshot | undefined {
    const record = this.#records.get(canonicalTileKeyToString(key));
    return record === undefined ? undefined : this.#snapshot(record);
  }

  getDiagnostics(): Readonly<{ events: readonly unknown[]; dropped: number; renderCover: readonly string[] }> {
    const cover = this.#computeRenderCover();
    return Object.freeze({ events: this.#diagnostics.snapshot().events, dropped: this.#diagnostics.snapshot().dropped, renderCover: Object.freeze(cover.entries.map((entry) => renderTileKeyToString(entry.key))) });
  }

  getStats(): TileStreamingStats {
    const now = this.#clock.now();
    const counts: Record<StreamingTileState, number> = { queued: 0, fetching: 0, decoding: 0, building: 0, ready: 0, empty: 0, failed: 0, disposed: 0 };
    let visible = 0;
    let prefetch = 0;
    let visibleConsumers = 0;
    let prefetchConsumers = 0;
    let cpuBytes = 0;
    let gpuBytes = 0;
    const resources = { batches: 0, features: 0, vertices: 0, indices: 0, objects: 0 };
    let oldestQueueAgeMs = 0;
    for (const record of this.#records.values()) {
      counts[record.state] += 1;
      if (record.visible) visible += 1; else if (record.consumers.size > 0) prefetch += 1;
      for (const consumer of record.consumers.values()) consumer.priority.visible ? (visibleConsumers += 1) : (prefetchConsumers += 1);
      cpuBytes += record.cpuBytes; gpuBytes += record.gpuBytes;
      if (record.resource !== undefined) {
        resources.batches += record.resource.stats.batches;
        resources.features += record.resource.stats.features;
        resources.vertices += record.resource.stats.vertices;
        resources.indices += record.resource.stats.indices;
        resources.objects += record.resource.stats.objects;
      }
      if (record.state === 'queued') oldestQueueAgeMs = Math.max(oldestQueueAgeMs, now - record.createdAt);
    }
    const cache = this.#cache.stats();
    const scheduler = this.#scheduler.getStats(now);
    const idle = this.#isIdle();
    return {
      disposed: this.#disposed,
      idle,
      consumers: { visible: visibleConsumers, prefetch: prefetchConsumers },
      tiles: { total: this.#records.size, visible, prefetch, queued: counts.queued, fetching: counts.fetching, decoding: counts.decoding, building: counts.building, ready: counts.ready, empty: counts.empty, failed: counts.failed },
      requests: { active: scheduler.active, queued: scheduler.queued },
      workers: { active: [...this.#records.values()].filter((record) => record.state === 'decoding' || record.state === 'building').length, queued: 0 },
      uploads: { active: [...this.#records.values()].filter((record) => record.queuedUpload).length },
      resources: { cpuBytes, gpuBytes, ...resources },
      cache: { ...cache, maxEntries: this.#cache.maxEntries, maxCpuBytes: this.#cache.maxCpuBytes, maxGpuBytes: this.#cache.maxGpuBytes, prefetchEnabled: this.#prefetchEnabled, pressure: this.#pressureReasons.length > 0, pressureReasons: this.#pressureReasons },
      scheduling: { requestStarts: scheduler.requestStarts, initialRequestStarts: this.#totalInitialStarts, retryRequestStarts: this.#totalRetryStarts, requestCancels: this.#totalRequestCancels, workerStarts: this.#totalWorkerStarts, workerCancels: this.#totalWorkerCancels, uploadCommits: this.#totalUploadCommits, oldestQueueAgeMs, queuedNotBeforeCount: 0 },
    };
  }

  whenIdle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  refresh(): void {
    if (this.#disposed) throw new Error('TileStreamingEngine 已销毁。');
    this.#pumpRequests(this.#clock.now());
    this.#pumpUploads(this.#clock.now());
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#uploadTimer !== undefined) clearTimeout(this.#uploadTimer);
    this.#scheduler.clear();
    for (const record of this.#records.values()) {
      record.controller.abort(new DOMException('Tile generation 已取消。', 'AbortError'));
      record.resource?.dispose();
      record.state = 'disposed';
    }
    this.#records.clear();
    this.#desired.clear();
    this.#cache.clear();
    this.#options.worker.dispose();
    this.#options.render.dispose();
    this.#options.source.dispose();
    this.#events.clear();
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
  }

  #ensureRecord(key: CanonicalTileKey, now: number): StreamingRecord<Payload> {
    const id = canonicalTileKeyToString(key);
    const existing = this.#records.get(id);
    if (existing !== undefined) return existing;
    const cached = this.#cache.get(key, now);
    const record: StreamingRecord<Payload> = {
      key, id, generation: this.#generation++, state: cached?.state ?? 'queued', visible: false, prefetch: false, consumers: new Map(),
      ...(cached?.payload === undefined ? {} : { payload: cached.payload }),
      ...(cached?.resource === undefined ? {} : { resource: cached.resource }),
      cpuBytes: cached?.cpuBytes ?? 0, gpuBytes: cached?.gpuBytes ?? 0,
      error: cached?.error,
      retryAt: cached?.retryAt,
      controller: new AbortController(), queuedUpload: false, createdAt: now, lastAccessedAt: now,
    };
    this.#records.set(id, record);
    return record;
  }

  #pumpRequests(now: number): void {
    const maxFetches = this.#options.fetchConcurrency ?? 6;
    while (!this.#disposed && this.#activeFetches < maxFetches) {
      const task = this.#scheduler.take(now);
      if (task === undefined) break;
      const record = this.#records.get(canonicalTileKeyToString(task.key));
      if (record === undefined || (record.state !== 'queued' && record.state !== 'failed')) {
        this.#scheduler.finish(task.id);
        continue;
      }
      if (record.state === 'failed' && record.retryAt !== undefined && record.retryAt > now) {
        this.#scheduler.requeue(task, record.retryAt);
        break;
      }
      record.task = task;
      record.state = 'fetching';
      this.#activeFetches += 1;
      record.error = undefined;
      if (task.attempt === 1) this.#totalInitialStarts += 1; else this.#totalRetryStarts += 1;
      this.#diagnostics.record({ type: 'request-start', at: now, tileId: record.id, detail: { attempt: task.attempt, role: task.role } });
      void this.#runRecord(record, task);
    }
  }

  async #runRecord(record: StreamingRecord<Payload>, task: TileRequestTask): Promise<void> {
    try {
      const response = await this.#options.source.fetch(record.key, { signal: record.controller.signal });
      this.#activeFetches = Math.max(0, this.#activeFetches - 1);
      this.#scheduler.finish(task.id);
      if (record.controller.signal.aborted || this.#disposed) return;
      this.#diagnostics.record({ type: 'request-finish', at: this.#clock.now(), tileId: record.id, detail: { status: response.status } });
      if (response.status === 'empty') {
        record.state = 'empty';
        this.#cacheRecord(record);
      } else {
        const maxWorkers = this.#options.workerConcurrency ?? 4;
        while (this.#activeWorkers >= maxWorkers && !this.#disposed && !record.controller.signal.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        record.state = 'decoding';
        this.#activeWorkers += 1;
        this.#totalWorkerStarts += 1;
        this.#diagnostics.record({ type: 'worker-start', at: this.#clock.now(), tileId: record.id });
        const job = this.#options.worker.enqueue({ key: record.key, generation: record.generation, data: response.data, signal: record.controller.signal, isGenerationCurrent: (generation) => generation === record.generation && !this.#disposed });
        const payload = await job.result;
        this.#activeWorkers = Math.max(0, this.#activeWorkers - 1);
        if (record.controller.signal.aborted || this.#disposed) return;
        record.state = 'building';
        record.payload = payload;
        this.#diagnostics.record({ type: 'worker-finish', at: this.#clock.now(), tileId: record.id });
        record.queuedUpload = true;
        this.#pumpUploads(this.#clock.now());
      }
    } catch (error) {
      this.#activeFetches = Math.max(0, this.#activeFetches - 1);
      this.#activeWorkers = Math.max(0, this.#activeWorkers - 1);
      this.#scheduler.finish(task.id);
      if (this.#disposed || isStreamingAbortError(error)) return;
      record.state = 'failed';
      record.error = normalizeStreamingError(error, record.key, 'request');
      record.retryAt = this.#clock.now() + (this.#options.failedCooldownMs ?? 1_000);
      this.#cacheRecord(record);
      this.#events.emit('error', record.error);
    } finally {
      if (!this.#disposed) {
        const nextNow = this.#clock.now();
        this.#scheduler.beginFrame(nextNow);
        this.#pumpRequests(nextNow);
        this.#pumpUploads(nextNow);
      }
      this.#emitStats();
      this.#resolveIdleIfReady();
    }
  }

  #pumpUploads(now: number): void {
    this.#uploadBudget.beginFrame();
    for (const record of this.#records.values()) {
      if (!record.queuedUpload || record.payload === undefined || this.#disposed) continue;
      const bytes = payloadBytes(record.payload);
      const reservation = this.#uploadBudget.reserve(bytes);
      if (reservation === undefined) {
        if (this.#uploadTimer === undefined) this.#uploadTimer = setTimeout(() => { this.#uploadTimer = undefined; this.#pumpUploads(this.#clock.now()); }, 16);
        continue;
      }
      record.queuedUpload = false;
      void Promise.resolve(this.#options.render.upload({ key: record.key, renderKeys: [...record.consumers.values()].map((entry) => entry.key), generation: record.generation, payload: record.payload, signal: record.controller.signal }))
        .then((resource) => {
          if (this.#disposed || record.controller.signal.aborted) { resource.dispose(); reservation.release(); return; }
          reservation.commit();
          this.#totalUploadCommits += 1;
          record.resource = resource;
          record.cpuBytes = resource.cpuBytes;
          record.gpuBytes = resource.gpuBytes;
          record.state = 'ready';
          this.#cacheRecord(record);
          this.#diagnostics.record({ type: 'upload', at: this.#clock.now(), tileId: record.id, detail: { bytes } });
          this.#diagnostics.record({ type: 'commit', at: this.#clock.now(), tileId: record.id });
          this.#emitStats();
          this.#resolveIdleIfReady();
        })
        .catch((error: unknown) => {
          reservation.release();
          if (!this.#disposed && !isStreamingAbortError(error)) {
            record.state = 'failed';
            record.error = normalizeStreamingError(error, record.key, 'upload');
            this.#events.emit('error', record.error);
          }
        });
    }
    this.#diagnostics.record({ type: 'frame', at: now, detail: { uploadBytes: this.#uploadBudget.usedBytes, uploadCommits: this.#uploadBudget.commitsThisFrame } });
  }

  #cacheRecord(record: StreamingRecord<Payload>): void {
    if (record.state !== 'ready' && record.state !== 'empty' && record.state !== 'failed') return;
    this.#cache.set({ key: record.key, generation: record.generation, state: record.state, ...(record.payload === undefined ? {} : { payload: record.payload }), ...(record.resource === undefined ? {} : { resource: record.resource }), cpuBytes: record.cpuBytes, gpuBytes: record.gpuBytes, ...(record.error === undefined ? {} : { error: record.error }), ...(record.retryAt === undefined ? {} : { retryAt: record.retryAt }), pinned: record.visible, lastAccessedAt: record.lastAccessedAt });
    const reasons = this.#cache.evictToBudget();
    this.#pressureReasons = Object.freeze([...reasons]);
    this.#prefetchEnabled = reasons.length === 0;
  }

  #computeRenderCover(): { entries: readonly RenderCoverCandidate[]; complete: boolean; uncovered: readonly RenderTileKey[] } {
    const states = new Map<string, RenderCoverCandidate['state']>();
    for (const entry of this.#desired.values()) {
      const record = this.#records.get(canonicalTileKeyToString(entry.key.canonical));
      states.set(renderTileKeyToString(entry.key), toCoverState(record?.state));
    }
    return this.#renderCover.resolve([...this.#desired.values()].map((entry) => entry.key), states);
  }

  #snapshot(record: StreamingRecord<Payload>): TileStreamingRecordSnapshot {
    return { key: record.key, generation: record.generation, state: record.state, visible: record.visible, retained: this.#cache.has(record.key), cpuBytes: record.cpuBytes, gpuBytes: record.gpuBytes, ...(record.retryAt === undefined ? {} : { retryAt: record.retryAt }), ...(record.error === undefined ? {} : { error: record.error }) };
  }

  #isIdle(): boolean {
    if (this.#disposed) return true;
    return ![...this.#desired.values()].some((entry) => {
      const record = this.#records.get(canonicalTileKeyToString(entry.key.canonical));
      return record === undefined || record.queuedUpload || record.state === 'queued' || record.state === 'fetching' || record.state === 'decoding' || record.state === 'building';
    });
  }

  #resolveIdleIfReady(): void {
    const idle = this.#isIdle();
    if (idle && !this.#lastIdle) {
      const stats = this.getStats();
      this.#events.emit('idle', { stats });
      for (const resolve of this.#idleWaiters) resolve();
      this.#idleWaiters.clear();
    }
    this.#lastIdle = idle;
  }

  #emitStats(): void {
    if (this.#disposed) return;
    const stats = this.getStats();
    this.#events.emit('stats', stats);
    this.#resolveIdleIfReady();
  }
}

function payloadBytes<Payload>(payload: Payload): number {
  const candidate = payload as { stats?: { outputBytes?: number } };
  const bytes = candidate.stats?.outputBytes;
  return Number.isFinite(bytes) && bytes !== undefined ? Math.max(0, bytes) : 1;
}

function toCoverState(state: StreamingTileState | undefined): RenderCoverCandidate['state'] {
  if (state === 'ready' || state === 'empty' || state === 'failed') return state;
  return 'loading';
}
