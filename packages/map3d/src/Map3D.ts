import {
  Color,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from 'three/webgpu';

import {
  createLineLayerRecipe,
  createPolygonLayerRecipe,
} from './geometry/types.js';
import type {
  TileBuildPayloadV1,
  TileLayerRecipeV1,
} from './geometry/types.js';
import { MapInteractionController } from './interaction/mapInteractions.js';
import type { InteractionMotionSnapshot } from './interaction/motionSnapshot.js';
import { calculateHorizonFadeParameters } from './rendering/horizonFade.js';
import { updateMapCamera } from './rendering/mapCamera.js';
import { MaterialRegistry } from './rendering/materialRegistry.js';
import { normalizeViewport } from './rendering/viewport.js';
import { TypedEventEmitter } from './runtime/events.js';
import {
  createMapDisposedError,
  normalizeMapRuntimeError,
} from './runtime/errors.js';
import { TileEngineV2 } from './runtime/tileEngineV2.js';
import {
  PolygonTileWorkerAdapter,
  VectorTileSourceAdapter,
} from './runtime/tileRuntimeAdapters.js';
import { ViewStateStore } from './runtime/viewStateStore.js';
import { normalizeVectorTileSourceOptions } from './source/vectorTileSource.js';
import { lngLatToTilePosition } from './spatial/mercator.js';
import { calculateTileCoverage } from './spatial/tileCoverage.js';
import { createCanonicalTileKey, resolveDataZoom } from './spatial/tileKey.js';
import type { MapOrigin } from './spatial/types.js';
import type { TileCoverageResult } from './spatial/tileCoverage.js';
import type {
  CanonicalTileKey,
  MapEventMap,
  Map3DOptions,
  MapRuntimeStats,
  MapLayerOptions,
  RenderBackend,
  ViewportSize,
  ViewState,
} from './types.js';
import type { TileRuntimeStats } from './runtime/tileRuntimeTypes.js';
import { TileWorkerPool } from './worker/pool.js';
import { ThreeTileRenderAdapter } from './rendering/tileRenderAdapter.js';

const DEFAULT_BACKGROUND_COLOR = 0x07111c;
const FRAME_SAMPLE_LIMIT = 120;

/** Nova Map3D 0.1 根运行时入口。 */
export class Map3D {
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(45, 1, 0.1, 10_000);
  readonly #renderer: WebGPURenderer;
  readonly #materials = new MaterialRegistry();
  readonly #backgroundColor: Color;
  readonly #events = new TypedEventEmitter<MapEventMap>();
  readonly #source;
  readonly #layers: readonly TileLayerRecipeV1[];
  readonly #tileKey: CanonicalTileKey;
  readonly #viewStore: ViewStateStore;
  readonly #interactions: MapInteractionController;
  readonly #reducedMotion: boolean;
  #origin: MapOrigin;
  #coverage: TileCoverageResult;
  #viewport = normalizeViewport({ width: 1, height: 1, pixelRatio: 1 });
  readonly #maxPixelRatio: number | undefined;
  #workerPool: TileWorkerPool | undefined;
  #tileEngine: TileEngineV2<TileBuildPayloadV1> | undefined;
  #renderAdapter: ThreeTileRenderAdapter | undefined;
  #initializePromise: Promise<void> | undefined;
  #initialized = false;
  #disposed = false;
  #running = false;
  #frameLastMs = 0;
  readonly #frameSamples: number[] = [];

  constructor(options: Map3DOptions) {
    this.#source = normalizeVectorTileSourceOptions(options.source);

    if (options.layers.length === 0) {
      throw new RangeError('Map3D 至少需要一个 fill 或 line layer。');
    }

    this.#layers = Object.freeze(
      options.layers.map((layer, renderOrder) =>
        createLayerRecipe(layer, renderOrder),
      ),
    );
    const maxPixelRatio = options.renderer?.maxPixelRatio;
    if (
      maxPixelRatio !== undefined &&
      (!Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0)
    ) {
      throw new RangeError('renderer.maxPixelRatio 必须是正有限数值。');
    }
    this.#maxPixelRatio = maxPixelRatio;
    this.#cacheOptions = options.cache ?? {};
    this.#viewStore = new ViewStateStore(options.view);
    const initialView = this.#viewStore.get();
    const dataZoom = resolveDataZoom(
      initialView.zoom,
      this.#source.minZoom,
      this.#source.maxZoom,
    );
    const tilePosition = lngLatToTilePosition(initialView.center, dataZoom);
    const tileKey = createCanonicalTileKey(
      this.#source.id,
      dataZoom,
      Math.floor(tilePosition.x),
      Math.floor(tilePosition.y),
    );

    if (tileKey === undefined) {
      throw new RangeError('初始 ViewState 未对应有效 Tile。');
    }

    this.#tileKey = tileKey;
    this.#coverage = calculateTileCoverage(
      initialView,
      this.#viewport,
      this.#source,
    );
    this.#origin = this.#coverage.origin;
    this.#backgroundColor = new Color(
      options.renderer?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
    );
    this.#scene.background = this.#backgroundColor;
    this.#reducedMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.#renderer = new WebGPURenderer({
      canvas: options.canvas,
      antialias: options.renderer?.antialias ?? true,
      forceWebGL: options.renderer?.forceWebGL ?? false,
    });
    const initialFrame = updateMapCamera(
      this.#camera,
      initialView,
      this.#viewport,
      this.#origin,
    );
    this.#materials.setHorizonFade(
      calculateHorizonFadeParameters({
        view: initialView,
        camera: initialFrame,
        origin: this.#origin,
        footprint: this.#coverage.footprint,
        footprintZoom: this.#coverage.referenceZoom,
      }),
      this.#backgroundColor,
    );
    this.#viewStore.onChange((view) => {
      this.#applyView(view);
      this.#events.emit('viewchange', { view });
    });
    this.#interactions = new MapInteractionController({
      target: options.canvas,
      getView: () => this.#viewStore.get(),
      setView: (view) => this.#setViewFromInteraction(view),
      getViewport: () => this.#viewport,
      reducedMotion: this.#reducedMotion,
      onMotion: (snapshot) => this.#applyMotion(snapshot),
    });
  }

  /** 初始化渲染后端并加载当前 ViewState 对应的动态 Tile 覆盖。 */
  initialize(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(createMapDisposedError());
    }

    this.#initializePromise ??= this.#initializeOnce();
    return this.#initializePromise;
  }

  /** 返回底层渲染器，供宿主集成 Inspector 等开发工具。 */
  getRenderer(): WebGPURenderer {
    return this.#renderer;
  }

  /** 返回初始化后实际启用的渲染后端。 */
  getBackend(): RenderBackend {
    const backend = this.#renderer.backend as {
      isWebGLBackend?: boolean;
      isWebGPUBackend?: boolean;
    };

    if (backend.isWebGPUBackend === true) {
      return 'webgpu';
    }
    if (backend.isWebGLBackend === true) {
      return 'webgl2';
    }
    return 'unknown';
  }

  /** 返回当前归一化视图状态的副本。 */
  getView(): ViewState {
    return this.#viewStore.get();
  }

  /** 同步更新 ViewState、Camera、Coverage 和 MapOrigin。 */
  setView(view: Partial<ViewState>): void {
    if (this.#disposed) {
      throw createMapDisposedError();
    }
    this.#interactions.cancelMotion();
    this.#viewStore.set(view);
  }

  on<Type extends keyof MapEventMap>(
    type: Type,
    listener: (event: MapEventMap[Type]) => void,
  ): () => void {
    if (this.#disposed) {
      throw createMapDisposedError();
    }
    return this.#events.on(type, listener);
  }

  getStats(): MapRuntimeStats {
    const runtimeStats = this.#tileEngine?.getStats();

    return {
      backend: this.getBackend(),
      frame: {
        lastMs: this.#frameLastMs,
        p95Ms: getPercentile95(this.#frameSamples),
      },
      tiles: {
        visible: this.#disposed
          ? 0
          : runtimeStats?.tiles.visible ?? this.#coverage.visible.length,
        queued: runtimeStats?.tiles.queued ?? 0,
        fetching: runtimeStats?.tiles.fetching ?? 0,
        decoding: runtimeStats?.tiles.decoding ?? 0,
        building: runtimeStats?.tiles.building ?? 0,
        ready: runtimeStats?.tiles.ready ?? 0,
        empty: runtimeStats?.tiles.empty ?? 0,
        failed: runtimeStats?.tiles.failed ?? 0,
      },
      resources: {
        cpuBytes: runtimeStats?.resources.cpuBytes ?? 0,
        gpuBytes: runtimeStats?.resources.gpuBytes ?? 0,
        batches: runtimeStats?.resources.batches ?? 0,
        features: runtimeStats?.resources.features ?? 0,
        vertices: runtimeStats?.resources.vertices ?? 0,
        indices: runtimeStats?.resources.indices ?? 0,
        objects: runtimeStats?.resources.objects ?? 0,
      },
      workers: runtimeStats?.workers ?? { active: 0, queued: 0 },
    };
  }

  /** 更新视口，并重新推导 Camera、Coverage 和 MapOrigin。 */
  resize(size: ViewportSize): void {
    if (this.#disposed) {
      throw createMapDisposedError();
    }

    const pixelRatio =
      this.#maxPixelRatio === undefined
        ? size.pixelRatio
        : Math.min(size.pixelRatio ?? 1, this.#maxPixelRatio);
    this.#viewport = normalizeViewport(
      pixelRatio === undefined
        ? { width: size.width, height: size.height }
        : { width: size.width, height: size.height, pixelRatio },
    );
    this.#renderer.setPixelRatio(this.#viewport.pixelRatio);
    this.#renderer.setSize(
      this.#viewport.width,
      this.#viewport.height,
      false,
    );
    this.#applyView(this.#viewStore.get());
  }

  /** 启动由 Three.js 管理的渲染循环。 */
  start(): void {
    if (this.#disposed) {
      throw createMapDisposedError();
    }
    if (!this.#initialized || this.#running) {
      return;
    }

    this.#running = true;
    this.#renderer.setAnimationLoop(() => {
      const startedAt = performance.now();
      this.#renderer.render(this.#scene, this.#camera);
      this.#frameLastMs = performance.now() - startedAt;
      this.#frameSamples.push(this.#frameLastMs);
      if (this.#frameSamples.length > FRAME_SAMPLE_LIMIT) {
        this.#frameSamples.shift();
      }
    });
  }

  /** 停止渲染循环。 */
  stop(): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#renderer.setAnimationLoop(null);
  }

  /** 取消固定 Tile 工作并按 Tile → Worker → Renderer 顺序释放。 */
  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.stop();
    this.#interactions.dispose();
    this.#viewStore.dispose();
    this.#tileEngine?.dispose();
    this.#materials.dispose();
    this.#tileEngine = undefined;
    this.#renderAdapter = undefined;
    this.#workerPool = undefined;
    this.#renderer.dispose();
    this.#events.clear();
    this.#initialized = false;
  }

  async #initializeOnce(): Promise<void> {
    try {
      await this.#renderer.init();

      if (this.#disposed) {
        throw createMapDisposedError();
      }

      this.#initialized = true;
      this.start();
      const workerPool = new TileWorkerPool();
      this.#workerPool = workerPool;
      const sourceAdapter = new VectorTileSourceAdapter(this.#source);
      const workerAdapter = new PolygonTileWorkerAdapter(workerPool, this.#layers);
      const renderAdapter = new ThreeTileRenderAdapter(
        this.#scene,
        this.#materials,
        this.#origin,
      );
      this.#renderAdapter = renderAdapter;
      const tileEngine = new TileEngineV2<TileBuildPayloadV1>({
        source: sourceAdapter,
        worker: workerAdapter,
        render: renderAdapter,
        reducedMotion: this.#reducedMotion,
        minFallbackZoom: this.#source.minZoom,
        ...(this.#cacheOptions.maxTileEntries === undefined
          ? {}
          : { maxEntries: this.#cacheOptions.maxTileEntries }),
        ...(this.#cacheOptions.maxCpuBytes === undefined
          ? {}
          : { maxCpuBytes: this.#cacheOptions.maxCpuBytes }),
        ...(this.#cacheOptions.maxGpuBytes === undefined
          ? {}
          : { maxGpuBytes: this.#cacheOptions.maxGpuBytes }),
      });
      this.#tileEngine = tileEngine;
      this.#wireRuntimeEvents(tileEngine);
      this.#setRuntimeSchedule(tileEngine, this.#viewStore.get());
      await tileEngine.whenIdle();
      if (this.#disposed) {
        throw createMapDisposedError();
      }
      this.#events.emit('load', { backend: this.getBackend() });
    } catch (error) {
      if (this.#disposed) {
        throw createMapDisposedError();
      }

      this.stop();
      if (this.#tileEngine !== undefined) {
        this.#tileEngine.dispose();
      } else {
        this.#renderAdapter?.dispose();
        this.#workerPool?.dispose();
      }
      this.#tileEngine = undefined;
      this.#renderAdapter = undefined;
      this.#workerPool = undefined;
      this.#initialized = false;
      throw normalizeMapRuntimeError(error, this.#tileKey);
    }
  }

  #applyView(view: ViewState): void {
    const previousVisible = this.#coverage.visible;
    this.#coverage = calculateTileCoverage(
      view,
      this.#viewport,
      this.#source,
      { previousVisible },
    );
    this.#origin = this.#coverage.origin;
    const frame = updateMapCamera(this.#camera, view, this.#viewport, this.#origin);
    this.#materials.setHorizonFade(
      calculateHorizonFadeParameters({
        view,
        camera: frame,
        origin: this.#origin,
        footprint: this.#coverage.footprint,
        footprintZoom: this.#coverage.referenceZoom,
      }),
      this.#backgroundColor,
    );
    this.#renderAdapter?.setOrigin(this.#origin);
    if (this.#tileEngine !== undefined) {
      this.#setRuntimeSchedule(this.#tileEngine, view);
    }
  }

  #setViewFromInteraction(view: Partial<ViewState>): void {
    if (this.#disposed) {
      throw createMapDisposedError();
    }
    this.#viewStore.set(view);
  }

  #applyMotion(snapshot: InteractionMotionSnapshot): void {
    this.#tileEngine?.setMotion(snapshot);
    if (snapshot.phase === 'idle' && this.#tileEngine !== undefined) {
      this.#setRuntimeSchedule(this.#tileEngine, this.#viewStore.get());
    }
  }

  #setRuntimeSchedule(
    runtime: TileEngineV2<TileBuildPayloadV1>,
    view: ViewState,
  ): void {
    runtime.setViewContext(
      view,
      this.#viewport,
      this.#source,
      this.#coverage,
      performance.now(),
    );
  }

  readonly #cacheOptions: NonNullable<Map3DOptions['cache']>;

  #wireRuntimeEvents(runtime: TileEngineV2<TileBuildPayloadV1>): void {
    runtime.on('stats', (stats) => {
      this.#events.emit('stats', toMapRuntimeStats(this.getBackend(), stats, this.#frameLastMs, this.#frameSamples));
    });
    runtime.on('idle', ({ stats }) => {
      this.#events.emit('idle', {
        stats: toMapRuntimeStats(
          this.getBackend(),
          stats,
          this.#frameLastMs,
          this.#frameSamples,
        ),
      });
    });
    runtime.on('error', (error) => this.#events.emit('error', error));
  }
}

function createLayerRecipe(
  layer: MapLayerOptions,
  renderOrder: number,
): TileLayerRecipeV1 {
  return layer.type === 'fill'
    ? createPolygonLayerRecipe(layer, renderOrder)
    : createLineLayerRecipe(layer, renderOrder);
}

function toMapRuntimeStats(
  backend: RenderBackend,
  stats: TileRuntimeStats,
  frameLastMs: number,
  frameSamples: readonly number[],
): MapRuntimeStats {
  return {
    backend,
    frame: { lastMs: frameLastMs, p95Ms: getPercentile95(frameSamples) },
    tiles: stats.tiles,
    resources: stats.resources,
    workers: stats.workers,
  };
}

function getPercentile95(samples: readonly number[]): number {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}
