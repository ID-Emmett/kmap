import type { ViewState, ViewportSize } from '../types.js';
import { advancePlanEpoch, advanceTileGeneration, createPlanEpoch, createTileGeneration, type PlanEpoch, type TileGeneration } from './epoch.js';
import { NovaTileEventEmitter, type NovaTileEventMap, type TileStats } from './events.js';

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

/** T031 的契约基座；后续模块通过同一生命周期接口接入。 */
export class NovaTileEngine implements NovaTileEngineContract {
  readonly #events = new NovaTileEventEmitter<NovaTileEventMap>();
  readonly #clock: { now(): number };
  #planEpoch: PlanEpoch = createPlanEpoch();
  #generation: TileGeneration = createTileGeneration();
  #viewport: ViewportSize | undefined;
  #view: ViewState | undefined;
  #initialized = false;
  #disposed = false;
  #lastFrame: FrameTime | undefined;

  constructor(options: { clock?: { now(): number } } = {}) {
    this.#clock = options.clock ?? { now: () => performance.now() };
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
    return Promise.resolve();
  }

  resize(viewport: ViewportSize): void {
    this.assertUsable();
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw new RangeError('viewport width/height 必须是正数。');
    }
    this.#viewport = Object.freeze({ ...viewport });
  }

  updateView(view: ViewState): void {
    this.assertUsable();
    if (!Number.isFinite(view.zoom) || !Number.isFinite(view.bearing) || !Number.isFinite(view.pitch) || !Number.isFinite(view.center.lng) || !Number.isFinite(view.center.lat)) {
      throw new RangeError('ViewState 必须包含有限数值。');
    }
    this.#planEpoch = advancePlanEpoch(this.#planEpoch);
    this.#view = Object.freeze({ center: { ...view.center }, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
    this.#events.emit('plan', Object.freeze({ planEpoch: this.#planEpoch, view: this.#view, targetKeys: Object.freeze([]) }));
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
    this.#events.emit('stats', this.getStats());
  }

  getStats(): TileStats {
    return Object.freeze({ planEpoch: this.#planEpoch, generation: this.#generation, planned: 0, inFlight: 0, ready: 0, committed: 0, retained: 0, failed: 0, empty: 0 });
  }

  getPlanEpoch(): PlanEpoch {
    return this.#planEpoch;
  }

  getGeneration(): TileGeneration {
    return this.#generation;
  }

  /** 为同一 canonical Tile 开启新 generation，令旧异步结果失效。 */
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
    this.#events.clear();
    return Promise.resolve();
  }

  private assertUsable(): void {
    if (this.#disposed) {
      throw new Error('NovaTileEngine 已销毁。');
    }
  }
}
