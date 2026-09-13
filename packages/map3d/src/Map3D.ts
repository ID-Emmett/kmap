import { Color, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { createLineLayerRecipe, createPolygonLayerRecipe } from './geometry/types.js';
import type { TileBuildPayloadV1, TileLayerRecipeV1 } from './geometry/types.js';
import { MapInteractionController } from './interaction/mapInteractions.js';
import type { InteractionMotionSnapshot } from './interaction/motionSnapshot.js';
import { calculateHorizonFadeParameters } from './rendering/horizonFade.js';
import { updateMapCamera } from './rendering/mapCamera.js';
import { MaterialRegistry } from './rendering/materialRegistry.js';
import { ThreeTileRenderAdapter } from './rendering/tileRenderAdapter.js';
import type { TileRenderResource } from './rendering/tileRenderAdapter.js';
import { normalizeViewport } from './rendering/viewport.js';
import { TypedEventEmitter } from './runtime/events.js';
import { createMapDisposedError, normalizeMapRuntimeError } from './runtime/errors.js';
import { ViewStateStore } from './runtime/viewStateStore.js';
import { normalizeVectorTileSourceOptions, getTileRequestUrl } from './source/vectorTileSource.js';
import type { VectorTileSource } from './source/types.js';
import { lngLatToTilePosition } from './spatial/mercator.js';
import { resolveDataZoom, createCanonicalTileKey as createLegacyCanonicalTileKey } from './spatial/tileKey.js';
import { selectMapOrigin } from './spatial/mapOrigin.js';
import type { MapOrigin } from './spatial/types.js';
import type { CanonicalTileKey as LegacyTileKey } from './types.js';
import type { MapEventMap, Map3DOptions, MapRuntimeStats, MapLayerOptions, RenderBackend, ViewportSize, ViewState } from './types.js';
import { TileWorkerPool } from './worker/pool.js';
import type { TileBuildJob } from './worker/pool.js';
import { MixedLODPlanner, NovaTileEngine, TileCache, TileDiagnostics, TileFetchPipeline, TileResourceRegistry } from './nova-tile/index.js';
import type { NovaTileError, TileStats } from './nova-tile/index.js';
import type { CanonicalTileKey as NovaTileKey } from './nova-tile/tileAddress.js';
import type { WorkerAdapter, WorkerJobInput } from './nova-tile/worker/index.js';
import { createGroundFootprint } from './nova-tile/coverage/index.js';
import type { GroundFootprint } from './nova-tile/coverage/index.js';

const DEFAULT_BACKGROUND_COLOR = 0x07111c;
const FRAME_SAMPLE_LIMIT = 120;
const SOURCE_REVISION = 'map3d-source-v1';

/** Nova Map3D 0.1 根运行时入口。 */
export class Map3D {
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(45, 1, 0.1, 10_000);
  readonly #renderer: WebGPURenderer;
  readonly #materials = new MaterialRegistry();
  readonly #backgroundColor: Color;
  readonly #events = new TypedEventEmitter<MapEventMap>();
  readonly #source: VectorTileSource;
  readonly #layers: readonly TileLayerRecipeV1[];
  readonly #tileKey: LegacyTileKey;
  readonly #viewStore: ViewStateStore;
  readonly #interactions: MapInteractionController;
  readonly #reducedMotion: boolean;
  readonly #maxPixelRatio: number | undefined;
  readonly #cacheOptions: NonNullable<Map3DOptions['cache']>;
  #origin: MapOrigin;
  #footprint: GroundFootprint;
  #viewport = normalizeViewport({ width: 1, height: 1, pixelRatio: 1 });
  #workerPool: TileWorkerPool | undefined;
  #tileEngine: NovaTileEngine<TileBuildPayloadV1, readonly TileLayerRecipeV1[], TileRenderResource> | undefined;
  #renderAdapter: ThreeTileRenderAdapter | undefined;
  #resourceRegistry: TileResourceRegistry<TileRenderResource> | undefined;
  #initializePromise: Promise<void> | undefined;
  #initialized = false;
  #disposed = false;
  #running = false;
  #frameLastMs = 0;
  #frameId = 0;
  #lastFrameTime = 0;
  #targetTileCount = 0;
  readonly #frameSamples: number[] = [];

  constructor(options: Map3DOptions) {
    this.#source = normalizeVectorTileSourceOptions(options.source);
    if (options.layers.length === 0) throw new RangeError('Map3D 至少需要一个 fill 或 line layer。');
    this.#layers = Object.freeze(options.layers.map((layer, renderOrder) => createLayerRecipe(layer, renderOrder)));
    const maxPixelRatio = options.renderer?.maxPixelRatio;
    if (maxPixelRatio !== undefined && (!Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0)) throw new RangeError('renderer.maxPixelRatio 必须是正有限数值。');
    this.#maxPixelRatio = maxPixelRatio;
    this.#cacheOptions = options.cache ?? {};
    this.#viewStore = new ViewStateStore(options.view);
    const initialView = this.#viewStore.get();
    const dataZoom = resolveDataZoom(initialView.zoom, this.#source.minZoom, this.#source.maxZoom);
    const tilePosition = lngLatToTilePosition(initialView.center, dataZoom);
    const tileKey = createLegacyCanonicalTileKey(this.#source.id, dataZoom, Math.floor(tilePosition.x), Math.floor(tilePosition.y));
    if (tileKey === undefined) throw new RangeError('初始 ViewState 未对应有效 Tile。');
    this.#tileKey = tileKey;
    this.#origin = selectMapOrigin(initialView.center, dataZoom);
    this.#footprint = createFootprint(initialView, this.#viewport);
    this.#backgroundColor = new Color(options.renderer?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR);
    this.#scene.background = this.#backgroundColor;
    this.#reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.#renderer = new WebGPURenderer({ canvas: options.canvas, antialias: options.renderer?.antialias ?? true, forceWebGL: options.renderer?.forceWebGL ?? false });
    this.#applyView(initialView);
    this.#viewStore.onChange((view) => { this.#applyView(view); this.#events.emit('viewchange', { view }); });
    this.#interactions = new MapInteractionController({ target: options.canvas, getView: () => this.#viewStore.get(), setView: (view) => this.#setViewFromInteraction(view), getViewport: () => this.#viewport, reducedMotion: this.#reducedMotion, onMotion: (snapshot) => this.#applyMotion(snapshot) });
  }

  initialize(): Promise<void> { if (this.#disposed) return Promise.reject(createMapDisposedError()); this.#initializePromise ??= this.#initializeOnce(); return this.#initializePromise; }
  getRenderer(): WebGPURenderer { return this.#renderer; }
  getBackend(): RenderBackend { const backend = this.#renderer.backend as { isWebGLBackend?: boolean; isWebGPUBackend?: boolean }; if (backend.isWebGPUBackend === true) return 'webgpu'; if (backend.isWebGLBackend === true) return 'webgl2'; return 'unknown'; }
  getView(): ViewState { return this.#viewStore.get(); }
  setView(view: Partial<ViewState>): void { if (this.#disposed) throw createMapDisposedError(); this.#interactions.cancelMotion(); this.#viewStore.set(view); }
  on<Type extends keyof MapEventMap>(type: Type, listener: (event: MapEventMap[Type]) => void): () => void { if (this.#disposed) throw createMapDisposedError(); return this.#events.on(type, listener); }

  getStats(): MapRuntimeStats {
    const tileStats = this.#tileEngine?.getStats();
    const resourceStats = this.#resourceRegistry?.getStats();
    const resourceTotals = getResourceTotals(this.#resourceRegistry);
    return { backend: this.getBackend(), frame: { lastMs: this.#frameLastMs, p95Ms: getPercentile95(this.#frameSamples) }, tiles: { visible: this.#disposed ? 0 : this.#targetTileCount, queued: tileStats?.planned ?? 0, fetching: tileStats?.inFlight ?? 0, decoding: 0, building: 0, ready: (tileStats?.ready ?? 0) + (tileStats?.committed ?? 0) + (tileStats?.retained ?? 0), empty: tileStats?.empty ?? 0, failed: tileStats?.failed ?? 0 }, resources: { cpuBytes: resourceStats?.cpuBytes ?? 0, gpuBytes: resourceStats?.gpuBytes ?? 0, ...resourceTotals }, workers: this.#workerPool?.getStats() ?? { active: 0, queued: 0 } };
  }

  resize(size: ViewportSize): void { if (this.#disposed) throw createMapDisposedError(); const pixelRatio = this.#maxPixelRatio === undefined ? size.pixelRatio : Math.min(size.pixelRatio ?? 1, this.#maxPixelRatio); this.#viewport = normalizeViewport(pixelRatio === undefined ? { width: size.width, height: size.height } : { width: size.width, height: size.height, pixelRatio }); this.#renderer.setPixelRatio(this.#viewport.pixelRatio); this.#renderer.setSize(this.#viewport.width, this.#viewport.height, false); this.#applyView(this.#viewStore.get()); }
  start(): void { if (this.#disposed) throw createMapDisposedError(); if (!this.#initialized || this.#running) return; this.#running = true; this.#renderer.setAnimationLoop((time?: number) => this.#renderFrame(time ?? performance.now())); }
  stop(): void { if (!this.#running) return; this.#running = false; this.#renderer.setAnimationLoop(null); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.stop(); this.#interactions.dispose(); this.#viewStore.dispose(); void this.#tileEngine?.dispose(); this.#renderAdapter?.dispose(); this.#materials.dispose(); this.#tileEngine = undefined; this.#renderAdapter = undefined; this.#resourceRegistry = undefined; this.#workerPool = undefined; this.#renderer.dispose(); this.#events.clear(); this.#initialized = false; }

  async #initializeOnce(): Promise<void> {
    try {
      await this.#renderer.init();
      if (this.#disposed) throw createMapDisposedError();
      const workerPool = new TileWorkerPool(); this.#workerPool = workerPool;
      const renderAdapter = new ThreeTileRenderAdapter(this.#scene, this.#materials, this.#origin); this.#renderAdapter = renderAdapter;
      const resources = new TileResourceRegistry<TileRenderResource>(this.#cacheOptions); this.#resourceRegistry = resources;
      const sourceRevision = SOURCE_REVISION;
      const fetchPipeline = new TileFetchPipeline({ fetch: async (url, init) => {
        const response = await globalThis.fetch(url, init);
        if (!response.ok && response.status !== 204) {
          const code = response.status >= 400 ? 'HTTP_ERROR' : 'NETWORK_ERROR';
          this.#events.emit('error', createMapError(code, `Tile 请求返回 HTTP ${response.status}。`, 'request', response.status >= 500, this.#tileKey));
        }
        return response;
      } });
      const tileEngine = new NovaTileEngine<TileBuildPayloadV1, readonly TileLayerRecipeV1[], TileRenderResource>({ source: { sourceId: this.#source.id, sourceRevision, minZoom: this.#source.minZoom, maxZoom: this.#source.maxZoom, url: (key) => getTileRequestUrl(this.#source, toLegacyKey(key), 0).url }, planner: new MixedLODPlanner({ sourceId: this.#source.id, sourceRevision, minZoom: this.#source.minZoom, maxZoom: this.#source.maxZoom }), worker: createWorkerAdapter(workerPool), fetch: fetchPipeline, workerInput: () => this.#layers, cache: new TileCache<TileBuildPayloadV1>(this.#cacheOptions), resources, diagnostics: new TileDiagnostics(), mapOriginId: 'map3d', uploadBytes: (payload) => payload.stats.outputBytes, upload: (_key, payload) => { const resource = renderAdapter.upload({ payload }); return { resource, cpuBytes: resource.cpuBytes, gpuBytes: resource.gpuBytes, dispose: () => resource.dispose() }; } });
      this.#tileEngine = tileEngine; this.#wireRuntimeEvents(tileEngine); tileEngine.resize(this.#viewport); tileEngine.updateView(this.#viewStore.get()); await tileEngine.initialize(); this.#initialized = true; await this.#drainTileEngine(tileEngine); this.start(); this.#events.emit('load', { backend: this.getBackend() });
    } catch (error) {
      if (this.#disposed) throw createMapDisposedError(); this.stop(); void this.#tileEngine?.dispose(); this.#renderAdapter?.dispose(); this.#workerPool?.dispose(); this.#tileEngine = undefined; this.#renderAdapter = undefined; this.#workerPool = undefined; this.#resourceRegistry = undefined; this.#initialized = false; throw normalizeMapRuntimeError(error, this.#tileKey);
    }
  }

  async #drainTileEngine(engine: NovaTileEngine<TileBuildPayloadV1, readonly TileLayerRecipeV1[], TileRenderResource>): Promise<void> {
    for (;;) { engine.frame({ frameId: this.#frameId++, timeMs: performance.now(), deltaMs: 0 }); const stats = engine.getStats(); if (stats.planned === 0 && stats.inFlight === 0) { engine.frame({ frameId: this.#frameId++, timeMs: performance.now(), deltaMs: 0 }); if (engine.getStats().inFlight === 0) break; } await Promise.race([engine.whenIdle(), new Promise<void>((resolve) => setTimeout(resolve, 0))]); if (this.#disposed) throw createMapDisposedError(); }
  }

  #renderFrame(timeMs: number): void { const startedAt = performance.now(); const deltaMs = this.#lastFrameTime === 0 ? 0 : Math.max(0, timeMs - this.#lastFrameTime); this.#lastFrameTime = timeMs; this.#tileEngine?.frame({ frameId: this.#frameId++, timeMs, deltaMs }); this.#renderer.render(this.#scene, this.#camera); this.#frameLastMs = performance.now() - startedAt; this.#frameSamples.push(this.#frameLastMs); if (this.#frameSamples.length > FRAME_SAMPLE_LIMIT) this.#frameSamples.shift(); }
  #applyView(view: ViewState): void { const dataZoom = resolveDataZoom(view.zoom, this.#source.minZoom, this.#source.maxZoom); this.#origin = selectMapOrigin(view.center, dataZoom); this.#footprint = createFootprint(view, this.#viewport); const frame = updateMapCamera(this.#camera, view, this.#viewport, this.#origin); this.#materials.setHorizonFade(calculateHorizonFadeParameters({ view, camera: frame, origin: this.#origin, footprint: this.#footprint.points }), this.#backgroundColor); this.#renderAdapter?.setOrigin(this.#origin); if (this.#tileEngine !== undefined) { this.#tileEngine.resize(this.#viewport); this.#tileEngine.updateView(view); } }
  #setViewFromInteraction(view: Partial<ViewState>): void { if (this.#disposed) throw createMapDisposedError(); this.#viewStore.set(view); }
  #applyMotion(_snapshot: InteractionMotionSnapshot): void { /* ViewState 更新由交互控制器回调驱动。 */ }
  #wireRuntimeEvents(runtime: NovaTileEngine<TileBuildPayloadV1, readonly TileLayerRecipeV1[], TileRenderResource>): void { runtime.on('plan', (event) => { this.#targetTileCount = event.targetKeys.length; }); runtime.on('stats', (stats) => this.#events.emit('stats', toMapRuntimeStats(this.getBackend(), stats, this.#frameLastMs, this.#frameSamples, this.#targetTileCount, this.#resourceRegistry, this.#workerPool))); runtime.on('idle', ({ stats }) => this.#events.emit('idle', { stats: toMapRuntimeStats(this.getBackend(), stats, this.#frameLastMs, this.#frameSamples, this.#targetTileCount, this.#resourceRegistry, this.#workerPool) })); runtime.on('error', (error) => this.#events.emit('error', toMapError(error, this.#tileKey))); }
}

function createLayerRecipe(layer: MapLayerOptions, renderOrder: number): TileLayerRecipeV1 { return layer.type === 'fill' ? createPolygonLayerRecipe(layer, renderOrder) : createLineLayerRecipe(layer, renderOrder); }
function createFootprint(view: ViewState, viewport: ViewportSize): GroundFootprint { return createGroundFootprint(view, viewport); }
function toLegacyKey(key: NovaTileKey): LegacyTileKey { return { sourceId: key.sourceId, z: key.z, x: key.x, y: key.y }; }
function createWorkerAdapter(pool: TileWorkerPool): WorkerAdapter<readonly TileLayerRecipeV1[], TileBuildPayloadV1> { const jobs = new Map<number, TileBuildJob>(); return { run: (input: WorkerJobInput<readonly TileLayerRecipeV1[]> & { readonly jobId: number }) => { const options = input.signal === undefined ? {} : { signal: input.signal }; const job = pool.enqueue({ key: toLegacyKey(input.key), generation: Number(input.generation), data: input.data, layers: input.input }, options); jobs.set(input.jobId, job); return job.result.finally(() => jobs.delete(input.jobId)); }, cancel: (jobId) => jobs.get(jobId)?.cancel(), dispose: () => pool.dispose() }; }
function getResourceTotals(resources: TileResourceRegistry<TileRenderResource> | undefined): Pick<MapRuntimeStats['resources'], 'batches' | 'features' | 'vertices' | 'indices' | 'objects'> { let batches = 0; let features = 0; let vertices = 0; let indices = 0; let objects = 0; for (const entry of resources?.entries() ?? []) { const stats = entry.resource?.stats; if (stats !== undefined) { batches += stats.batches; features += stats.features; vertices += stats.vertices; indices += stats.indices; objects += stats.objects; } } return { batches, features, vertices, indices, objects }; }
function toMapRuntimeStats(backend: RenderBackend, stats: TileStats, frameLastMs: number, frameSamples: readonly number[], visible: number, resources: TileResourceRegistry<TileRenderResource> | undefined, workerPool: TileWorkerPool | undefined): MapRuntimeStats { const resourceStats = resources?.stats; return { backend, frame: { lastMs: frameLastMs, p95Ms: getPercentile95(frameSamples) }, tiles: { visible, queued: stats.planned, fetching: stats.inFlight, decoding: 0, building: 0, ready: stats.ready + stats.committed + stats.retained, empty: stats.empty, failed: stats.failed }, resources: { cpuBytes: resourceStats?.cpuBytes ?? 0, gpuBytes: resourceStats?.gpuBytes ?? 0, ...getResourceTotals(resources) }, workers: workerPool?.getStats() ?? { active: 0, queued: 0 } }; }
function createMapError(code: string, message: string, phase: 'request' | 'decode' | 'build' | 'upload' | 'initialize', recoverable: boolean, tileKey: LegacyTileKey): ReturnType<typeof normalizeMapRuntimeError> { const error = new Error(message) as ReturnType<typeof normalizeMapRuntimeError>; Object.assign(error, { code, phase, recoverable, tileKey }); return error; }
function toMapError(error: NovaTileError, fallback: LegacyTileKey): ReturnType<typeof normalizeMapRuntimeError> { const code = error.code === 'UPLOAD_ERROR' ? 'INITIALIZE_FAILED' : error.code === 'STALE_RESULT' ? 'WORKER_ERROR' : error.code; const phase = error.phase === 'request' ? 'request' : error.phase === 'decode' ? 'decode' : error.phase === 'build' ? 'build' : error.phase === 'upload' ? 'upload' : 'initialize'; return createMapError(code, error.message, phase, error.recoverable, error.key === undefined ? fallback : toLegacyKey(error.key)); }
function getPercentile95(samples: readonly number[]): number { if (samples.length === 0) return 0; const sorted = [...samples].sort((left, right) => left - right); return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0; }
