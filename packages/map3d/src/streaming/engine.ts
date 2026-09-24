import { GLOBE_END } from '../globe/globeCamera.js';
import { stableTileZoom } from './lod.js';
import { selectGlobeTiles } from '../globe/cover.js';
import { PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import { updateMapCamera, type MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import type { Map3DOptions, MapError, ViewportSize, ViewState } from '../types.js';
import { cachedKey, canonicalKey, contains, keyOf, parentOf, type Address } from './address.js';
import { selectTiles, emptySelection } from './selection.js';
import { Samples } from './samples.js';
import { TileSurfaces } from './surface.js';
import { TileStore, type DemandKind } from './tileStore.js';
import { TilePipeline } from './pipeline.js';
import { resolveRenderCover, type CoverPatch, type RenderCover } from './renderCover.js';
import { fallbackRequests } from './fallbackDemand.js';
import { MAX_MAP_PITCH } from '../spatial/viewState.js';
import { TILE_LIMITS } from './limits.js';
export type { TileEntry } from './tileStore.js';

/** 同级邻居方向：左、右、上、下。 */
const NEIGHBOR_OFFSETS = new Int8Array([-1, 0, 1, 0, 0, -1, 0, 1]);
/** 预测预取的跳变阈值：单帧跨越这些幅度视为视图切换，不参与速度外推。 */
const PREDICT_JUMP_TILES = .75;
const PREDICT_JUMP_ZOOM = .25;
const PREDICT_JUMP_BEARING = 3;
const PREDICT_JUMP_PITCH = 5;
/** 需求准入档位：负值回退、当前细节、正回退、预测。 */
function demandBand(priority: number): number { return priority < 0 ? 0 : priority < 1000 ? 1 : priority < 1005 ? 2 : 3; }

/** 相机需求、可用覆盖和分阶段资源流水线的协调入口。 */
export class StreamingEngine {
  readonly shown = new Set<string>(); readonly wanted = new Set<string>();

  readonly store: TileStore; readonly pipeline: TilePipeline;
  readonly planTime = new Samples(); readonly coverTime = new Samples(); readonly recycleTime = new Samples();
  /** 帧内分阶段耗时的最近值；同一对象复用，供逐帧证据采样。 */
  readonly framePhases = { plan: 0, demand: 0, commit: 0, surfaces: 0, upload: 0, pump: 0, recycle: 0 };
  readonly timeline: { at: number; type: string; key: string }[] = [];
  readonly prefetch = new Map<string, { address: Address; until: number; priority: number }>();
  revision = 0;
  selection = emptySelection(); patches: CoverPatch[] = [];
  uncovered = 0; targetMissing = 0; displayZoomGap = 0; pendingDetailGap = 0; hits = 0; misses = 0; disposed = false;
  coverageDetails: { target: string; source: string; gap: number; priority: number }[] = [];
  private viewDirty = true; private demandDirty = true; private coverDirty = true; private lastPlan = -Infinity; private lastPrediction = -Infinity;
  private lastPrefetch = -Infinity; private lastRecycle = 0; private dropStale = false;
  private readonly demandScratch = new Map<string, { address: Address; kind: DemandKind; priority: number }>();
  private readonly wantedSnapshot = new Set<string>();
  private readonly prefetchScratch: string[] = [];
  private readonly patchSnapshot: number[] = [];
  private patchCount = 0;
  private cover: RenderCover | undefined; private coverAvailability = -1;
  private targetZoom = -1;
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
  /** 瓦片层级型图层使用当前目标层级，回退来源和连续相机距离不改变内容层级。 */
  get tileZoom(): number {
    return this.selection.leaves[0]?.z ?? Math.min(this.options.source.maxZoom,
      Math.max(this.options.source.minZoom, this.targetZoom < 0 ? this.options.source.minZoom : this.targetZoom));
  }
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
      const previousZoom = this.targetZoom;
      this.targetZoom = stableTileZoom(view.zoom, this.targetZoom);
      // 层级切换后旧层级的在途工作没有可复用内容，只会在队列里挡住新目标；
      // 首次规划不属于切换，不触发丢弃。
      if (previousZoom > 0 && this.targetZoom !== previousZoom) this.dropStale = true;
      const spherical = this.options.globe !== false && this.options.source.minZoom === 0 && view.zoom < GLOBE_END;
      if (view.zoom >= 6) this.predict(origin, view, viewport, now);
      // 条目较小的实例为缓存、回退和在途工作保留独立容量。
      const limit = Math.min(TILE_LIMITS.visible, Math.max(8, Math.floor(this.maxEntries * .6)));
      this.selection = spherical ? selectGlobeTiles(camera, origin, view, this.options.source.maxZoom, limit, frame, this.targetZoom) : selectTiles(camera, frame, origin, view, viewport, this.options.source.minZoom, this.options.source.maxZoom, 1, limit, this.targetZoom);
      // 依赖回退内容的目标可由子区域覆盖；相机变化后重新核验这些区域的可见范围。已解析空区域不触发重解。
      if (this.selection.leaves.some(a => !this.store.available.has(cachedKey(a)) && !this.store.isEmpty(a))) this.coverDirty = true;
      // 目标集合变化按顺序比较判定，不再逐帧拼接并排序签名字符串。
      if (!this.sameLeaves(this.selection.leaves)) {
        this.snapshotLeaves(this.selection.leaves);
        if (spherical && view.zoom < 6) this.overview = []; else this.prepareOverview(origin, view, viewport);
        this.scheduleNeighbors(now);
        this.demandDirty = true; this.coverDirty = true;
      }
      this.previousView = view; this.lastPlan = now; this.viewDirty = false;
      const elapsed = performance.now() - started; this.planTime.add(elapsed); this.framePhases.plan = elapsed;
    } else this.framePhases.plan = 0;
    if (this.demandDirty) {
      const demandStart = performance.now(); this.plan(now); this.demandDirty = false; this.framePhases.demand = performance.now() - demandStart;
      // 需求登记后再放弃，才能识别哪些在途工作已经不属于任何目标。
      if (this.dropStale) { this.dropStale = false; this.pipeline.dropValueless(); }
    } else this.framePhases.demand = 0;
    this.surfaces.fogCenter.value.set(frame.position.x, frame.position.y, frame.position.z);
    this.surfaces.fogStart.value = this.selection.fogStart; this.surfaces.fogEnd.value = this.selection.fogEnd;
    // 上传与相机规划共享主线程预算，超预算时下一帧获得独立上传机会。
    const uploadStart = performance.now();
    if (performance.now() - startedFrame < 1.5 || !planned) this.pipeline.upload(now, camera);
    this.framePhases.upload = performance.now() - uploadStart;
    if (this.coverDirty) {
      const commitStart = performance.now(); this.commit(origin, now); this.coverDirty = false; this.framePhases.commit = performance.now() - commitStart;
    } else this.framePhases.commit = 0;
    const surfaceStart = performance.now(); this.surfaces.update(origin, view.zoom, this.tileZoom); this.framePhases.surfaces = performance.now() - surfaceStart;
    const pumpStart = performance.now(); this.pipeline.pump(now); this.framePhases.pump = performance.now() - pumpStart;
    if (now - this.lastRecycle >= 250) {
      const start = performance.now();
      for (const [key, item] of this.prefetch) if (item.until <= now) { this.prefetch.delete(key); this.demandDirty = true; }
      this.store.makeRoom(); this.recycleTime.add(performance.now() - start); this.framePhases.recycle = performance.now() - start; this.lastRecycle = now;
    } else this.framePhases.recycle = 0;
  }
  private overview: Address[] = [];
  private leafSnapshot = new Int32Array(TILE_LIMITS.visible * 3);
  private leafSnapshotCount = 0;
  private lastNeighbors = -Infinity;
  private readonly neighborScratch: Address[] = [];
  private readonly selectedScratch = new Set<string>();
  /** 目标集合按顺序比较；快照复用同一 Int32Array，无逐帧分配。 */
  private sameLeaves(leaves: readonly Address[]): boolean {
    if (leaves.length !== this.leafSnapshotCount) return false;
    const snapshot = this.leafSnapshot;
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i]!;
      if (snapshot[i * 3] !== a.z || snapshot[i * 3 + 1] !== a.x || snapshot[i * 3 + 2] !== a.y) return false;
    }
    return true;
  }
  private snapshotLeaves(leaves: readonly Address[]): void {
    const required = leaves.length * 3;
    if (this.leafSnapshot.length < required) this.leafSnapshot = new Int32Array(2 ** Math.ceil(Math.log2(Math.max(1, required))));
    const snapshot = this.leafSnapshot;
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i]!;
      snapshot[i * 3] = a.z; snapshot[i * 3 + 1] = a.x; snapshot[i * 3 + 2] = a.y;
    }
    this.leafSnapshotCount = leaves.length;
  }
  /** 同级一圈邻居预热节流到慢速场景；快速平移的收益由当前层需求承担。 */
  private scheduleNeighbors(now: number): void {
    if (now - this.lastNeighbors < 250) return;
    this.lastNeighbors = now;
    const neighbors = this.neighborScratch; neighbors.length = 0;
    const selected = this.selectedScratch; selected.clear();
    for (const a of this.selection.leaves) selected.add(cachedKey(a));
    for (const a of this.selection.leaves) {
      for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 2) {
        const next = { z: a.z, x: a.x + NEIGHBOR_OFFSETS[i]!, y: a.y + NEIGHBOR_OFFSETS[i + 1]! };
        if (next.y < 0 || next.y >= 2 ** next.z) continue;
        const key = canonicalKey(next); if (selected.has(key)) continue;
        selected.add(key); neighbors.push(next);
      }
    }
    this.addPrefetch(neighbors, 1500, 10);
  }
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
    // 单帧跨越多个瓦片或大角度是视图切换而不是运动：不做速度外推，
    // 否则 setView 跳变会被放大成几十公里外的预取请求并破坏回访零请求。
    const jumped = Math.hypot(lng, lat) * 2 ** view.zoom / 360 > PREDICT_JUMP_TILES
      || Math.abs(dz) > PREDICT_JUMP_ZOOM || Math.abs(bearing) > PREDICT_JUMP_BEARING || Math.abs(pitch) > PREDICT_JUMP_PITCH;
    if (jumped) return;
    const tilesPerSecond = Math.hypot(lng, lat) * 2 ** view.zoom / 360 / dt;
    if (Math.abs(dz) / dt >= 1 || tilesPerSecond >= 4) this.pipeline.predictionUrgentUntil = now + 500;
    if (Math.abs(dz) + Math.abs(lng) + Math.abs(lat) + Math.abs(bearing) + Math.abs(pitch) < .00001) return;
    const horizon = Math.min(.65, Math.max(.2, this.requestTime.snapshot().p95 / 1000 + .1));
    const ahead = horizon / dt;
    const future = { ...view, center: { lng: view.center.lng + lng * ahead, lat: view.center.lat + lat * ahead },
      zoom: Math.max(this.options.source.minZoom, view.zoom + Math.max(-2, Math.min(1, dz * ahead))),
      bearing: view.bearing + bearing * ahead, pitch: Math.min(MAX_MAP_PITCH, Math.max(0, view.pitch + pitch * ahead)) };
    const nextFrame = updateMapCamera(this.predictiveCamera, future, viewport, origin);
    // 缩小时预热概览；平移时将预测容量用于当前层级。
    if (dz < -.001) {
    let coarseZoom = Math.max(this.options.source.minZoom, Math.floor(future.zoom) - 2);
    let coarse: Address[];
    do {
      coarse = selectTiles(this.predictiveCamera, nextFrame, origin, future, viewport, coarseZoom, coarseZoom).leaves;
      if (coarse.length <= TILE_LIMITS.fallbackRequests || coarseZoom === this.options.source.minZoom) break;
      coarseZoom--;
    } while (true);
    this.addPrefetch(coarse, 700, 5);
    }
    const selected = selectTiles(this.predictiveCamera, nextFrame, origin, future, viewport, this.options.source.minZoom, this.options.source.maxZoom, 1, 32);
    this.addPrefetch(selected.leaves, 700, 30);
  }
  private readyKeys() { return this.store.available; }
  /** 目标、回退与预测需求统一登记；优先级分档迭代代替每轮排序分配。 */
  private plan(now: number): void {
    this.pipeline.invalidate();
    const previous = this.wantedSnapshot; previous.clear(); for (const key of this.wanted) previous.add(key);
    this.wanted.clear();
    const available = this.readyKeys();
    const cover = resolveRenderCover(this.selection.leaves, available, this.options.source.minZoom, this.selection.visible);
    this.cover = cover; this.coverAvailability = available.revision;
    const demands = this.demandScratch; demands.clear();
    for (const leaf of this.selection.leaves) this.demand(leaf, 'visible', this.selection.priorities.get(keyOf(leaf)) ?? 0);
    const fallback = fallbackRequests(this.selection.leaves, cover.patches, this.options.source.minZoom,
      TILE_LIMITS.fallbackRequests, address => this.store.isEmpty(address),
      address => ['fetching', 'decoded', 'painting', 'upload', 'preparing'].includes(this.entries.get(canonicalKey(address))?.state ?? ''));
    for (const address of fallback) this.demand(address, 'fallback', -100);
    for (const patch of cover.patches) this.demand(patch.source, 'fallback', 100);
    // 回退安全网：为每个可见目标保留一个最近的祖先瓦片作为退路。
    // 目标层级一旦铺开顶替祖先的覆盖用途，祖先就失去需求：已就绪的会被回收，
    // 在途的会被当作无用工作丢弃。此后若网络中断或目标层级部分失败，缺口只能逐级向上回退，
    // 细密要素（路网等）整片消失，只剩低层级底图。
    // 这里只对已登记的祖先补一条低优先级需求：既能保住退路，又不新建请求、不影响首屏层级顺序。
    for (const leaf of this.selection.leaves) {
      let ancestor = parentOf(leaf);
      while (ancestor.z >= this.options.source.minZoom) {
        const entry = this.entries.get(canonicalKey(ancestor));
        // 已就绪或仍在生产途中的祖先都能成为退路；失败的不再兜底，继续向上找更粗的一级。
        if (entry !== undefined && entry.state !== 'failed') { this.demand(ancestor, 'fallback', -200); break; }
        ancestor = parentOf(ancestor);
      }
    }

    let predicted = 0;
    // 概览拥有独立预取名额，完整覆盖快速缩小和平移进入的新视域。
    // 一张概览瓦片即可覆盖整个视口：完全无可用覆盖时（首次进入或跳层加载）
    // 提升到最高档，先填满屏幕再逐级细化，避免整屏空白等待目标层级逐个返回。
    for (const address of this.overview) {
      if (predicted >= TILE_LIMITS.fallbackRequests) break;
      this.demand(address, 'predicted', 1005); predicted++;
    }
    const prefetchKeys = this.prefetchScratch; prefetchKeys.length = 0; for (const key of this.prefetch.keys()) prefetchKeys.push(key);
    prefetchKeys.sort((a, b) => (this.prefetch.get(a)!.priority - this.prefetch.get(b)!.priority) || (this.prefetch.get(b)!.until - this.prefetch.get(a)!.until));
    for (const key of prefetchKeys) {
      const item = this.prefetch.get(key); if (item === undefined) continue;
      if (item.until <= now) this.prefetch.delete(key); else this.demand(item.address, 'predicted', 1000 + item.priority);
      if (++predicted >= TILE_LIMITS.predicted) break;
    }
    for (const e of this.entries.values()) e.priority = Infinity;
    // 需求优先级先登记，使容量回收具有本轮用途信息。
    for (const [key, d] of demands) {
      const e = this.entries.get(key); if (!e) continue;
      e.priority = d.priority; e.kind = d.kind; e.touched = now; e.lastWanted = now;
      this.wanted.add(key); if (e.surface && !previous.has(key)) this.hits++;
    }
    // 新建条目按优先级档位顺序准入，保证预算紧张时先满足当前细节。
    for (let band = 0; band < 4; band++) for (const [key, d] of demands) {
      if (demandBand(d.priority) !== band || this.wanted.has(key)) continue;
      const entry = this.store.create(d.address, d.kind, d.priority, now);
      if (entry) { this.wanted.add(key); this.misses++; }
    }
  }
  private demand(address: Address, kind: DemandKind, priority: number): void {
    const key = canonicalKey(address); const existing = this.demandScratch.get(key);
    if (existing === undefined || priority < existing.priority) this.demandScratch.set(key, { address, kind, priority });
  }
  private commit(origin: MapOrigin, now: number): void {
    const start = performance.now();
    const available = this.readyKeys();
    // 同一份可用集合下复用规划阶段的覆盖结果，只有就绪集合变化才重新解析。
    const cover = this.cover !== undefined && this.coverAvailability === available.revision
      ? this.cover
      : resolveRenderCover(this.selection.leaves, available, this.options.source.minZoom, this.selection.visible);
    this.patches = cover.patches; this.uncovered = cover.uncovered; this.displayZoomGap = cover.maxGap;
    this.pendingDetailGap = 0;
    for (const target of this.selection.leaves) {
      if (this.entries.get(canonicalKey(target))?.empty) continue;
      for (const patch of cover.patches) if (contains(target, patch.cell)) this.pendingDetailGap = Math.max(this.pendingDetailGap, target.z - patch.source.z);
    }
    this.targetMissing = this.selection.leaves.filter(a => this.entries.get(canonicalKey(a))?.state !== 'ready').length;
    this.coverageDetails = cover.patches.filter(p => p.source.z < p.cell.z).map(p => ({ target: keyOf(p.cell), source: keyOf(p.source), gap: p.cell.z - p.source.z, priority: this.selection.priorities.get(keyOf(p.cell)) ?? 0 }));

    // 覆盖集合按顺序比较；只有实际变化才重建 GPU 侧模板与实例。
    if (!this.samePatches(cover.patches)) {
      this.revision++;
      this.surfaces.commit(cover.patches, this.entries, origin);
      this.shown.clear(); for (const p of cover.patches) this.shown.add(p.key);
      this.snapshotPatches(cover.patches);
      this.store.makeRoom();
    }
    for (const key of this.shown) this.entries.get(key)!.touched = now;
    this.coverTime.add(performance.now() - start);
  }
  private samePatches(patches: readonly CoverPatch[]): boolean {
    if (patches.length !== this.patchCount) return false;
    const snapshot = this.patchSnapshot;
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i]!;
      if (snapshot[i * 6] !== patch.cell.z || snapshot[i * 6 + 1] !== patch.cell.x || snapshot[i * 6 + 2] !== patch.cell.y
        || snapshot[i * 6 + 3] !== patch.source.z || snapshot[i * 6 + 4] !== patch.source.x || snapshot[i * 6 + 5] !== patch.source.y) return false;
    }
    return true;
  }
  private snapshotPatches(patches: readonly CoverPatch[]): void {
    const needed = patches.length * 6;
    while (this.patchSnapshot.length < needed) this.patchSnapshot.push(0);
    const snapshot = this.patchSnapshot;
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i]!;
      snapshot[i * 6] = patch.cell.z; snapshot[i * 6 + 1] = patch.cell.x; snapshot[i * 6 + 2] = patch.cell.y;
      snapshot[i * 6 + 3] = patch.source.z; snapshot[i * 6 + 4] = patch.source.x; snapshot[i * 6 + 5] = patch.source.y;
    }
    this.patchCount = patches.length;
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
