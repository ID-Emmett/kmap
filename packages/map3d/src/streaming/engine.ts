import { PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import { updateMapCamera, type MapCameraFrame } from '../rendering/mapCamera.js';
import type { MapOrigin } from '../spatial/types.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { Map3DOptions, MapError, ViewportSize, ViewState } from '../types.js';
import { contains, keyOf, parentOf, requestUrl, tileBounds, type Address } from './address.js';
import { selectTiles, type Selection } from './selection.js';
import { Samples } from './samples.js';
import { TileSurfaces, type Surface } from './surface.js';
import { PaintWorkers } from './workers.js';
import type { PaintResponse } from './protocol.js';
import { lineBytes, linePixelScale } from './lines.js';
import { coveredFraction } from './coverage.js';

export interface TileEntry {
  address: Address; key: string; state: 'queued' | 'fetching' | 'painting' | 'upload' | 'ready' | 'failed';
  priority: number; touched: number; attempts: number; retryAt: number; controller?: AbortController;
  result?: PaintResponse; surface?: Surface; shownAt?: number; lastVisible?: number; features: number; empty: boolean;
}

/** 视图需求、固定并发、纹理预算、父子覆盖与 LRU 的单实例协调器。 */
export class StreamingEngine {
  readonly entries = new Map<string, TileEntry>();
  readonly workers = new PaintWorkers();
  readonly planTime = new Samples(); readonly coverTime = new Samples(); readonly recycleTime = new Samples();
  readonly workerTime = new Samples(); readonly uploadTime = new Samples(); readonly httpTime = new Samples(); readonly requestTime = new Samples();
  readonly timeline: { at: number; type: string; key: string }[] = [];
  selection: Selection = { leaves: [], priorities: new Map(), cutoff: 1, fogStart: 1, visited: 0, culled: 0 };
  readonly wanted = new Set<string>(); readonly shown = new Set<string>();
  private readonly critical = new Set<string>();
  private readonly retiredWarm = new Set<string>();
  coverageDetails: { target: string; source: string; gap: number; priority: number; pending?: { key: string; state: string; priority: number; wanted: boolean }[] }[] = [];
  private readonly fading = new Map<string, string>();
  readonly prefetch = new Map<string, { address: Address; until: number; priority: number; coverage: boolean }>();
  readonly maxEntries: number; readonly maxGpuBytes: number; readonly maxCpuBytes: number;
  starts = 0; cancels = 0; retries = 0; errors = 0; bytes = 0; hits = 0; misses = 0; evictions = 0;
  active = 0; gpuBytes = 0; cpuBytes = 0; disposed = false; uncovered = 0; targetMissing = 0; displayZoomGap = 0;
  private viewDirty = true; private lastPlan = -Infinity; private lastEvict = 0; private coverDirty = true;
  private readonly uploads: TileEntry[] = [];
  private groundCenter = { x: 0, y: 0 };
  private previousTargets = new Set<string>();
  private plannedView: ViewState | undefined;
  private externalPrefetchUntil = 0;
  private zoomVelocity = 0;
  private readonly predictiveCamera = new PerspectiveCamera();
  constructor(readonly options: Map3DOptions, readonly surfaces: TileSurfaces, readonly renderer: WebGPURenderer, readonly background: string, readonly onError: (error: MapError) => void = () => {}) {
    this.maxEntries = options.cache?.maxTileEntries ?? 384;
    this.maxGpuBytes = options.cache?.maxGpuBytes ?? 256 * 1048576;
    this.maxCpuBytes = options.cache?.maxCpuBytes ?? 256 * 1048576;
  }
  invalidate(): void { this.viewDirty = true; }
  addPrefetch(addresses: Address[], ttl = 1600, priority = 65, explicit = false, coverage = false): void {
    if (explicit) this.externalPrefetchUntil = performance.now() + 1600;
    for (const address of addresses) {
      const key = keyOf(address); const previous = this.prefetch.get(key);
      this.prefetch.delete(key);
      this.prefetch.set(key, { address, until: Math.max(previous?.until ?? 0, performance.now() + ttl), priority: Math.min(previous?.priority ?? Infinity, priority), coverage: coverage || previous?.coverage === true });
    }
    if (this.prefetch.size > 150) {
      const discard = [...this.prefetch].sort((a, b) => b[1].priority - a[1].priority || a[1].until - b[1].until).slice(0, this.prefetch.size - 150);
      for (const [key] of discard) this.prefetch.delete(key);
    }
    this.viewDirty = true;
  }
  update(camera: PerspectiveCamera, frame: MapCameraFrame, origin: MapOrigin, view: ViewState, viewport: ViewportSize, now: number): void {
    if (this.disposed) return;
    if (this.zoomVelocity < -.5 && !this.viewDirty && now - this.lastPlan >= 150) { this.zoomVelocity = 0; this.viewDirty = true; }
    const previous = this.plannedView;
    const center = { x: origin.meters.x + frame.target.x, y: origin.meters.y - frame.target.z };
    const sudden = !previous || Math.abs(view.zoom - previous.zoom) > .25 || Math.abs(view.pitch - previous.pitch) > 6
      || Math.abs(((view.bearing - previous.bearing + 540) % 360) - 180) > 12
      || Math.hypot(center.x - this.groundCenter.x, center.y - this.groundCenter.y) > frame.distance * .2;
    let planned = false;
    if (this.viewDirty && (sudden || now - this.lastPlan >= 45)) {
      const start = performance.now(); planned = true;
      if (previous && Number.isFinite(this.lastPlan)) {
        const seconds = Math.max(.016, (now - this.lastPlan) / 1000);
        const velocity = Math.max(-8, Math.min(8, (view.zoom - previous.zoom) / seconds));
        this.zoomVelocity = velocity;
        if (velocity < -.2 && now >= this.externalPrefetchUntil) {
          const future = { ...view, zoom: Math.max(this.options.source.minZoom, view.zoom + Math.max(-1.5, velocity * .6)) };
          const futureFrame = updateMapCamera(this.predictiveCamera, future, viewport, origin);
          const futureTiles = selectTiles(this.predictiveCamera, futureFrame, origin, future, viewport, this.options.source.minZoom, this.options.source.maxZoom, 1.05, 40);
          this.addPrefetch(futureTiles.leaves, 900, 10);
          this.addPrefetch(futureTiles.leaves.filter(a => a.z > this.options.source.minZoom).map(parentOf), 900, -20, false, true);
          const overview = futureTiles.leaves.map(leaf => {
            let address = leaf;
            for (let i = 0; i < 4 && address.z > this.options.source.minZoom; i++) address = parentOf(address);
            return address;
          });
          this.addPrefetch(overview, 900, -40, false, true);
        }
      }
      this.viewDirty = false; this.lastPlan = now;
      this.selection = selectTiles(camera, frame, origin, view, viewport, this.options.source.minZoom, this.options.source.maxZoom);
      this.groundCenter = center; this.plannedView = view;
      this.plan(now); this.planTime.add(performance.now() - start); this.coverDirty = true;
    }
    this.surfaces.fogCenter.value.set(frame.target.x, frame.target.z);
    this.surfaces.fogStart.value = this.selection.fogStart; this.surfaces.fogEnd.value = this.selection.cutoff;
    // 选片和资源上传占用不同帧，使瞬时视图更新具有独立 CPU 预算。
    if (!planned) this.upload(now);
    if (this.coverDirty) { this.resolveCover(now); this.coverDirty = false; }
    for (const key of this.shown) {
      const entry = this.entries.get(key)!;
      this.surfaces.place(entry.surface!.mesh, entry.address, origin);
      const alpha = Math.min(1, (now - (entry.shownAt ?? now)) / 140);
      if (entry.surface!.mesh.material.opacity < 1 && alpha === 1) this.coverDirty = true;
      const incoming = this.entries.get(this.fading.get(key) ?? '');
      entry.surface!.mesh.material.opacity = incoming ? Math.max(0, 1 - (now - (incoming.shownAt ?? now)) / 140) : alpha;
      if (incoming?.surface) incoming.surface.mesh.material.opacity = 1;
      const lines = entry.surface!.lines;
      if (lines) { lines.pixelScale.value = linePixelScale(entry.address.z, view.zoom); lines.viewZoom.value = view.zoom; lines.mesh.material.opacity = entry.surface!.mesh.material.opacity; }
    }
    this.pump(now);
    if (now - this.lastEvict > 200) { this.evict(now); this.lastEvict = now; }
  }
  private plan(now: number): void {
    const previous = new Set(this.wanted); this.wanted.clear(); this.critical.clear();
    const targets = new Set(this.selection.leaves.map(keyOf));
    const demands = new Map<string, { address: Address; priority: number }>();
    const visitedNeighbors = new Set<string>();
    const demand = (address: Address, priority: number, warm = false) => {
      const key = keyOf(address); const previous = demands.get(key);
      if (warm && this.retiredWarm.has(key) && !this.entries.has(key)) return;
      if (!previous || priority < previous.priority) demands.set(key, { address, priority });
    };
    const admit = (address: Address, priority: number) => {
      const key = keyOf(address);
      let entry = this.entries.get(key);
      if (!entry && this.entries.size >= this.maxEntries) {
        const candidate = [...this.entries.values()].filter(e => !this.shown.has(e.key) && !this.wanted.has(e.key) && (e.state === 'queued' || (e.state === 'ready' && (this.critical.has(key) || (!this.critical.has(e.key) && (demands.get(e.key)?.priority ?? Infinity) > priority)))))
          .sort((a, b) => Number(a.state === 'ready') - Number(b.state === 'ready') || Number(this.critical.has(a.key)) - Number(this.critical.has(b.key)) || Number(this.localCover(a.address)) - Number(this.localCover(b.address)) || (demands.get(b.key)?.priority ?? Infinity) - (demands.get(a.key)?.priority ?? Infinity) || a.touched - b.touched)[0];
        if (!candidate) return;
        if (candidate.state === 'queued') { this.entries.delete(candidate.key); this.cancels++; }
        else this.releaseEntry(candidate);
      }
      this.wanted.add(key);
      if (!entry) {
        entry = { address, key, state: 'queued', priority, touched: now, attempts: 0, retryAt: 0, features: 0, empty: false };
        this.entries.set(key, entry); this.misses++;
      } else {
        entry.priority = Math.min(entry.priority, priority); entry.touched = now;
        if (entry.state === 'ready' && (!previous.has(key) || (targets.has(key) && !this.previousTargets.has(key)))) this.hits++;
        if (entry.state === 'failed' && entry.attempts < 3 && now >= entry.retryAt) entry.state = 'queued';
      }
    };
    for (const entry of this.entries.values()) entry.priority = Infinity;
    for (const leaf of this.selection.leaves) {
      const priority = this.selection.priorities.get(keyOf(leaf)) ?? 0;
      this.critical.add(keyOf(leaf));
      demand(leaf, priority + (this.zoomVelocity < -.5 ? 60 : 0));
      let ancestor = leaf;
      const depth = leaf.z - this.options.source.minZoom;
      const exact = this.entries.get(keyOf(leaf));
      let emptyChain = exact?.empty === true;
      for (let level = 1; level <= depth && ancestor.z > this.options.source.minZoom; level++) {
        ancestor = parentOf(ancestor);
        const cover = level === Math.min(2, depth); const safety = level === Math.min(3, depth) || level === Math.min(5, depth);
        if (cover || emptyChain) this.critical.add(keyOf(ancestor));
        if (cover || safety || emptyChain) demand(ancestor, priority + (cover || emptyChain ? -30 : -10), exact?.state === 'ready' && !exact.empty);
        emptyChain = (cover || safety || emptyChain) && this.entries.get(keyOf(ancestor))?.empty === true;
        if ((cover || safety) && !visitedNeighbors.has(keyOf(ancestor))) {
          visitedNeighbors.add(keyOf(ancestor));
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const neighbor = { z: ancestor.z, x: ancestor.x + dx, y: ancestor.y + dy };
            if (neighbor.y >= 0 && neighbor.y < 2 ** neighbor.z && this.insideCutoff(neighbor)) {
              demand(neighbor, priority + (cover ? 5 : 30), !cover);
            }
          }
        }
      }
      // 一圈邻接数据为平移提供确定的提前量。
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const y = leaf.y + dy;
        const address = { z: leaf.z, x: leaf.x + dx, y };
        if (y >= 0 && y < 2 ** leaf.z && this.insideCutoff(address)) demand(address, priority + 100, true);
      }
    }
    for (const [key, item] of this.prefetch) {
      if (item.until < now) this.prefetch.delete(key); else demand(item.address, item.priority, !item.coverage);
    }
    // 截止半径内的低层级环覆盖全部方位，为直接倾角切换和一档缩小提供就绪数据。
    for (const depth of [3, 4]) {
      const z = Math.max(this.options.source.minZoom, Math.floor(this.plannedView!.zoom) - depth);
      const span = WORLD / 2 ** z;
      const centerX = Math.floor((this.groundCenter.x + WORLD / 2) / span);
      const centerY = Math.floor((WORLD / 2 - this.groundCenter.y) / span);
      const radius = Math.ceil(this.selection.cutoff / span);
      for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
        const address = { z, x: centerX + dx, y: centerY + dy };
        if (address.y >= 0 && address.y < 2 ** z && this.insideCutoff(address)) demand(address, 25 + Math.hypot(dx, dy));
      }
    }
    // 等待需求只保存地址；位图和几何在上传阶段按实际字节执行独立驻留预算。
    const capacity = this.maxEntries - 20;
    for (const [key, entry] of this.entries) if (entry.state === 'queued' && !demands.has(key)) { this.entries.delete(key); this.cancels++; }
    // 当前目标及近邻祖先具有独立准入层，路线预取的数值优先级在预取层内排序。
    for (const item of [...demands.values()].sort((a, b) => Number(this.critical.has(keyOf(b.address))) - Number(this.critical.has(keyOf(a.address))) || a.priority - b.priority).slice(0, Math.max(1, capacity))) admit(item.address, item.priority);
    for (const [key, entry] of this.entries) {
      if (!this.wanted.has(key) && entry.state === 'queued') { this.entries.delete(key); this.cancels++; }
      // 已启动的短请求完成后可直接进入缓存，视图刷新只重排尚未启动的工作。
    }
    this.previousTargets = targets;
  }
  private insideCutoff(address: Address): boolean {
    const b = tileBounds(address);
    return Math.hypot(Math.max(b.west - this.groundCenter.x, 0, this.groundCenter.x - b.west - b.span), Math.max(b.north - b.span - this.groundCenter.y, 0, this.groundCenter.y - b.north)) < this.selection.cutoff;
  }
  /** 附近的低层级数据为方位和倾角变化提供可直接显示的基础覆盖。 */
  private localCover(address: Address): boolean {
    return address.z <= Math.floor(this.plannedView?.zoom ?? 0) - 2 && this.insideCutoff(address);
  }
  private pump(now: number): void {
    const workerStats = this.workers.getStats();
    const capacity = Math.min(12 - this.active, 12 - this.active - workerStats.active - workerStats.queued - this.uploads.length);
    if (capacity <= 0) return;
    const queued = [...this.entries.values()].filter(e => e.state === 'queued' && this.wanted.has(e.key) && e.retryAt <= now).sort((a, b) => a.priority - b.priority);
    const batch = queued.slice(0, this.zoomVelocity < -.5 ? capacity : Math.max(1, Math.floor(capacity * 2 / 3)));
    const targets = new Set(this.selection.leaves.map(keyOf));
    for (const entry of queued.filter(e => targets.has(e.key))) if (!batch.includes(entry) && batch.length < capacity) batch.push(entry);
    for (const entry of queued) if (!batch.includes(entry) && batch.length < capacity) batch.push(entry);
    for (const entry of batch) void this.load(entry);
  }
  private async load(entry: TileEntry): Promise<void> {
    entry.state = 'fetching'; entry.attempts++; this.starts++; this.active++;
    const start = performance.now(); const controller = new AbortController(); entry.controller = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    this.log('request', entry.key);
    try {
      const response = await fetch(requestUrl(entry.address, this.options.source.tiles), { signal: controller.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = response.status === 204 ? new ArrayBuffer(0) : await response.arrayBuffer();
      this.httpTime.add(performance.now() - start); this.bytes += buffer.byteLength;
      clearTimeout(timer); this.active--; delete entry.controller;
      if (this.disposed) return;
      if (!this.wanted.has(entry.key)) { this.entries.delete(entry.key); return; }
      if (buffer.byteLength === 0) {
        entry.empty = true; entry.state = 'ready'; this.invalidate(); this.coverDirty = true; this.log('empty', entry.key); return;
      }
      entry.state = 'painting';
      // 最细三级面纹理使用二倍采样，其余层级使用 256 CSS 像素原生采样；线图层独立栅格化。
      const size = entry.address.z >= this.options.source.maxZoom - 2 ? 512 : 256;
      const result = await this.workers.run({ address: entry.address, buffer, layers: this.options.layers, size, background: this.background });
      this.workerTime.add(result.paintMs); this.requestTime.add(performance.now() - start);
      if (this.disposed) { result.bitmap?.close(); return; }
      entry.result = result; entry.features = result.features; entry.empty = result.empty; entry.state = 'upload';
      this.uploads.push(entry); this.log('painted', entry.key);
    } catch (error) {
      const phase = entry.state === 'painting' ? 'build' : 'request';
      if (entry.controller) { this.active--; delete entry.controller; }
      if (this.disposed) return;
      entry.state = 'failed'; this.errors++; entry.retryAt = performance.now() + 500 * 2 ** entry.attempts;
      this.log(String(error), entry.key);
      this.onError({ code: phase === 'build' ? 'WORKER_ERROR' : 'NETWORK_ERROR', phase, message: String(error), recoverable: entry.attempts < 3,
        tileKey: { sourceId: this.options.source.id, ...entry.address, x: ((entry.address.x % 2 ** entry.address.z) + 2 ** entry.address.z) % 2 ** entry.address.z }, cause: error });
      if (entry.attempts < 3) { entry.state = 'queued'; this.retries++; }
    } finally { clearTimeout(timer); }
  }
  private upload(now: number): void {
    const start = performance.now();
    this.uploads.sort((a, b) => Number(this.critical.has(b.key)) - Number(this.critical.has(a.key)) || a.priority - b.priority);
    for (let count = 0; count < 1 && this.uploads.length && performance.now() - start < 3; count++) {
      const entry = this.uploads.shift()!;
      if (!entry.result?.bitmap) continue;
      if (!this.wanted.has(entry.key)) { entry.result.bitmap.close(); this.entries.delete(entry.key); this.retireWarm(entry.key); continue; }
      const reserve = Math.ceil(entry.result.bitmap.width * entry.result.bitmap.height * 4 * 4 / 3) + lineBytes(entry.result.lines);
      const needed = this.selection.leaves.some(leaf => contains(entry.address, leaf));
      this.evict(now, reserve, needed ? -Infinity : entry.priority, needed);
      if (this.gpuBytes + reserve > this.maxGpuBytes || this.cpuBytes + reserve > this.maxCpuBytes) {
        // 预热必须服从驻留预算，预算不足的后台结果释放后结束本次需求。
        if (!this.selection.leaves.some(leaf => keyOf(leaf) === entry.key)) {
          entry.result.bitmap.close(); this.entries.delete(entry.key); this.wanted.delete(entry.key); this.retireWarm(entry.key); continue;
        }
        this.uploads.unshift(entry); break;
      }
      const uploadStart = performance.now();
      entry.surface = this.surfaces.create(entry.result.bitmap, entry.address, entry.result.lines);
      this.renderer.initTexture(entry.surface.map);
      this.gpuBytes += entry.surface.bytes;
      this.cpuBytes += entry.surface.cpuBytes;
      entry.state = 'ready'; entry.touched = now; delete entry.result;
      this.uploadTime.add(performance.now() - uploadStart); this.coverDirty = true; this.log('ready', entry.key);
    }
  }
  private resolveCover(now: number): void {
    const start = performance.now(); const next = new Set<string>(); this.uncovered = 0; this.targetMissing = 0; this.displayZoomGap = 0; this.fading.clear(); this.coverageDetails = [];
    for (const leaf of this.selection.leaves) {
      const exact = this.entries.get(keyOf(leaf));
      if (exact?.state !== 'ready') this.targetMissing++;
      const descendants = [...this.entries.values()].filter(e => e.surface && contains(leaf, e.address) && e.address.z <= leaf.z + 1);
      if (exact?.state !== 'ready' && coveredFraction(leaf, descendants.filter(e => e.surface!.mesh.material.opacity === 1).map(e => e.address)) >= .999) {
        for (const entry of descendants) next.add(entry.key);
        continue;
      }
      let candidate: Address = leaf; let covered = false;
      while (candidate.z >= this.options.source.minZoom) {
        const entry = this.entries.get(keyOf(candidate));
        if (entry?.state === 'ready' && !entry.empty) {
          if (!covered) {
            this.displayZoomGap = Math.max(this.displayZoomGap, leaf.z - entry.address.z);
            if (leaf.z !== entry.address.z) {
              const pending = []; let address = leaf;
              while (leaf.z - entry.address.z > 2 && address.z > entry.address.z) {
                const key = keyOf(address); const item = this.entries.get(key);
                pending.push({ key, state: item?.state ?? 'absent', priority: item?.priority ?? 0, wanted: this.wanted.has(key) }); address = parentOf(address);
              }
              this.coverageDetails.push({ target: keyOf(leaf), source: entry.key, gap: leaf.z - entry.address.z, priority: this.selection.priorities.get(keyOf(leaf)) ?? 0, ...(pending.length ? { pending } : {}) });
            }
          }
          next.add(entry.key); covered = true;
          if (entry.shownAt === undefined || now - entry.shownAt < 140) {
            for (const { key } of descendants) if (key !== entry.key) {
              next.add(key); if (entry.address.z === leaf.z) this.fading.set(key, entry.key);
            }
          }
          if (entry.shownAt !== undefined && now - entry.shownAt >= 140) break;
        }
        candidate = parentOf(candidate);
      }
      if (!covered) {
        for (const entry of descendants) next.add(entry.key);
        const area = coveredFraction(leaf, descendants.map(e => e.address));
        if (area < .999) this.uncovered++;
      } else if (exact?.state !== 'ready') {
        // 目标尚在加载时，驻留的细节继续覆盖其已有区域。
        for (const entry of descendants) next.add(entry.key);
      }
    }
    for (const key of this.shown) if (!next.has(key)) this.entries.get(key)!.surface!.mesh.visible = false;
    this.shown.clear();
    for (const key of next) {
      const entry = this.entries.get(key)!;
      // 交替淡入需要已有底图；最底层覆盖在进入视锥的首帧完全显示。
      const hasBackdrop = [...next].some(other => other !== key && contains(this.entries.get(other)!.address, entry.address));
      entry.shownAt ??= hasBackdrop ? now : now - 140;
      entry.surface!.mesh.visible = true; entry.touched = now; entry.lastVisible = now; this.shown.add(key);
    }
    this.coverTime.add(performance.now() - start);
  }
  private evict(now: number, reserve = 0, incomingPriority = Infinity, visibleDemand = false): void {
    const start = performance.now();
    const candidates = [...this.entries.values()].filter(e => e.state === 'ready' && !this.shown.has(e.key) && (e.surface || this.entries.size > this.maxEntries) && (visibleDemand || !this.wanted.has(e.key) || e.priority > incomingPriority)).sort((a, b) => Number(this.localCover(a.address)) - Number(this.localCover(b.address)) || Number(this.prefetch.get(a.key)?.coverage === true) - Number(this.prefetch.get(b.key)?.coverage === true) || Number(now - (a.lastVisible ?? -Infinity) < 2000) - Number(now - (b.lastVisible ?? -Infinity) < 2000) || b.priority - a.priority || a.touched - b.touched);
    for (const entry of candidates) {
      if (this.entries.size <= this.maxEntries && this.gpuBytes + reserve <= this.maxGpuBytes && this.cpuBytes + reserve <= this.maxCpuBytes) break;
      this.releaseEntry(entry);
    }
    this.recycleTime.add(performance.now() - start);
    if (this.prefetch.size && [...this.prefetch.values()].some(p => p.until < now)) this.invalidate();
  }
  private releaseEntry(entry: TileEntry): void {
    if (entry.surface) { this.surfaces.release(entry.surface); this.gpuBytes -= entry.surface.bytes; this.cpuBytes -= entry.surface.cpuBytes; }
    this.entries.delete(entry.key); this.evictions++; this.log('evict', entry.key); this.retireWarm(entry.key);
  }
  private retireWarm(key: string): void {
    this.retiredWarm.delete(key); this.retiredWarm.add(key);
    if (this.retiredWarm.size > 4096) this.retiredWarm.delete(this.retiredWarm.values().next().value!);
  }
  private log(type: string, key: string): void {
    this.timeline.push({ at: performance.now(), type, key });
    if (this.timeline.length > 2048) this.timeline.splice(0, 256);
  }
  dispose(): void {
    this.disposed = true; this.workers.dispose();
    for (const entry of this.entries.values()) { entry.controller?.abort(); entry.result?.bitmap?.close(); if (entry.surface) this.surfaces.release(entry.surface); }
    this.entries.clear(); this.shown.clear(); this.retiredWarm.clear(); this.uploads.length = 0; this.prefetch.clear(); this.gpuBytes = 0; this.cpuBytes = 0; this.surfaces.dispose();
  }
}
