import { Color, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { MapInteractionController } from './interaction/mapInteractions.js';
import { updateMapCamera, type MapCameraFrame } from './rendering/mapCamera.js';
import { normalizeViewport } from './rendering/viewport.js';
import { TypedEventEmitter } from './runtime/events.js';
import { createMapDisposedError } from './runtime/errors.js';
import { ViewStateStore } from './runtime/viewStateStore.js';
import { selectMapOrigin } from './spatial/mapOrigin.js';
import type { MapOrigin } from './spatial/types.js';
import { StreamingEngine } from './streaming/engine.js';
import { TileSurfaces } from './streaming/surface.js';
import { Samples } from './streaming/samples.js';
import { debugTiles } from './streaming/tileDebug.js';
import { auditPixels } from './streaming/pixelAudit.js';
import { tileDiagnostics } from './streaming/diagnostics.js';
import { selectTiles } from './streaming/selection.js';
import { LabelSystem } from './labels/labelSystem.js';
import { GLOBE_END } from './globe/globeCamera.js';
import { GlobeView } from './globe/globeView.js';
import { updateProjection } from './globe/projection.js';
import type { MapTheme, LabelAppearance, Map3DOptions, MapEventMap, MapRuntimeStats, RenderBackend, ViewportSize, ViewState } from './types.js';

/** Three.js 地图容器：相机交互、WebGPU 帧循环与瓦片流式合成。 */
export class Map3D {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly renderer: WebGPURenderer;
  private readonly viewStore: ViewStateStore;
  private readonly events = new TypedEventEmitter<MapEventMap>();
  private readonly interactions: MapInteractionController;
  private readonly cpu = new Samples(); private readonly interval = new Samples(); private readonly input = new Samples();
  private readonly background: Color;
  private theme: MapTheme | undefined;
  private labelAppearance: LabelAppearance = {};
  private engine: StreamingEngine | undefined;
  private labels: LabelSystem | undefined;
  private globe: GlobeView | undefined;
  private viewport = normalizeViewport({ width: 1, height: 1 });
  private origin: MapOrigin; private cameraFrame: MapCameraFrame;
  private initializePromise: Promise<void> | undefined;
  private disposed = false; private initialized = false; private running = false;
  private frameId = 0; private frameMs = 0; private cpuMs = 0; private engineMs = 0; private renderMs = 0;
  private readonly frameObservers = new Set<() => void>();
  private lastFrame = 0; private changedAt = 0; private lastStats = 0; private wasIdle = false;
  constructor(private readonly options: Map3DOptions) {
    if (!options.source.id || options.source.tiles.length === 0 || options.source.tiles.some(t => !['{z}', '{x}', '{y}'].every(part => t.includes(part)))) throw new TypeError('Source 必须包含有效 XYZ URL 模板。');
    if (!Number.isInteger(options.source.minZoom) || !Number.isInteger(options.source.maxZoom) || options.source.minZoom < 0 || options.source.maxZoom < options.source.minZoom) throw new TypeError('Source 层级范围无效。');
    this.background = new Color(options.renderer?.backgroundColor ?? '#F5F5F2'); this.scene.background = this.background;
    // WebGL 默认依赖线与字形的解析抗锯齿；显式 antialias=true 启用 4x MSAA。
    this.renderer = new WebGPURenderer({ canvas: options.canvas, stencil: true, antialias: options.renderer?.antialias ?? options.renderer?.forceWebGL !== true, forceWebGL: options.renderer?.forceWebGL ?? false });
    this.viewStore = new ViewStateStore(options.view);
    const view = this.getView(); this.origin = selectMapOrigin(view.center, Math.max(0, Math.floor(view.zoom)));
    this.cameraFrame = updateMapCamera(this.camera, view, this.viewport, this.origin, this.options.globe !== false && this.options.source.minZoom === 0);
    this.viewStore.onChange(v => { this.changedAt = performance.now(); this.applyView(v); this.events.emit('viewchange', { view: v }); });
    this.interactions = new MapInteractionController({ target: options.canvas, globe: options.globe !== false && options.source.minZoom === 0,
      getView: () => this.getView(), setView: v => this.viewStore.set(v), getViewport: () => this.viewport });
  }
  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(createMapDisposedError());
    this.initializePromise ??= this.initializeOnce(); return this.initializePromise;
  }
  private async initializeOnce(): Promise<void> {
    await this.renderer.init();
    if (this.disposed) throw createMapDisposedError();
    const surfaces = new TileSurfaces(this.scene, this.background, this.options.globe !== false && this.options.source.minZoom === 0);
    this.engine = new StreamingEngine(this.options, surfaces, this.renderer, `#${this.background.getHexString()}`, error => this.events.emit('error', error));
    if (this.options.labels && this.options.layers.some(layer => layer.type === 'symbol')) this.labels = new LabelSystem(this.options.labels, this.scene);
    if (this.theme) this.setTheme(this.theme); this.labels?.setStyle(this.labelAppearance);
    this.initialized = true; this.applyView(this.getView()); this.start();
    this.events.emit('load', { backend: this.getBackend() });
  }
  /** 原子更新全局调色板，已加载与后续瓦片共享同一主题。 */
  setTheme(theme: MapTheme): void {
    this.assertLive(); this.theme = theme; this.background.set(theme.backgroundColor);
    this.engine?.surfaces.palette.set(theme);
    this.engine?.surfaces.fogColor.value.set(theme.fogColor ?? theme.backgroundColor);
    this.engine?.surfaces.landColor.value.set(theme.landColor ?? theme.backgroundColor); this.globe?.setTheme(theme, this.engine?.surfaces.palette);
    this.labels?.invalidate();
  }
  /** 文字外观在下一次屏幕布局中生效，字形缓存继续复用。 */
  setLabelStyle(style: LabelAppearance): void { this.assertLive(); this.labelAppearance = style; this.labels?.setStyle(style); }
  getRenderer(): WebGPURenderer { return this.renderer; }
  getBackend(): RenderBackend {
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    return backend.isWebGPUBackend ? 'webgpu' : backend.isWebGLBackend ? 'webgl2' : 'unknown';
  }
  getView(): ViewState { return this.viewStore.get(); }
  setView(view: Partial<ViewState>): void { this.assertLive(); this.interactions.cancelMotion(); this.viewStore.set(view); }
  /** 预取未来相机视图，适用于飞行路线和已知目的地。 */
  prefetchViews(views: readonly ViewState[], options: { ttlMs?: number; priority?: number; limit?: number } = {}): void {
    this.assertLive(); if (!this.engine) return;
    const camera = new PerspectiveCamera();
    for (const view of views) {
      const origin = selectMapOrigin(view.center, Math.max(0, Math.floor(view.zoom)));
      const frame = updateMapCamera(camera, view, this.viewport, origin);
      const selection = selectTiles(camera, frame, origin, view, this.viewport, this.options.source.minZoom, this.options.source.maxZoom);
      this.engine.addPrefetch(selection.leaves.slice(0, options.limit ?? 32), options.ttlMs ?? 1600, options.priority ?? 65, true);
    }
  }
  on<T extends keyof MapEventMap>(type: T, listener: (event: MapEventMap[T]) => void): () => void { this.assertLive(); return this.events.on(type, listener); }
  resize(size: ViewportSize): void {
    this.assertLive();
    this.viewport = normalizeViewport({ ...size, pixelRatio: Math.min(size.pixelRatio ?? 1, this.options.renderer?.maxPixelRatio ?? 2) });
    this.renderer.setPixelRatio(this.viewport.pixelRatio); this.renderer.setSize(this.viewport.width, this.viewport.height, false); this.applyView(this.getView());
  }
  private applyView(view: ViewState): void {
    this.origin = selectMapOrigin(view.center, Math.max(0, Math.floor(view.zoom)));
    this.cameraFrame = updateMapCamera(this.camera, view, this.viewport, this.origin, this.options.globe !== false && this.options.source.minZoom === 0);
    updateProjection(this.scene, view, this.origin, this.options.globe !== false && this.options.source.minZoom === 0); this.engine?.invalidate();
  }
  start(): void {
    this.assertLive(); if (!this.initialized || this.running) return;
    this.running = true; this.lastFrame = 0; this.renderer.setAnimationLoop(time => this.renderFrame(time));
  }
  stop(): void { this.running = false; this.renderer.setAnimationLoop(null); }
  private renderFrame(now: number): void {
    if (!this.running || this.disposed) return;
    const start = performance.now();
    this.frameMs = this.lastFrame ? now - this.lastFrame : 0;
    if (this.lastFrame) this.interval.add(this.frameMs); this.lastFrame = now;
    if (this.changedAt) { this.input.add(start - this.changedAt); this.changedAt = 0; }
    this.engine?.update(this.camera, this.cameraFrame, this.origin, this.getView(), this.viewport, start);
    const view = this.getView(), globeActive = this.options.globe !== false && this.options.source.minZoom === 0 && view.zoom < GLOBE_END;
    if (globeActive && !this.globe) { this.globe = new GlobeView(this.options, this.scene); if (this.theme) this.globe.setTheme(this.theme, this.engine?.surfaces.palette); }
    this.globe?.update(this.scene.userData.mapProjection);
    if (this.globe && !globeActive) this.globe.mesh.visible = false;
    if (this.labels && this.engine) this.labels.update(this.engine.surfaces, this.camera, this.origin, view, this.viewport, this.engine.revision, start, this.engine.selection.fogEnd);
    this.engineMs = performance.now() - start;
    this.renderer.render(this.scene, this.camera);
    this.renderMs = performance.now() - start - this.engineMs;
    this.cpuMs = performance.now() - start; this.cpu.add(this.cpuMs); this.frameId++;
    for (const observer of this.frameObservers) observer();
    if (now - this.lastStats > 250) {
      this.lastStats = now; const stats = this.getStats(); this.events.emit('stats', stats);
      const idle = this.engine ? ![...this.engine.entries.values()].some(e => Number.isFinite(e.priority) && e.state !== 'ready' && e.state !== 'failed') : false;
      if (idle && !this.wasIdle) this.events.emit('idle', { stats }); this.wasIdle = idle;
    }
  }
  getStats(): MapRuntimeStats {
    const engine = this.engine; const entries = engine ? [...engine.entries.values()] : [];
    const count = (state: string) => entries.filter(e => e.state === state).length;
    const frame = this.cpu.snapshot(); const visible = engine?.shown.size ?? 0;
    return { backend: this.getBackend(), frame: { lastMs: frame.last, p95Ms: frame.p95 },
      tiles: { visible, queued: count('queued'), fetching: count('fetching'), decoding: 0, building: count('painting'), ready: count('ready'), empty: entries.filter(e => e.empty).length, failed: count('failed') },
      resources: { cpuBytes: engine?.cpuBytes ?? 0, gpuBytes: engine?.gpuBytes ?? 0, batches: visible, features: entries.filter(e => engine?.shown.has(e.key)).reduce((sum, e) => sum + e.features, 0), vertices: entries.filter(e => engine?.shown.has(e.key)).reduce((sum, e) => sum + 4 + (e.surface?.lines?.vertices ?? 0) + (e.surface?.fills?.vertices ?? 0) + (e.surface?.buildings?.vertices ?? 0), 0), indices: entries.filter(e => engine?.shown.has(e.key)).reduce((sum, e) => sum + 6 + (e.surface?.lines?.indices ?? 0) + (e.surface?.fills?.indices ?? 0) + (e.surface?.buildings?.indices ?? 0), 0), objects: entries.filter(e => e.surface).reduce((sum, e) => sum + 1 + (e.surface?.lines ? 1 : 0) + (e.surface?.fills ? 1 : 0) + (e.surface?.buildings ? 1 : 0), 0) },
      workers: engine?.workers.getStats() ?? { active: 0, queued: 0 } };
  }
  getDiagnostics() {
    const interval = this.interval.snapshot(); const info = this.renderer.info;
    return { backend: this.getBackend(), view: this.getView(), viewport: this.viewport,
      camera: { position: this.cameraFrame.position, origin: this.origin },
      frame: { cpu: this.cpu.snapshot(), interval, input: this.input.snapshot(), fps: interval.mean > 0 ? 1000 / interval.mean : 0 },
      render: { drawCalls: info.render.drawCalls, triangles: info.render.triangles },
      memory: { paletteBytes: this.engine ? this.engine.surfaces.palette.values.byteLength + this.engine.surfaces.palette.parameters.byteLength : 0, geometries: info.memory.geometries, textures: info.memory.textures, total: this.engine?.gpuBytes ?? 0 },
      workers: this.engine?.workers.getStats(), sceneTiles: this.engine?.shown.size ?? 0,
      labels: this.labels ? { candidates: this.labels.candidates, placed: this.labels.placed, glyphs: this.labels.atlas.glyphs.size, glyphErrors: this.labels.atlas.errors,
        missingGlyphs: this.labels.atlas.missing, layoutMs: this.labels.layoutMs, layouts: this.labels.layouts, quads: this.labels.surface.count,
        atlasBytes: this.labels.atlas.size ** 2, pendingRanges: this.labels.atlas.pending.size, cachedRanges: this.labels.atlas.pages.size } : undefined,
      overlayCacheBytes: this.engine?.pipeline.overlays.bytes ?? 0,
      globe: { active: this.options.globe !== false && this.options.source.minZoom === 0 && this.getView().zoom < GLOBE_END,
        ready: !!this.globe && this.engine?.targetMissing === 0, errors: this.engine?.errors ?? 0 },
      tiles: this.engine ? tileDiagnostics(this.engine) : undefined };
  }
  /** 观察已完成提交的实际渲染帧，调用者负责采样和存储。 */
  observeFrames(observer: () => void): () => void { this.frameObservers.add(observer); return () => { this.frameObservers.delete(observer); }; }
  getFrameState() {
    const e = this.engine;
    return { id: this.frameId, at: this.lastFrame, ms: this.frameMs, cpuMs: this.cpuMs, engineMs: this.engineMs, renderMs: this.renderMs, view: this.getView(),
      revision: e?.revision ?? 0, uncovered: e?.uncovered ?? 0, missing: e?.targetMissing ?? 0, gap: e?.displayZoomGap ?? 0, pendingDetailGap: e?.pendingDetailGap ?? 0,
      fogStart: e?.selection.fogStart ?? 0, fogEnd: e?.selection.fogEnd ?? 0, cutoff: e?.selection.cutoff ?? 0,
      target: e?.selection.leaves.length ?? 0, sources: e?.shown.size ?? 0, entries: e?.entries.size ?? 0,
      fetching: e?.active ?? 0, cpuBytes: e?.cpuBytes ?? 0, gpuBytes: e?.gpuBytes ?? 0 };
  }
  getTileDebug() { return debugTiles(this.camera, this.origin, this.viewport, this.engine?.patches ?? [], this.engine?.selection.cutoff ?? 0); }
  /** 同步像素回读供专项视觉验证使用，调用耗时独立于常规帧率验收。 */
  auditPixels() { return this.engine ? auditPixels(this.options.canvas, this.camera, this.origin, this.engine) : []; }
  getTileTimeline() { return this.engine ? [...this.engine.timeline] : []; }
  /** 当前真实地面分区与数据来源；调试层按需读取。 */
  getTileSnapshot() {
    return { patches: this.engine?.patches ?? [], desired: this.engine?.selection.ideal ?? [], targets: this.engine?.selection.leaves ?? [],
      entries: this.engine ? [...this.engine.entries.values()].map(e => ({ key: e.key, state: e.state, reason: e.kind,
        priority: e.priority, visible: this.engine!.shown.has(e.key) })) : [] };
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.stop(); this.interactions.dispose(); this.viewStore.dispose();
    this.globe?.dispose(); this.labels?.dispose(); this.engine?.dispose(); this.engine = undefined; this.renderer.dispose(); this.events.clear(); this.frameObservers.clear(); this.initialized = false;
  }
  private assertLive(): void { if (this.disposed) throw createMapDisposedError(); }
}
