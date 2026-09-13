import type { ViewState, ViewportSize } from '../types.js';
import { advancePlanEpoch, advanceTileGeneration, createPlanEpoch, createTileGeneration, type PlanEpoch, type TileGeneration } from './epoch.js';
import { NovaTileEventEmitter, type NovaTileEventMap, type TileStats } from './events.js';
import { canonicalTileKeyToString, createRenderTileKey, renderTileKeyToString, type CanonicalTileKey, type RenderTileKey } from './tileAddress.js';
import { MixedLODPlanner, type MixedLODPlan } from './lod/index.js';
import { MotionPredictor } from './motion/index.js';
import { RequestScheduler, type RequestRole, type SchedulerPhase } from './scheduler/index.js';
import { NovaTilePipeline, type NovaTilePipelineResult } from './fetch/index.js';
import { TileCache } from './cache/index.js';
import { NovaTileRenderCover, type RenderTileCandidate, type RenderCoverSnapshot } from './render/index.js';
import { TileUploadQueue } from './upload/index.js';
import { TileResourceRegistry } from './resources/index.js';
import { TileDiagnostics, type TileCoverSummary, type TileTimeline } from './diagnostics/index.js';
import { createNovaTileRecord, isNovaTileInFlight, transitionNovaTileRecord } from './state.js';
import { TilePyramid } from './pyramid/index.js';
import type { NovaTileEngineOptions, NovaTileUploadResult, IntegratedRecord } from './engineTypes.js';
export type { NovaTileEngineOptions, NovaTileUploadResult, NovaTileSourceOptions } from './engineTypes.js';

/** 引擎帧时间输入；由宿主 requestAnimationFrame 提供。 */
export interface FrameTime {
  readonly frameId: number;
  readonly timeMs: number;
  readonly deltaMs: number;
}

/** NovaTileEngine 的内部生命周期接口。 */
export interface NovaTileEngineContract {
  initialize(): Promise<void>;
  resize(viewport: ViewportSize): void;
  updateView(view: ViewState): void;
  frame(frameTime: FrameTime): void;
  getStats(): TileStats;
  dispose(): Promise<void>;
}

/** NTE 生命周期接口与模块编排入口。 */
export class NovaTileEngine<Payload = unknown, WorkerInput = unknown, Resource = unknown> implements NovaTileEngineContract {
  readonly #events = new NovaTileEventEmitter<NovaTileEventMap>();
  readonly #clock: { now(): number };
  readonly #options: NovaTileEngineOptions<Payload, WorkerInput, Resource>;
  readonly #planner: MixedLODPlanner | undefined;
  readonly #motion = new MotionPredictor();
  readonly #scheduler: RequestScheduler | undefined;
  readonly #cache: TileCache<Payload> | undefined;
  readonly #pipeline: NovaTilePipeline<WorkerInput, Payload> | undefined;
  readonly #renderCover: NovaTileRenderCover | undefined;
  readonly #uploadQueue: TileUploadQueue<NovaTileUploadResult<Resource>> | undefined;
  readonly #resources: TileResourceRegistry<Resource> | undefined;
  readonly #diagnostics: TileDiagnostics | undefined;
  readonly #records = new Map<string, IntegratedRecord<Payload, Resource>>();
  readonly #desired = new Map<string, RenderTileKey>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #diagnosticEvents: Array<() => void> = [];
  #lastCommittedSignature = '';
  #resourceFrame = 0;
  #lastPlan: MixedLODPlan | undefined;
  #lastPhase: SchedulerPhase = 'idle';
  #idleWaiters = new Set<() => void>();
  #lastIdle = true;
  #planEpoch: PlanEpoch = createPlanEpoch();
  #generation: TileGeneration = createTileGeneration();
  #viewport: ViewportSize | undefined;
  #view: ViewState | undefined;
  #initialized = false;
  #disposed = false;
  #lastFrame: FrameTime | undefined;

  constructor(options: NovaTileEngineOptions<Payload, WorkerInput, Resource> = {}) {
    this.#options = options;
    this.#clock = options.clock ?? { now: () => performance.now() };
    this.#planner = options.planner ?? (options.source === undefined ? undefined : new MixedLODPlanner(options.source));
    this.#scheduler = options.scheduler ?? (this.#planner === undefined ? undefined : new RequestScheduler());
    this.#cache = options.cache ?? (this.#planner === undefined ? undefined : new TileCache<Payload>());
    this.#pipeline = options.pipeline ?? (options.worker === undefined ? undefined : new NovaTilePipeline<WorkerInput, Payload>({ worker: options.worker, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }));
    this.#renderCover = options.renderCover ?? (options.source === undefined ? undefined : new NovaTileRenderCover(new TilePyramid(options.source)));
    this.#uploadQueue = options.uploadQueue ?? (this.#planner === undefined ? undefined : new TileUploadQueue<NovaTileUploadResult<Resource>>({ clock: this.#clock }));
    this.#resources = options.resources ?? (this.#planner === undefined ? undefined : new TileResourceRegistry<Resource>());
    this.#diagnostics = options.diagnostics ?? (this.#planner === undefined ? undefined : new TileDiagnostics({ clock: this.#clock }));
  }

  on<Type extends keyof NovaTileEventMap>(type: Type, listener: (event: NovaTileEventMap[Type]) => void): () => void {
    if (this.#disposed) {
      throw new Error('NovaTileEngine 已销毁。');
    }
    return this.#events.on(type, listener);
  }

  initialize(): Promise<void> {
    this.assertUsable();
    if (!Number.isFinite(this.#clock.now())) {
      throw new Error('引擎时钟必须返回有限数值。');
    }
    this.#initialized = true;
    if (this.#view !== undefined && this.#viewport !== undefined && this.#lastPlan === undefined) {
      this.#replan(this.#clock.now());
    }
    return Promise.resolve();
  }

  resize(viewport: ViewportSize): void {
    this.assertUsable();
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw new RangeError('viewport width/height 必须是正数。');
    }
    this.#viewport = Object.freeze({ ...viewport });
    if (this.#view !== undefined && this.#planner !== undefined) this.#replan(this.#clock.now());
  }

  updateView(view: ViewState): void {
    this.assertUsable();
    if (!Number.isFinite(view.zoom) || !Number.isFinite(view.bearing) || !Number.isFinite(view.pitch) || !Number.isFinite(view.center.lng) || !Number.isFinite(view.center.lat)) {
      throw new RangeError('ViewState 必须包含有限数值。');
    }
    this.#planEpoch = advancePlanEpoch(this.#planEpoch);
    this.#view = Object.freeze({ center: { ...view.center }, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
    this.#motion.addSample({ timeMs: this.#clock.now(), view: this.#view });
    if (this.#planner !== undefined && this.#viewport !== undefined) {
      this.#replan(this.#clock.now());
    } else {
      this.#events.emit('plan', Object.freeze({ planEpoch: this.#planEpoch, view: this.#view, targetKeys: Object.freeze([]) }));
    }
  }

  frame(frameTime: FrameTime): void {
    this.assertUsable();
    if (!this.#initialized) {
      throw new Error('NovaTileEngine 尚未初始化。');
    }
    if (!Number.isSafeInteger(frameTime.frameId) || frameTime.frameId < 0 || !Number.isFinite(frameTime.timeMs) || !Number.isFinite(frameTime.deltaMs) || frameTime.deltaMs < 0) {
      throw new RangeError('FrameTime 必须是有效的帧输入。');
    }
    this.#lastFrame = Object.freeze({ ...frameTime });
    if (this.#scheduler !== undefined) {
      this.#lastPhase = this.#motion.estimate().phase;
      this.#scheduler.beginFrame(frameTime.timeMs, this.#lastPhase);
      this.#uploadQueue?.beginFrame();
      this.#flushDiagnostics(frameTime);
      this.#pumpRequests(frameTime.timeMs);
      this.#pumpUploads();
      this.#renderCover?.advance(frameTime.timeMs);
      this.#refreshRenderCover(frameTime.timeMs);
      this.#resourceFrame = Math.max(this.#resourceFrame + 1, frameTime.frameId);
      this.#resources?.advanceFrame(this.#resourceFrame);
      this.#endDiagnostics(frameTime);
    }
    this.#events.emit('stats', this.getStats());
    this.#resolveIdleIfReady();
  }

  getStats(): TileStats {
    let planned = 0;
    let inFlight = 0;
    let ready = 0;
    let committed = 0;
    let retained = 0;
    let failed = 0;
    let empty = 0;
    for (const { record } of this.#records.values()) {
      if (record.lifecycleState === 'planned') planned += 1;
      if (isNovaTileInFlight(record.lifecycleState)) inFlight += 1;
      if (record.lifecycleState === 'ready') ready += 1;
      if (record.lifecycleState === 'committed') committed += 1;
      if (record.lifecycleState === 'retained') retained += 1;
      if (record.lifecycleState === 'failed') failed += 1;
      if (record.lifecycleState === 'empty') empty += 1;
    }
    return Object.freeze({ planEpoch: this.#planEpoch, generation: this.#generation, planned, inFlight, ready, committed, retained, failed, empty });
  }

  /** 当前 Render Cover 快照；用于集成测试和宿主诊断。 */
  getRenderCover(): RenderCoverSnapshot | undefined {
    return this.#renderCover?.snapshot;
  }

  /** 当前可复现诊断 timeline；无集成模块时返回空 timeline。 */
  getTimeline(): TileTimeline {
    return this.#diagnostics?.timeline ?? Object.freeze({ version: 1 as const, generatedAt: this.#clock.now(), frames: Object.freeze([]), summary: Object.freeze({ frameCount: 0, durationMs: 0, cacheHitRate: 0, duplicateRequestRate: 0, cancelRate: 0, workerP95Ms: 0, uploadP95Ms: 0, frameP95Ms: 0, blankArea: 0, maxCpuBytes: 0, maxGpuBytes: 0, gpuResourceCount: 0, longTaskCount: 0 }) });
  }

  /** 等待当前计划的请求、Worker 和上传全部结束。 */
  whenIdle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  getPlanEpoch(): PlanEpoch {
    return this.#planEpoch;
  }

  getGeneration(): TileGeneration {
    return this.#generation;
  }

  /** 为同一 canonical Tile 开启新 generation，并按 generation 校验异步结果。 */
  beginGeneration(): TileGeneration {
    this.assertUsable();
    this.#generation = advanceTileGeneration(this.#generation);
    return this.#generation;
  }

  getLastFrame(): FrameTime | undefined {
    return this.#lastFrame;
  }

  getViewport(): ViewportSize | undefined {
    return this.#viewport;
  }

  getView(): ViewState | undefined {
    return this.#view;
  }

  dispose(): Promise<void> {
    if (this.#disposed) {
      return Promise.resolve();
    }
    this.#disposed = true;
    this.#initialized = false;
    for (const entry of this.#records.values()) {
      entry.controller.abort(new DOMException('NovaTileEngine 已销毁。', 'AbortError'));
      if (entry.resource !== undefined) this.#resources?.release(entry.resourceId);
    }
    this.#scheduler?.clear();
    this.#uploadQueue?.clear();
    this.#pipeline?.dispose();
    this.#resources?.clear();
    this.#records.clear();
    this.#desired.clear();
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
    this.#events.clear();
    return Promise.resolve();
  }

  #replan(now: number): void {
    const planner = this.#planner;
    const viewport = this.#viewport;
    const view = this.#view;
    if (planner === undefined || viewport === undefined || view === undefined || this.#scheduler === undefined) return;
    const previous = [...this.#desired.values()].map((key) => key.canonical);
    const plan = planner.plan(view, viewport, previous);
    this.#lastPlan = plan;
    this.#lastCommittedSignature = '';
    this.#desired.clear();
    const tasks = plan.tiles.map((candidate) => {
      const renderKey = createRenderTileKey(candidate.key, 0, this.#options.mapOriginId ?? 'default');
      this.#desired.set(renderTileKeyToString(renderKey), renderKey);
      const record = this.#ensureRecord(candidate.key, renderKey, now);
      if (record.record.lifecycleState === 'ready' || record.record.lifecycleState === 'empty' || record.record.lifecycleState === 'committed' || record.record.lifecycleState === 'retained') return undefined;
      return {
        key: candidate.key,
        role: (candidate.region === 'near' ? 'visible-critical' : candidate.region === 'middle' ? 'visible-refinement' : 'motion-lookahead') as RequestRole,
        coverageDeficit: 1,
        screenError: candidate.sse,
        motionAlignment: this.#motion.estimate().direction.x,
        cacheReuseProbability: this.#cache?.has(candidate.key) ? 1 : 0,
        notBefore: 0,
      };
    }).filter((task): task is Omit<Parameters<RequestScheduler['replace']>[0][number], 'id' | 'spatialBucket' | 'queuedAt' | 'attempt'> => task !== undefined);
    for (const [id, entry] of this.#records) {
      if (!this.#desired.has(renderTileKeyToString(entry.renderKey)) && isNovaTileInFlight(entry.record.lifecycleState)) {
        entry.controller.abort(new DOMException('计划已替换。', 'AbortError'));
        this.#scheduler.cancel(id);
      }
    }
    this.#scheduler.beginFrame(now, this.#motion.estimate().phase);
    this.#scheduler.replace(tasks, now);
    this.#lastIdle = false;
    this.#events.emit('plan', Object.freeze({ planEpoch: this.#planEpoch, view, targetKeys: Object.freeze(plan.tiles.map((candidate) => candidate.key)) }));
    this.#refreshRenderCover(now);
  }

  #ensureRecord(key: CanonicalTileKey, renderKey: RenderTileKey, now: number): IntegratedRecord<Payload, Resource> {
    const id = canonicalTileKeyToString(key);
    let existing = this.#records.get(id);
    if (existing !== undefined && existing.record.planEpoch !== this.#planEpoch && isNovaTileInFlight(existing.record.lifecycleState)) {
      existing.controller.abort(new DOMException('计划已替换。', 'AbortError'));
      this.#scheduler?.finish(id);
      this.#records.delete(id);
      this.#generation = advanceTileGeneration(this.#generation);
      existing = undefined;
    }
    if (existing !== undefined) {
      existing.record.planEpoch = this.#planEpoch;
      return existing;
    }
    const record = createNovaTileRecord<Payload>({ key, generation: this.#generation, planEpoch: this.#planEpoch, now, renderRole: 'exact', cacheRole: 'resident', renderKeys: [renderKey] });
    const entry: IntegratedRecord<Payload, Resource> = { record, renderKey, controller: new AbortController(), resourceId: id, attempts: 0, uploadQueued: false };
    this.#records.set(id, entry);
    const cached = this.#cache?.get(key, now);
    this.#diagnosticEvents.push(() => this.#diagnostics?.recordCache(cached === undefined ? { type: 'miss', key, at: now } : { type: 'hit', key, role: cached.role, at: now, cpuBytes: cached.cpuBytes, gpuBytes: cached.gpuBytes }));
    if (cached?.state === 'ready' && cached.payload !== undefined) {
      record.payload = cached.payload;
      transitionNovaTileRecord(record, 'fetching', now);
      transitionNovaTileRecord(record, 'decoded', now);
      transitionNovaTileRecord(record, 'built', now);
      transitionNovaTileRecord(record, 'uploadQueued', now);
      transitionNovaTileRecord(record, 'ready', now);
    } else if (cached?.state === 'empty') {
      transitionNovaTileRecord(record, 'fetching', now);
      transitionNovaTileRecord(record, 'empty', now);
    }
    return entry;
  }

  #pumpRequests(now: number): void {
    if (this.#scheduler === undefined || this.#pipeline === undefined || this.#options.source === undefined) return;
    let task = this.#scheduler.take(now);
    while (task !== undefined) {
      const currentTask = task;
      const entry = this.#records.get(currentTask.id);
      if (entry === undefined) {
        task = this.#scheduler.take(now);
        continue;
      }
      entry.attempts += 1;
      if (entry.record.lifecycleState === 'planned' || entry.record.lifecycleState === 'retryable') transitionNovaTileRecord(entry.record, 'fetching', now);
      this.#diagnosticEvents.push(() => this.#diagnostics?.recordRequest({ type: 'start', key: currentTask.key, reason: currentTask.role, phase: this.#lastPhase, at: now }));
      const promise = this.#pipeline.run({
        key: currentTask.key,
        url: this.#tileUrl(currentTask.key),
        dataInput: this.#options.workerInput?.(currentTask.key) as WorkerInput,
        planEpoch: this.#planEpoch,
        generation: this.#generation,
        signal: entry.controller.signal,
        current: () => ({ planEpoch: this.#planEpoch, generation: this.#generation }),
      }).then((result) => { this.#acceptPipelineResult(entry, result, now); }).catch((error: unknown) => { this.#rejectPipelineResult(entry, error, now); }).finally(() => {
        this.#scheduler?.finish(currentTask.id);
        this.#refreshRenderCover(this.#clock.now());
        this.#resolveIdleIfReady();
      });
      this.#track(promise);
      task = this.#scheduler.take(now);
    }
  }

  #acceptPipelineResult(entry: IntegratedRecord<Payload, Resource>, result: NovaTilePipelineResult<Payload>, now: number): void {
    if (result.planEpoch !== this.#planEpoch || result.generation !== this.#generation || entry.record.planEpoch !== this.#planEpoch) {
      if (entry.record.lifecycleState !== 'stale' && entry.record.lifecycleState !== 'evicted') transitionNovaTileRecord(entry.record, 'stale', now);
      return;
    }
    if (result.type === 'empty') {
      transitionNovaTileRecord(entry.record, 'empty', now);
      this.#cache?.set({ key: entry.record.key, generation: entry.record.generation, state: 'empty', cpuBytes: 0, gpuBytes: 0, role: 'resident', pinned: true, lastAccessedAt: now });
      this.#diagnosticEvents.push(() => this.#diagnostics?.recordRequest({ type: 'finish', key: entry.record.key, reason: 'visible-critical', phase: this.#lastPhase, at: now, durationMs: 0 }));
      return;
    }
    entry.record.payload = result.payload;
    transitionNovaTileRecord(entry.record, 'decoded', now);
    transitionNovaTileRecord(entry.record, 'built', now);
    transitionNovaTileRecord(entry.record, 'uploadQueued', now);
    entry.uploadQueued = true;
    this.#uploadQueue?.enqueue({ id: entry.resourceId, key: entry.record.key, bytes: this.#options.uploadBytes?.(result.payload) ?? 1, priority: 'exact-visible', upload: async () => {
      try {
        const uploaded = await (this.#options.upload?.(entry.record.key, result.payload) ?? ({ cpuBytes: 1, gpuBytes: 1 } as NovaTileUploadResult<Resource>));
        this.#completeUpload(entry, uploaded);
        return uploaded;
      } catch (error) {
        entry.uploadQueued = false;
        if (entry.record.lifecycleState === 'uploadQueued') transitionNovaTileRecord(entry.record, 'failed', this.#clock.now());
        entry.record.error = error;
        this.#cache?.remove(entry.record.key);
        throw error;
      }
    } });
    this.#cache?.set({ key: entry.record.key, generation: entry.record.generation, state: 'ready', payload: result.payload, cpuBytes: this.#options.uploadBytes?.(result.payload) ?? 1, gpuBytes: 0, role: 'resident', pinned: true, lastAccessedAt: now });
  }

  #rejectPipelineResult(entry: IntegratedRecord<Payload, Resource>, error: unknown, now: number): void {
    // 集成边界将异常归类为失败或取消，并保持记录可观察。
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (entry.record.lifecycleState !== 'stale' && entry.record.lifecycleState !== 'evicted' && entry.record.lifecycleState !== 'cancelled') transitionNovaTileRecord(entry.record, 'cancelled', now);
      return;
    }
    if (entry.record.lifecycleState !== 'failed' && entry.record.lifecycleState !== 'stale' && entry.record.lifecycleState !== 'evicted') transitionNovaTileRecord(entry.record, 'failed', now);
    entry.record.error = error;
    this.#cache?.set({ key: entry.record.key, generation: entry.record.generation, state: 'negative', cpuBytes: 0, gpuBytes: 0, role: 'resident', pinned: true, lastAccessedAt: now, error });
  }

  #pumpUploads(): void {
    const queue = this.#uploadQueue;
    if (queue === undefined) return;
    if (queue.stats.queued === 0) return;
    const task = queue.processNext();
    const promise = task.then((result) => {
        if (result !== undefined && queue.stats.queued > 0 && !queue.stats.backpressure) this.#pumpUploads();
      }).catch((error: unknown) => {
        // 上传闭包已将失败写回对应记录；此处保持队列继续泵送。
        void error;
      });
    this.#track(promise);
  }

  #completeUpload(entry: IntegratedRecord<Payload, Resource>, result: NovaTileUploadResult<Resource>): void {
    entry.uploadQueued = false;
    entry.resource = result;
    if (entry.record.lifecycleState === 'uploadQueued') transitionNovaTileRecord(entry.record, 'ready', this.#clock.now());
    this.#resources?.register({ id: entry.resourceId, tileKey: entry.record.key, ...(result.resource === undefined ? {} : { resource: result.resource }), cpuBytes: result.cpuBytes ?? 1, gpuBytes: result.gpuBytes ?? 1, ...(result.dispose === undefined ? {} : { dispose: result.dispose }) });
    this.#diagnosticEvents.push(() => this.#diagnostics?.recordRequest({ type: 'finish', key: entry.record.key, reason: 'visible-critical', phase: this.#lastPhase, at: this.#clock.now(), durationMs: 0, bytes: result.gpuBytes ?? 1 }));
    this.#diagnosticEvents.push(() => this.#diagnostics?.recordUpload({ type: 'finish', key: entry.record.key, at: this.#clock.now(), bytes: result.gpuBytes ?? 1 }));
  }

  #refreshRenderCover(now: number): void {
    const cover = this.#renderCover;
    if (cover === undefined) return;
    const candidates = new Map<string, RenderTileCandidate>();
    const renderKeys = new Map<string, RenderTileKey>(this.#desired);
    for (const entry of this.#records.values()) renderKeys.set(renderTileKeyToString(entry.renderKey), entry.renderKey);
    for (const renderKey of renderKeys.values()) {
      const entry = this.#records.get(canonicalTileKeyToString(renderKey.canonical));
      const state = entry?.record.lifecycleState;
      candidates.set(renderTileKeyToString(renderKey), { key: renderKey, availability: state === 'ready' || state === 'committed' || state === 'retained' ? 'ready' : state === 'empty' ? 'empty' : state === 'failed' ? 'failed' : 'loading', ...(entry === undefined ? {} : { planEpoch: entry.record.planEpoch, generation: entry.record.generation }) });
    }
    const resolution = cover.setTarget(this.#planEpoch, [...this.#desired.values()], candidates);
    const signature = resolution.coverageComplete ? resolution.entries.map((entry) => renderTileKeyToString(entry.key)).sort().join('|') : '';
    if (signature.length > 0 && signature !== this.#lastCommittedSignature) {
      if (cover.commitResolution(resolution, now)) {
        for (const candidate of cover.committed) {
          const record = this.#records.get(canonicalTileKeyToString(candidate.key.canonical));
          if (record?.record.lifecycleState === 'ready') transitionNovaTileRecord(record.record, 'committed', now);
        }
        for (const candidate of cover.outgoing) {
          const record = this.#records.get(canonicalTileKeyToString(candidate.key.canonical));
          if (record?.record.lifecycleState === 'committed') transitionNovaTileRecord(record.record, 'retained', now);
        }
        this.#lastCommittedSignature = signature;
        this.#diagnosticEvents.push(() => this.#diagnostics?.recordCommit({ type: 'commit', cohortId: 0, planEpoch: this.#planEpoch, at: now }));
      }
    }
  }

  #flushDiagnostics(frameTime: FrameTime): void {
    const diagnostics = this.#diagnostics;
    if (diagnostics === undefined) return;
    const target = this.#lastPlan?.tiles.map((candidate) => canonicalTileKeyToString(candidate.key)) ?? [];
    const committed = this.#renderCover?.committed.map((entry) => canonicalTileKeyToString(entry.key.canonical)) ?? [];
    const targetCover: TileCoverSummary = { tileCount: target.length, keys: target, complete: this.#renderCover?.snapshot.target?.coverageComplete ?? false, blankArea: this.#renderCover?.blankArea ?? 0 };
    const committedCover: TileCoverSummary = { tileCount: committed.length, keys: committed, complete: this.#renderCover?.committed.length !== 0, blankArea: 0 };
    diagnostics.beginFrame({ frameId: frameTime.frameId, planEpoch: this.#planEpoch, targetCover, committedCover, coverageComplete: this.#renderCover?.coverageComplete ?? true, blankArea: this.#renderCover?.blankArea ?? 0, frameTime: frameTime.deltaMs, cpuBytes: this.#cache?.stats.cpuBytes ?? 0, gpuBytes: this.#resources?.stats.gpuBytes ?? 0 });
    for (const event of this.#diagnosticEvents.splice(0)) event();
  }

  #endDiagnostics(frameTime: FrameTime): void {
    this.#diagnostics?.endFrame({ frameTime: frameTime.deltaMs, cpuBytes: this.#cache?.stats.cpuBytes ?? 0, gpuBytes: this.#resources?.stats.gpuBytes ?? 0 });
  }

  #track(promise: Promise<unknown>): void {
    this.#pending.add(promise);
    void promise.finally(() => this.#pending.delete(promise)).catch(() => undefined);
  }

  #tileUrl(key: CanonicalTileKey): string {
    const source = this.#options.source;
    if (source?.url === undefined) return `memory://${canonicalTileKeyToString(key)}`;
    return typeof source.url === 'function' ? source.url(key) : source.url.replace('{z}', String(key.z)).replace('{x}', String(key.x)).replace('{y}', String(key.y));
  }

  #isIdle(): boolean {
    if (this.#pending.size > 0 || [...this.#records.values()].some((entry) => entry.uploadQueued || isNovaTileInFlight(entry.record.lifecycleState))) return false;
    return true;
  }

  #resolveIdleIfReady(): void {
    const idle = this.#isIdle();
    if (!idle) {
      this.#lastIdle = false;
      return;
    }
    if (!this.#lastIdle) this.#events.emit('idle', { stats: this.getStats() });
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
    this.#lastIdle = true;
  }

  private assertUsable(): void {
    if (this.#disposed) {
      throw new Error('NovaTileEngine 已销毁。');
    }
  }
}
