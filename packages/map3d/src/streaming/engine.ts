import { selectGlobeTiles } from '../globe/cover.js';
import { GLOBE_END } from '../globe/globeCamera.js';
import { PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import { updateMapCamera, type MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import type { Map3DOptions, MapError, ViewportSize, ViewState } from '../types.js';
import { canonicalKey, contains, keyOf, type Address } from './address.js';
import { selectTiles, emptySelection } from './selection.js';
import { Samples } from './samples.js';
import { TileSurfaces } from './surface.js';
import { TileStore, type DemandKind } from './tileStore.js';
import { TilePipeline } from './pipeline.js';
import { resolveRenderCover, type CoverPatch } from './renderCover.js';
import { fallbackRequests } from './fallbackDemand.js';
import { MAX_MAP_PITCH } from '../spatial/viewState.js';
import { TILE_LIMITS } from './limits.js';
export type { TileEntry } from './tileStore.js';

/** 相机需求、可用覆盖和分阶段资源流水线的协调入口。 */
export class StreamingEngine {
  readonly shown = new Set<string>(); readonly wanted = new Set<string>();
  readonly store: TileStore; readonly pipeline: TilePipeline;
  readonly planTime = new Samples(); readonly coverTime = new Samples(); readonly recycleTime = new Samples();
  readonly timeline: { at: number; type: string; key: string }[] = [];
  readonly prefetch = new Map<string, { address: Address; until: number; priority: number }>();
  revision = 0;
  selection = emptySelection(); patches: CoverPatch[] = [];
  uncovered = 0; targetMissing = 0; displayZoomGap = 0; pendingDetailGap = 0; hits = 0; misses = 0; disposed = false;
  coverageDetails: { target: string; source: string; gap: number; priority: number }[] = [];
  private viewDirty = true; private demandDirty = true; private coverDirty = true; private lastPlan = -Infinity; private lastPrediction = -Infinity;
  private lastPrefetch = -Infinity; private lastRecycle = 0; private signature = '';
  private selectionSignature = '';
  private previousView?: ViewState;
  private readonly predictiveCamera = new PerspectiveCamera();
  constructor(readonly options: Map3DOptions, readonly surfaces: TileSurfaces, readonly renderer: WebGPURenderer, readonly background: string, onError: (error: MapError) => void = () => {}) {
    this.store = new TileStore(surfaces, options.cache, this.shown);
    this.pipeline = new TilePipeline(this.store, options, renderer, background, () => { this.coverDirty = true; this.demandDirty = true; },
      (type, key) => this.log(type, key), onError);
  }
  get entries() { return this.store.entries; }
  get workers() { return this.pipeline.workers; }
  get maxEntries() { return this.store.maxEntries; } get maxCpuBytes() { return this.store.maxCpuBytes; } get maxGpuBytes() { return this.store.maxGpuBytes; }
  get cpuBytes() { return this.store.cpuBytes; } get gpuBytes() { return this.store.gpuBytes; }
  get starts() { return this.pipeline.starts; } get cancels() { return this.pipeline.queueCancels; } get retries() { return this.pipeline.retries; }
  get errors() { return this.pipeline.errors; } get bytes() { return this.pipeline.bytes; } get active() { return this.pipeline.active; } get evictions() { return this.store.evictions; }
  get workerTime() { return this.pipeline.workerTime; } get uploadTime() { return this.pipeline.uploadTime; }
  get httpTime() { return this.pipeline.httpTime; } get requestTime() { return this.pipeline.requestTime; }
  invalidate(): void { this.viewDirty = true; }
  addPrefetch(addresses: Address[], ttl = 1000, priority = 65, explicit = false): void {
    const now = performance.now(); if (explicit) this.lastPrefetch = now;
    for (const address of addresses) {
      const key = canonicalKey(address); const previous = this.prefetch.get(key);
      this.prefetch.set(key, { address, until: now + ttl, priority: Math.min(previous?.priority ?? Infinity, priority) });
    }
    for (const [key, value] of this.prefetch) if (value.until <= now) this.prefetch.delete(key);
    const ranked = [...this.prefetch].sort((a, b) => a[1].priority - b[1].priority || b[1].until - a[1].until);
    for (const [key] of ranked.slice(TILE_LIMITS.predicted)) this.prefetch.delete(key);
    this.demandDirty = true;
  }
  update(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    if (this.disposed) return;
    const startedFrame = performance.now(); let planned = false;
    if (this.viewDirty && now - this.lastPlan >= 16) {
      planned = true; const started = performance.now();
      const spherical = this.options.globe !== false && this.options.source.minZoom === 0 && view.zoom < GLOBE_END;
      if (!spherical) this.predict(origin, view, viewport, now);
      // 条目较小的实例为缓存、回退和在途工作保留独立容量。
      const limit = Math.min(TILE_LIMITS.visible, Math.max(8, Math.floor(this.maxEntries * .6)));
      this.selection = spherical ? selectGlobeTiles(camera, origin, view, this.options.source.maxZoom, limit) : selectTiles(camera, frame, origin, view, viewport, this.options.source.minZoom, this.options.source.maxZoom, 1, limit);
      const signature = this.selection.leaves.map(keyOf).sort().join('|');
      if (signature !== this.selectionSignature) {
        if (spherical) this.overview = []; else this.prepareOverview(origin, view, viewport); this.selectionSignature = signature;
        this.demandDirty = true; this.coverDirty = true;
      }
      this.previousView = view; this.lastPlan = now; this.viewDirty = false;
      this.planTime.add(performance.now() - started);
    }
    if (this.demandDirty) { this.plan(now); this.demandDirty = false; }
    this.surfaces.fogCenter.value.set(frame.position.x, frame.position.y, frame.position.z);
    this.surfaces.fogStart.value = this.selection.fogStart; this.surfaces.fogEnd.value = this.selection.fogEnd;
    // 上传与相机规划共享主线程预算，超预算时下一帧获得独立上传机会。
    if (performance.now() - startedFrame < 1.5 || !planned) this.pipeline.upload(now);
    if (this.coverDirty) { this.commit(origin, now); this.coverDirty = false; }
    this.surfaces.update(origin, view.zoom); this.pipeline.pump(now);
    if (now - this.lastRecycle >= 250) {
      const start = performance.now();
      for (const [key, item] of this.prefetch) if (item.until <= now) { this.prefetch.delete(key); this.viewDirty = true; }
      this.store.makeRoom(); this.recycleTime.add(performance.now() - start); this.lastRecycle = now;
    }
  }
  private overview: Address[] = [];
  /** OpenLayers nextExtent/preload 模型：单一概览级覆盖两级缩小后的有限视域。 */
  private prepareOverview(origin: MapOrigin, view: ViewState, viewport: ViewportSize): void {
    let zoom = Math.max(this.options.source.minZoom, Math.floor(view.zoom) - 2);
    const future = { ...view, zoom: Math.max(this.options.source.minZoom, view.zoom - 2) };
    const frame = updateMapCamera(this.predictiveCamera, future, viewport, origin);
    do {
      this.overview = selectTiles(this.predictiveCamera, frame, origin, future, viewport, zoom, zoom).leaves;
      if (this.overview.length <= TILE_LIMITS.fallbackRequests || zoom === this.options.source.minZoom) break;
      zoom--;
    } while (true);
  }
  private predict(origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    if (!this.previousView || now - this.lastPrediction < 100 || now - this.lastPrefetch < 500) return;
    this.lastPrediction = now;
    const dt = Math.max(.016, (now - this.lastPlan) / 1000);
    const dz = view.zoom - this.previousView.zoom;
    const lng = ((view.center.lng - this.previousView.center.lng + 540) % 360) - 180;
    const lat = view.center.lat - this.previousView.center.lat;
    const bearing = ((view.bearing - this.previousView.bearing + 540) % 360) - 180;
    const pitch = view.pitch - this.previousView.pitch;
    const tilesPerSecond = Math.hypot(lng, lat) * 2 ** view.zoom / 360 / dt;
    if (Math.abs(dz) / dt >= 1 || tilesPerSecond >= 4) this.pipeline.predictionUrgentUntil = now + 500;
    if (Math.abs(dz) + Math.abs(lng) + Math.abs(lat) + Math.abs(bearing) + Math.abs(pitch) < .00001) return;
    const horizon = Math.min(.65, Math.max(.2, this.requestTime.snapshot().p95 / 1000 + .1));
    const ahead = horizon / dt;
    const future = { ...view, center: { lng: view.center.lng + lng * ahead, lat: view.center.lat + lat * ahead },
      zoom: Math.max(this.options.source.minZoom, view.zoom + Math.max(-2, Math.min(1, dz * ahead))),
      bearing: view.bearing + bearing * ahead, pitch: Math.min(MAX_MAP_PITCH, Math.max(0, view.pitch + pitch * ahead)) };
    const nextFrame = updateMapCamera(this.predictiveCamera, future, viewport, origin);
    // 预测视域的粗级覆盖与近处细节共用预取限额；粗级保持完整视域。
    let coarseZoom = Math.max(this.options.source.minZoom, Math.floor(future.zoom) - 2);
    let coarse: Address[];
    do {
      coarse = selectTiles(this.predictiveCamera, nextFrame, origin, future, viewport, coarseZoom, coarseZoom).leaves;
      if (coarse.length <= TILE_LIMITS.fallbackRequests || coarseZoom === this.options.source.minZoom) break;
      coarseZoom--;
    } while (true);
    this.addPrefetch(coarse, 700, 5);
    const selected = selectTiles(this.predictiveCamera, nextFrame, origin, future, viewport, this.options.source.minZoom, this.options.source.maxZoom, 1, 32);
    this.addPrefetch(selected.leaves, 700, 30);
  }
  private readyKeys() { return this.store.available; }
  private plan(now: number): void {
    this.pipeline.invalidate();
    const previous = new Set(this.wanted); this.wanted.clear();
    const available = this.readyKeys(); const cover = resolveRenderCover(this.selection.leaves, available, this.options.source.minZoom, this.selection.visible);
    const demands = new Map<string, { address: Address; kind: DemandKind; priority: number }>();
    const demand = (address: Address, kind: DemandKind, priority: number) => {
      const key = canonicalKey(address); const existing = demands.get(key);
      if (!existing || priority < existing.priority) demands.set(key, { address, kind, priority });
    };
    for (const leaf of this.selection.leaves) demand(leaf, 'visible', this.selection.priorities.get(keyOf(leaf)) ?? 0);
    const fallback = fallbackRequests(this.selection.leaves, cover.patches, this.options.source.minZoom,
      TILE_LIMITS.fallbackRequests, address => this.entries.get(canonicalKey(address))?.empty === true,
      address => ['fetching', 'decoded', 'painting', 'upload'].includes(this.entries.get(canonicalKey(address))?.state ?? ''));
    for (const address of fallback) demand(address, 'fallback', -100);
    for (const patch of cover.patches) demand(patch.source, 'fallback', 100);
    for (const address of this.overview) demand(address, 'predicted', 900);
    let predicted = this.overview.length;
    for (const [key, item] of [...this.prefetch].sort((a, b) => a[1].priority - b[1].priority || b[1].until - a[1].until)) {
      if (item.until <= now) this.prefetch.delete(key); else demand(item.address, 'predicted', 1000 + item.priority);
      if (++predicted >= TILE_LIMITS.predicted) break;
    }
    for (const e of this.entries.values()) e.priority = Infinity;
    // 需求优先级先登记，使容量回收具有本轮用途信息。
    for (const [key, d] of demands) {
      const e = this.entries.get(key); if (!e) continue;
      e.priority = d.priority; e.kind = d.kind; e.touched = now; e.lastWanted = now;
      this.wanted.add(key); if (e.surface && !previous.has(key)) this.hits++;
    }
    for (const [key, d] of [...demands].sort((a, b) => a[1].priority - b[1].priority)) {
      if (this.wanted.has(key)) continue;
      const entry = this.store.create(d.address, d.kind, d.priority, now);
      if (entry) { this.wanted.add(key); this.misses++; }
    }
  }
  private commit(origin: MapOrigin, now: number): void {
    const start = performance.now(); const cover = resolveRenderCover(this.selection.leaves, this.readyKeys(), this.options.source.minZoom, this.selection.visible);
    this.patches = cover.patches; this.uncovered = cover.uncovered; this.displayZoomGap = cover.maxGap;
    this.pendingDetailGap = 0;
    for (const target of this.selection.leaves) {
      if (this.entries.get(canonicalKey(target))?.empty) continue;
      for (const patch of cover.patches) if (contains(target, patch.cell)) this.pendingDetailGap = Math.max(this.pendingDetailGap, target.z - patch.source.z);
    }
    this.targetMissing = this.selection.leaves.filter(a => this.entries.get(canonicalKey(a))?.state !== 'ready').length;
    this.coverageDetails = cover.patches.filter(p => p.source.z < p.cell.z).map(p => ({ target: keyOf(p.cell), source: keyOf(p.source), gap: p.cell.z - p.source.z, priority: this.selection.priorities.get(keyOf(p.cell)) ?? 0 }));
    const signature = cover.patches.map(p => `${keyOf(p.cell)}:${keyOf(p.source)}`).join('|');
    if (signature !== this.signature) {
      this.revision++;
      this.surfaces.commit(cover.patches, this.entries, origin); this.signature = signature;
      this.shown.clear(); for (const p of cover.patches) this.shown.add(p.key);
      this.store.makeRoom();
    }
    for (const key of this.shown) this.entries.get(key)!.touched = now;
    this.coverTime.add(performance.now() - start);
  }
  private log(type: string, key: string): void {
    this.timeline.push({ at: performance.now(), type, key });
    if (this.timeline.length > 4096) this.timeline.splice(0, 512);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.pipeline.dispose(); this.surfaces.dispose(); this.store.dispose(); this.shown.clear(); this.wanted.clear(); this.prefetch.clear();
  }
}
